'use strict';

const db = require('../../../infrastructure/database');
const { ALBUM_ROLE, ALBUM_ROLE_RANK, ALBUM_VISIBILITY } = require('../../../shared/constants');
const { ForbiddenError, NotFoundError } = require('../../../shared/utils/AppError');
const logger = require('../../../infrastructure/logger');

/**
 * AlbumPermissionService — Centralized Permission Engine
 *
 * This is the SINGLE authority for all permission decisions in the Album context.
 * No controller, no other service, no middleware makes permission decisions.
 * Everything flows through here.
 *
 * Resolution Algorithm (always in this order):
 *
 *  Step 1: Album existence check (throw NotFoundError if missing/deleted)
 *  Step 2: System admin bypass — admin role always has full access
 *  Step 3: Owner bypass — album owner always has full access
 *  Step 4: Public album shortcut — if action is 'album:view' and album.isPublic → allow
 *  Step 5: AlbumMember lookup — is the user a member at all?
 *  Step 6: Override check — does an explicit override exist for this action?
 *            If override.granted = true  → ALLOW (regardless of role)
 *            If override.granted = false → DENY  (regardless of role)
 *  Step 7: Role-based check — does user's role permit this action?
 *  Step 8: Default → DENY
 *
 * Role Permission Map:
 *
 *  viewer      : album:view
 *  contributor : album:view, photo:upload, comment:create
 *  admin       : all contributor + album:edit, member:add, member:remove,
 *                member:change_role, photo:delete, comment:delete,
 *                invitation:create, album:manage_settings
 *  owner       : all admin + album:delete
 *
 * Exported methods:
 *  resolvePermission(albumId, userId, action, systemRole)
 *    → Returns { allowed: bool, reason: string, member: AlbumMember|null }
 *
 *  assertPermission(albumId, userId, action, systemRole)
 *    → Throws ForbiddenError if not allowed
 *
 *  resolveAlbumAccess(albumId, userId, systemRole)
 *    → Returns { album, member, effectiveRole, isOwner, isPublicViewer }
 *      Used by services to load the album + resolve access in one call
 */

// ── Role → Allowed Actions Map ─────────────────────────────────────────────
const ROLE_PERMISSIONS = Object.freeze({
  [ALBUM_ROLE.VIEWER]: new Set([
    'album:view',
  ]),

  [ALBUM_ROLE.CONTRIBUTOR]: new Set([
    'album:view',
    'photo:upload',
    'comment:create',
    'photo:view_restricted', // contributors can see all photos
  ]),

  [ALBUM_ROLE.ADMIN]: new Set([
    'album:view',
    'album:edit',
    'album:manage_settings',
    'photo:upload',
    'photo:delete',
    'photo:view_restricted',
    'comment:create',
    'comment:delete',
    'member:add',
    'member:remove',
    'member:change_role',
    'invitation:create',
  ]),

  [ALBUM_ROLE.OWNER]: new Set([
    'album:view',
    'album:edit',
    'album:manage_settings',
    'album:delete',
    'photo:upload',
    'photo:delete',
    'photo:view_restricted',
    'comment:create',
    'comment:delete',
    'member:add',
    'member:remove',
    'member:change_role',
    'invitation:create',
  ]),
});

/**
 * Resolve whether a user has permission to perform an action on an album.
 *
 * @param {string} albumId
 * @param {string|null} userId       - null for unauthenticated users
 * @param {string} action            - e.g. 'album:view', 'photo:upload'
 * @param {string} systemRole        - req.user.role ('user' | 'admin')
 * @param {object} [options]
 * @param {boolean} [options.throwOnDeny=false] - throw ForbiddenError if denied
 * @returns {Promise<{ allowed: boolean, reason: string, album: Album, member: AlbumMember|null }>}
 */
const resolvePermission = async (albumId, userId, action, systemRole = 'user', options = {}) => {
  const { throwOnDeny = false } = options;

  const deny = (reason) => {
    logger.debug('[PermissionEngine] DENIED', { albumId, userId, action, reason });
    if (throwOnDeny) throw new ForbiddenError(reason);
    return { allowed: false, reason, album: null, member: null };
  };

  const allow = (reason, album, member = null) => {
    logger.debug('[PermissionEngine] ALLOWED', { albumId, userId, action, reason });
    return { allowed: true, reason, album, member };
  };

  // ── Step 1: Album existence ──────────────────────────────────────────
  const { Album, AlbumMember, AlbumPermissionOverride } = db;

  const album = await Album.findByPk(albumId);
  if (!album) {
    if (throwOnDeny) throw new NotFoundError('Album');
    return deny('Album not found');
  }

  // ── Step 2: System admin bypass ──────────────────────────────────────
  if (systemRole === 'admin') {
    return allow('System admin bypass', album, null);
  }

  // ── Step 3: Album owner bypass ───────────────────────────────────────
  if (userId && album.ownerId === userId) {
    return allow('Album owner', album, null);
  }

  // ── Step 4: Public album shortcut ────────────────────────────────────
  // Unauthenticated users can view public albums — nothing else
  if (action === 'album:view' && album.isPublic) {
    return allow('Public album', album, null);
  }

  // All other actions require authentication
  if (!userId) {
    return deny('Authentication required for this action');
  }

  // ── Step 5: AlbumMember lookup ───────────────────────────────────────
  const member = await AlbumMember.findOne({
    where: { albumId, userId },
    include: [
      {
        model: AlbumPermissionOverride,
        as: 'permissionOverrides',
        required: false,
        where: { action },
        limit: 1, // We only need the override for THIS action
      },
    ],
  });

  if (!member) {
    return deny(`User is not a member of this album`);
  }

  // ── Step 6: Override check ───────────────────────────────────────────
  const override = member.permissionOverrides && member.permissionOverrides[0];
  if (override) {
    const reason = override.granted
      ? `Explicit grant override for action "${action}"`
      : `Explicit deny override for action "${action}"`;

    if (override.granted) return allow(reason, album, member);
    return deny(reason);
  }

  // ── Step 7: Role-based check ─────────────────────────────────────────
  const rolePermissions = ROLE_PERMISSIONS[member.role];
  if (rolePermissions && rolePermissions.has(action)) {
    return allow(`Role "${member.role}" permits "${action}"`, album, member);
  }

  // ── Step 8: Default deny ─────────────────────────────────────────────
  return deny(`Role "${member.role}" does not permit "${action}"`);
};

/**
 * Assert permission — throws ForbiddenError if denied.
 * Use this in service layer when you need permission + album in one call.
 *
 * @returns {Promise<{ album: Album, member: AlbumMember|null }>}
 */
const assertPermission = async (albumId, userId, action, systemRole = 'user') => {
  const result = await resolvePermission(albumId, userId, action, systemRole, {
    throwOnDeny: true,
  });
  return { album: result.album, member: result.member };
};

/**
 * Resolve full album access context in one DB round-trip.
 * Returns enriched context for services to work with.
 *
 * @returns {Promise<{
 *   album: Album,
 *   member: AlbumMember|null,
 *   effectiveRole: string|null,
 *   isOwner: boolean,
 *   isAdmin: boolean,
 *   isPublicViewer: boolean,
 *   canEdit: boolean,
 *   canDelete: boolean,
 *   canManageMembers: boolean,
 * }>}
 */
const resolveAlbumAccess = async (albumId, userId, systemRole = 'user') => {
  const { Album, AlbumMember, AlbumPermissionOverride } = db;

  const album = await Album.findByPk(albumId);
  if (!album) throw new NotFoundError('Album');

  // System admin
  if (systemRole === 'admin') {
    return _buildAccessContext(album, null, ALBUM_ROLE.OWNER, true, false);
  }

  // Album owner
  if (userId && album.ownerId === userId) {
    return _buildAccessContext(album, null, ALBUM_ROLE.OWNER, true, false);
  }

  // Public viewer (no membership)
  if (!userId && album.isPublic) {
    return _buildAccessContext(album, null, null, false, true);
  }

  if (!userId) {
    throw new ForbiddenError('Authentication required to access this album');
  }

  // Member lookup with ALL their overrides
  const member = await AlbumMember.findOne({
    where: { albumId, userId },
    include: [
      {
        model: AlbumPermissionOverride,
        as: 'permissionOverrides',
        required: false,
      },
    ],
  });

  // Private album, not a member
  if (!member) {
    if (album.isPublic) {
      return _buildAccessContext(album, null, null, false, true);
    }
    throw new ForbiddenError('You do not have access to this album');
  }

  return _buildAccessContext(album, member, member.role, false, false);
};

/**
 * Build a consistent access context object.
 * @private
 */
const _buildAccessContext = (album, member, effectiveRole, isOwner, isPublicViewer) => {
  const rolePerms = effectiveRole ? ROLE_PERMISSIONS[effectiveRole] : new Set();
  return {
    album,
    member,
    effectiveRole,
    isOwner,
    isPublicViewer,
    canEdit: isOwner || (rolePerms && rolePerms.has('album:edit')),
    canDelete: isOwner || (rolePerms && rolePerms.has('album:delete')),
    canManageMembers: isOwner || (rolePerms && rolePerms.has('member:add')),
    canUploadPhoto: isOwner || (rolePerms && rolePerms.has('photo:upload')),
    canComment: isOwner || (rolePerms && rolePerms.has('comment:create')),
  };
};

/**
 * Check if requester can manage (promote/demote) a target member.
 * Admin cannot change owner. Only owner can change admin's role.
 * Nobody can set role to owner via normal flow.
 *
 * @param {string} requesterRole - Role of person making the change
 * @param {string} targetRole    - Current role of the person being changed
 * @param {string} newRole       - Desired new role
 * @throws {ForbiddenError} if the role change is not permitted
 */
const assertRoleChangeAllowed = (requesterRole, targetRole, newRole) => {
  const requesterRank = ALBUM_ROLE_RANK[requesterRole] || 0;
  const targetRank = ALBUM_ROLE_RANK[targetRole] || 0;
  const newRank = ALBUM_ROLE_RANK[newRole] || 0;

  if (newRole === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Ownership cannot be assigned via role change. Use ownership transfer.');
  }

  // Can only manage members with strictly lower rank
  if (targetRank >= requesterRank) {
    throw new ForbiddenError(`Cannot change role of a member with equal or higher permissions`);
  }

  // Cannot promote someone to a rank equal to or higher than yourself
  if (newRank >= requesterRank) {
    throw new ForbiddenError(`Cannot assign a role equal to or higher than your own`);
  }
};

module.exports = {
  resolvePermission,
  assertPermission,
  resolveAlbumAccess,
  assertRoleChangeAllowed,
  ROLE_PERMISSIONS,
};