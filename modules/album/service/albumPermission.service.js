'use strict';

const db = require('../../../infrastructure/database');
const { ALBUM_ROLE, ALBUM_ROLE_RANK } = require('../../../shared/constants');
const { ForbiddenError, NotFoundError } = require('../../../shared/utils/AppError');
const logger = require('../../../infrastructure/logger');

/**
 * AlbumPermissionService - Centralized permission engine for album domain.
 *
 * Resolution order:
 * 1) Album exists
 * 2) System admin bypass
 * 3) Album owner bypass
 * 4) Public album view (authenticated users only)
 * 5) Membership required
 * 6) Role permission check
 * 7) Deny
 */

const ROLE_PERMISSIONS = Object.freeze({
  [ALBUM_ROLE.VIEWER]: new Set([
    'album:view',
  ]),

  [ALBUM_ROLE.CONTRIBUTOR]: new Set([
    'album:view',
    'photo:upload',
    'photo:delete',
    'comment:create',
  ]),

  [ALBUM_ROLE.ADMIN]: new Set([
    'album:view',
    'photo:upload',
    'photo:delete',
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
    'photo:visibility_manage',
    'comment:create',
    'comment:delete',
    'member:add',
    'member:remove',
    'member:change_role',
    'invitation:create',
  ]),
});

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

  const { Album, AlbumMember } = db;

  const album = await Album.findByPk(albumId);
  if (!album) {
    if (throwOnDeny) throw new NotFoundError('Album');
    return deny('Album not found');
  }

  if (systemRole === 'admin') {
    return allow('System admin bypass', album, null);
  }

  if (userId && album.ownerId === userId) {
    return allow('Album owner', album, null);
  }

  if (action === 'album:view' && album.isPublic && userId) {
    return allow('Public album', album, null);
  }

  if (!userId) {
    return deny('Authentication required for this action');
  }

  const member = await AlbumMember.findOne({ where: { albumId, userId } });
  if (!member) {
    return deny('User is not a member of this album');
  }

  const rolePermissions = ROLE_PERMISSIONS[member.role];
  if (rolePermissions && rolePermissions.has(action)) {
    return allow(`Role "${member.role}" permits "${action}"`, album, member);
  }

  return deny(`Role "${member.role}" does not permit "${action}"`);
};

const assertPermission = async (albumId, userId, action, systemRole = 'user') => {
  const result = await resolvePermission(albumId, userId, action, systemRole, {
    throwOnDeny: true,
  });
  return { album: result.album, member: result.member };
};

const resolveAlbumAccess = async (albumId, userId, systemRole = 'user') => {
  const { Album, AlbumMember } = db;

  const album = await Album.findByPk(albumId);
  if (!album) throw new NotFoundError('Album');

  if (systemRole === 'admin') {
    return _buildAccessContext(album, null, ALBUM_ROLE.OWNER, true, false);
  }

  if (userId && album.ownerId === userId) {
    return _buildAccessContext(album, null, ALBUM_ROLE.OWNER, true, false);
  }

  if (!userId) {
    throw new ForbiddenError('Authentication required to access this album');
  }

  if (album.isPublic) {
    const member = await AlbumMember.findOne({ where: { albumId, userId } });
    if (!member) {
      return _buildAccessContext(album, null, null, false, true);
    }
    return _buildAccessContext(album, member, member.role, false, false);
  }

  const member = await AlbumMember.findOne({ where: { albumId, userId } });
  if (!member) {
    throw new ForbiddenError('You do not have access to this album');
  }

  return _buildAccessContext(album, member, member.role, false, false);
};

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
    canDeletePhoto: isOwner || (rolePerms && rolePerms.has('photo:delete')),
    canManagePhotoVisibility:
      isOwner || (rolePerms && rolePerms.has('photo:visibility_manage')),
    canComment: isOwner || (rolePerms && rolePerms.has('comment:create')),
  };
};

const assertRoleChangeAllowed = (requesterRole, targetRole, newRole) => {
  const requesterRank = ALBUM_ROLE_RANK[requesterRole] || 0;
  const targetRank = ALBUM_ROLE_RANK[targetRole] || 0;
  const newRank = ALBUM_ROLE_RANK[newRole] || 0;

  if (newRole === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Ownership cannot be assigned via role change. Use ownership transfer.');
  }

  if (targetRank >= requesterRank) {
    throw new ForbiddenError('Cannot change role of a member with equal or higher permissions');
  }

  if (newRank >= requesterRank) {
    throw new ForbiddenError('Cannot assign a role equal to or higher than your own');
  }
};

module.exports = {
  resolvePermission,
  assertPermission,
  resolveAlbumAccess,
  assertRoleChangeAllowed,
  ROLE_PERMISSIONS,
};
