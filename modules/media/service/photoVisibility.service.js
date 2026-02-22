'use strict';

const { Op } = require('sequelize');
const db = require('../../../infrastructure/database');
const albumPermissionService = require('../../album/service/albumPermission.service');
const { PHOTO_VISIBILITY } = require('../../../shared/constants');
const {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} = require('../../../shared/utils/AppError');

/**
 * PhotoVisibilityService
 *
 * Owns all per-photo visibility logic:
 *  - Query filters/includes for list/search endpoints
 *  - Single-photo visibility checks
 *  - Visibility updates + restricted allowlist persistence
 */

/**
 * Build WHERE clause for listing/searching photos in a specific album.
 * Requires the album owner id for owner bypass decisions.
 */
const buildVisibilityFilter = (userId, albumOwnerId) => {
  // Album owner can see all photo visibility states.
  if (userId && albumOwnerId && userId === albumOwnerId) {
    return {};
  }

  // Unauthenticated users can only see album-default photos.
  if (!userId) {
    return { visibilityType: PHOTO_VISIBILITY.ALBUM_DEFAULT };
  }

  return {
    [Op.or]: [
      { visibilityType: PHOTO_VISIBILITY.ALBUM_DEFAULT },
      { visibilityType: PHOTO_VISIBILITY.HIDDEN, uploadedById: userId },
      { visibilityType: PHOTO_VISIBILITY.RESTRICTED, uploadedById: userId },
      {
        visibilityType: PHOTO_VISIBILITY.RESTRICTED,
        '$visibilityAllowlist.userId$': userId,
      },
    ],
  };
};

/**
 * Build include used by buildVisibilityFilter for restricted-photo allowlist checks.
 */
const buildVisibilityInclude = (userId) => {
  const include = {
    model: db.PhotoVisibility,
    as: 'visibilityAllowlist',
    attributes: ['id', 'userId'],
    required: false,
  };

  if (userId) {
    include.where = { userId };
  }

  return include;
};

/**
 * Resolve visibility for a single photo.
 */
const resolvePhotoVisibility = async (photoId, userId, albumOwnerId) => {
  const { Photo, PhotoVisibility } = db;

  const photo = await Photo.findByPk(photoId, {
    attributes: ['id', 'uploadedById', 'visibilityType'],
  });

  if (!photo) {
    throw new NotFoundError('Photo');
  }

  // Owner/uploader bypass
  if (userId && (userId === albumOwnerId || userId === photo.uploadedById)) {
    return { allowed: true, reason: 'Owner or uploader bypass' };
  }

  if (photo.visibilityType === PHOTO_VISIBILITY.ALBUM_DEFAULT) {
    return { allowed: true, reason: 'Album default visibility' };
  }

  if (!userId) {
    return {
      allowed: false,
      reason: 'Authentication required to view this photo',
    };
  }

  if (photo.visibilityType === PHOTO_VISIBILITY.HIDDEN) {
    return {
      allowed: false,
      reason: 'This photo is hidden',
    };
  }

  const allowlistEntry = await PhotoVisibility.findOne({
    where: { photoId, userId },
    attributes: ['id'],
  });

  if (allowlistEntry) {
    return { allowed: true, reason: 'User is in restricted allowlist' };
  }

  return {
    allowed: false,
    reason: 'You are not allowed to view this restricted photo',
  };
};

/**
 * Update photo visibility + restricted allowlist records.
 * Permission: uploader or album admin+.
 */
const setPhotoVisibility = async (
  photoId,
  visibilityType,
  allowedUserIds = [],
  userId,
  systemRole = 'user'
) => {
  const { Photo, PhotoVisibility, AlbumMember } = db;

  if (!Object.values(PHOTO_VISIBILITY).includes(visibilityType)) {
    throw new ValidationError(`Invalid visibility type: ${visibilityType}`);
  }

  const photo = await Photo.findByPk(photoId);
  if (!photo) throw new NotFoundError('Photo');

  const isUploader = photo.uploadedById === userId;
  const isAlbumAdmin = (
    await albumPermissionService.resolvePermission(
      photo.albumId,
      userId,
      'photo:delete',
      systemRole
    )
  ).allowed;

  if (!isUploader && !isAlbumAdmin) {
    throw new ForbiddenError('Only the uploader or album admin can change photo visibility');
  }

  if (visibilityType === PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length === 0) {
    throw new ValidationError('allowedUserIds required for restricted photos');
  }

  if (visibilityType !== PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length > 0) {
    throw new ValidationError('allowedUserIds can only be used with restricted visibility');
  }

  if (visibilityType === PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length > 0) {
    const members = await AlbumMember.findAll({
      where: {
        albumId: photo.albumId,
        userId: { [Op.in]: allowedUserIds },
      },
      attributes: ['userId'],
    });

    if (members.length !== allowedUserIds.length) {
      const foundUserIds = members.map((m) => m.userId);
      const invalidUserIds = allowedUserIds.filter((id) => !foundUserIds.includes(id));
      throw new ValidationError(`Users not found in album: ${invalidUserIds.join(', ')}`);
    }
  }

  const t = await db.sequelize.transaction();
  try {
    await photo.update({ visibilityType }, { transaction: t });

    await PhotoVisibility.destroy({
      where: { photoId },
      transaction: t,
    });

    if (visibilityType === PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length > 0) {
      await PhotoVisibility.bulkCreate(
        allowedUserIds.map((allowedUserId) => ({
          photoId,
          userId: allowedUserId,
          grantedById: userId,
        })),
        { transaction: t }
      );
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

module.exports = {
  buildVisibilityFilter,
  buildVisibilityInclude,
  resolvePhotoVisibility,
  setPhotoVisibility,
};
