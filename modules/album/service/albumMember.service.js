'use strict';

const db = require('../../../infrastructure/database');
const permissionService = require('./albumPermission.service');
const activityLogService = require('./albumActivityLog.service');
const {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} = require('../../../shared/utils/AppError');
const { ALBUM_ROLE, ACTIVITY_TYPE } = require('../../../shared/constants');
const logger = require('../../../infrastructure/logger');

/**
 * AlbumMemberService
 *
 * Manages album membership and permission overrides.
 * All role-change eligibility checks go through AlbumPermissionService.
 *
 * Operations:
 *  - List members
 *  - Add member directly (admin+ only)
 *  - Remove member
 *  - Change member role
 *  - Set / remove permission override for a member
 *  - Get member's effective permissions
 */

// ── List Members ───────────────────────────────────────────────────────────
const listMembers = async (albumId, userId, systemRole, { page = 1, limit = 20 } = {}) => {
  await permissionService.assertPermission(albumId, userId, 'album:view', systemRole);

  const { AlbumMember, User } = db;
  const offset = (page - 1) * limit;

  const { rows, count } = await AlbumMember.findAndCountAll({
    where: { albumId },
    limit,
    offset,
    order: [['createdAt', 'ASC']],
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl'],
      },
    ],
  });

  return {
    members: rows.map((m) => m.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

// -- Search Candidate Users -----------------------------------------------------
/**
 * Search active users by email/firstName/lastName for add-member flow.
 * Requires member:add permission and excludes users already in the album.
 */
const searchCandidateUsers = async (albumId, requesterId, systemRole, { q, limit = 10 } = {}) => {
  await permissionService.assertPermission(albumId, requesterId, 'member:add', systemRole);

  const { AlbumMember, User } = db;
  const { Op } = require('sequelize');

  const memberships = await AlbumMember.findAll({
    where: { albumId },
    attributes: ['userId'],
  });
  const existingUserIds = memberships.map((m) => m.userId);
  const search = q.trim();
  const where = {
    status: 'active',
    [Op.or]: [
      { email: { [Op.iLike]: `%${search}%` } },
      { firstName: { [Op.iLike]: `%${search}%` } },
      { lastName: { [Op.iLike]: `%${search}%` } },
    ],
  };

  if (existingUserIds.length > 0) {
    where.id = { [Op.notIn]: existingUserIds };
  }

  const users = await User.findAll({
    where,
    attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl'],
    limit,
    order: [['firstName', 'ASC'], ['lastName', 'ASC']],
  });

  return users.map((u) => u.toSafeJSON());
};
// ── Add Member ─────────────────────────────────────────────────────────────
/**
 * Add a user directly to an album (no invitation needed).
 * Requires admin+ permission.
 */
const addMember = async (albumId, targetUserId, role, requesterId, systemRole, ipAddress) => {
  await permissionService.assertPermission(albumId, requesterId, 'member:add', systemRole);

  // Cannot add owner role via direct add
  if (role === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Ownership cannot be assigned via member add');
  }

  const { AlbumMember, User } = db;

  // Verify target user exists
  const targetUser = await User.findByPk(targetUserId);
  if (!targetUser) throw new NotFoundError('User');

  // Check if already a member
  const existing = await AlbumMember.findOne({ where: { albumId, userId: targetUserId } });
  if (existing) {
    throw new ConflictError('User is already a member of this album');
  }

  // Check requester's own role to enforce rank rules
  const { member: requesterMember } = await permissionService.resolvePermission(
    albumId, requesterId, 'member:add', systemRole
  );

  if (requesterMember) {
    permissionService.assertRoleChangeAllowed(requesterMember.role, 'viewer', role);
  }

  const member = await AlbumMember.create({
    albumId,
    userId: targetUserId,
    role,
    addedById: requesterId,
  });

  await activityLogService.logActivity({
    albumId,
    actorId: requesterId,
    type: ACTIVITY_TYPE.MEMBER_ADDED,
    targetId: targetUserId,
    targetType: 'user',
    metadata: { role, addedUserId: targetUserId },
    ipAddress,
  });

  logger.info('[MemberService] Member added', { albumId, userId: targetUserId, role });
  return member.toSafeJSON();
};

// ── Remove Member ──────────────────────────────────────────────────────────
/**
 * Remove a member from an album.
 * Users can remove themselves. Admins+ can remove lower-ranked members.
 * Owner cannot be removed.
 */
const removeMember = async (albumId, targetUserId, requesterId, systemRole, ipAddress) => {
  const { AlbumMember, Album } = db;

  const album = await Album.findByPk(albumId);
  if (!album) throw new NotFoundError('Album');

  const targetMember = await AlbumMember.findOne({ where: { albumId, userId: targetUserId } });
  if (!targetMember) throw new NotFoundError('Member');

  // Owner cannot be removed
  if (targetMember.role === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Album owner cannot be removed. Transfer ownership first.');
  }

  const isSelf = requesterId === targetUserId;

  if (!isSelf) {
    // Removing someone else — need member:remove permission
    await permissionService.assertPermission(albumId, requesterId, 'member:remove', systemRole);

    // Get requester's member record to check rank
    const requesterMember = await AlbumMember.findOne({ where: { albumId, userId: requesterId } });
    if (requesterMember) {
      // Can only remove members with lower rank
      const { ALBUM_ROLE_RANK } = require('../../../shared/constants');
      if (ALBUM_ROLE_RANK[targetMember.role] >= ALBUM_ROLE_RANK[requesterMember.role]) {
        throw new ForbiddenError('Cannot remove a member with equal or higher permissions');
      }
    }
  }

  await targetMember.destroy();

  await activityLogService.logActivity({
    albumId,
    actorId: requesterId,
    type: ACTIVITY_TYPE.MEMBER_REMOVED,
    targetId: targetUserId,
    targetType: 'user',
    metadata: { removedRole: targetMember.role, selfRemoval: isSelf },
    ipAddress,
  });

  logger.info('[MemberService] Member removed', { albumId, userId: targetUserId, removedBy: requesterId });
};

// ── Change Member Role ─────────────────────────────────────────────────────
const changeMemberRole = async (albumId, targetUserId, newRole, requesterId, systemRole, ipAddress) => {
  await permissionService.assertPermission(albumId, requesterId, 'member:change_role', systemRole);

  const { AlbumMember } = db;

  const targetMember = await AlbumMember.findOne({ where: { albumId, userId: targetUserId } });
  if (!targetMember) throw new NotFoundError('Member');

  if (targetMember.role === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Cannot change owner role. Use ownership transfer.');
  }

  // Validate the rank change is permitted for requester
  const requesterMember = await AlbumMember.findOne({ where: { albumId, userId: requesterId } });
  const requesterRole = requesterMember ? requesterMember.role : ALBUM_ROLE.OWNER; // system admin treated as owner

  permissionService.assertRoleChangeAllowed(requesterRole, targetMember.role, newRole);

  const previousRole = targetMember.role;
  await targetMember.update({ role: newRole, roleChangedAt: new Date() });

  await activityLogService.logActivity({
    albumId,
    actorId: requesterId,
    type: ACTIVITY_TYPE.MEMBER_ROLE_CHANGED,
    targetId: targetUserId,
    targetType: 'user',
    metadata: { previousRole, newRole },
    ipAddress,
  });

  logger.info('[MemberService] Member role changed', {
    albumId, userId: targetUserId, from: previousRole, to: newRole,
  });

  return targetMember.toSafeJSON();
};

// ── Set Permission Override ────────────────────────────────────────────────
/**
 * Grant or deny a specific action for a member, overriding their role.
 * Only admin+ can set overrides.
 */
const setPermissionOverride = async (
  albumId, targetUserId, action, granted, requesterId, systemRole, reason = null, ipAddress
) => {
  await permissionService.assertPermission(albumId, requesterId, 'album:manage_settings', systemRole);

  const { AlbumMember, AlbumPermissionOverride } = db;

  const targetMember = await AlbumMember.findOne({ where: { albumId, userId: targetUserId } });
  if (!targetMember) throw new NotFoundError('Member');

  if (targetMember.role === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Cannot set permission overrides for the album owner');
  }

  // Validate action is a known permission action
  const { ACTIONS } = AlbumPermissionOverride;
  if (!Object.values(ACTIONS).includes(action)) {
    throw new ValidationError(`Unknown permission action: "${action}"`);
  }

  // Upsert: update if exists, create if not
  const [override, created] = await AlbumPermissionOverride.findOrCreate({
    where: { albumMemberId: targetMember.id, action },
    defaults: {
      albumId,
      albumMemberId: targetMember.id,
      action,
      granted,
      setById: requesterId,
      reason,
    },
  });

  if (!created) {
    await override.update({ granted, setById: requesterId, reason });
  }

  logger.info('[MemberService] Permission override set', {
    albumId, userId: targetUserId, action, granted,
  });

  return override.get({ plain: true });
};

// ── Remove Permission Override ─────────────────────────────────────────────
const removePermissionOverride = async (albumId, targetUserId, action, requesterId, systemRole) => {
  await permissionService.assertPermission(albumId, requesterId, 'album:manage_settings', systemRole);

  const { AlbumMember, AlbumPermissionOverride } = db;

  const targetMember = await AlbumMember.findOne({ where: { albumId, userId: targetUserId } });
  if (!targetMember) throw new NotFoundError('Member');

  const deleted = await AlbumPermissionOverride.destroy({
    where: { albumMemberId: targetMember.id, action },
  });

  if (!deleted) throw new NotFoundError('Permission override');

  logger.info('[MemberService] Permission override removed', { albumId, userId: targetUserId, action });
};

// ── Get Member Effective Permissions ──────────────────────────────────────
/**
 * Returns all effective permissions for a member including overrides.
 * Useful for admin UI showing "what can this person do?"
 */
const getMemberEffectivePermissions = async (albumId, targetUserId, requesterId, systemRole) => {
  await permissionService.assertPermission(albumId, requesterId, 'album:view', systemRole);

  const { AlbumMember, AlbumPermissionOverride } = db;

  const member = await AlbumMember.findOne({
    where: { albumId, userId: targetUserId },
    include: [{ model: AlbumPermissionOverride, as: 'permissionOverrides', required: false }],
  });

  if (!member) throw new NotFoundError('Member');

  const { ROLE_PERMISSIONS } = permissionService;
  const basePermissions = ROLE_PERMISSIONS[member.role] || new Set();
  const overrides = member.permissionOverrides || [];

  const effectivePermissions = new Set(basePermissions);

  // Apply overrides
  overrides.forEach((o) => {
    if (o.granted) effectivePermissions.add(o.action);
    else effectivePermissions.delete(o.action);
  });

  return {
    memberId: member.id,
    userId: targetUserId,
    role: member.role,
    basePermissions: Array.from(basePermissions),
    overrides: overrides.map((o) => ({ action: o.action, granted: o.granted, reason: o.reason })),
    effectivePermissions: Array.from(effectivePermissions),
  };
};

module.exports = {
  listMembers,
  searchCandidateUsers,
  addMember,
  removeMember,
  changeMemberRole,
  setPermissionOverride,
  removePermissionOverride,
  getMemberEffectivePermissions,
};

