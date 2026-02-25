'use strict';

const { Op } = require('sequelize');
const db = require('../../../infrastructure/database');
const { PHOTO_VISIBILITY } = require('../../../shared/constants');
const {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} = require('../../../shared/utils/AppError');

/**
 * PhotoVisibilityService
 *
 * Rules enforced:
 * - Only album owner (or system admin) can manage photo visibility
 * - Hidden photos are owner-only
 * - Restricted photos are visible only to allowlisted members
 */

const buildVisibilityFilter = (userId, albumOwnerId) => {
  if (userId && albumOwnerId && userId === albumOwnerId) {
    return {};
  }

  if (!userId) {
    return {
      visibilityType: PHOTO_VISIBILITY.ALBUM_DEFAULT,
    };
  }

  return {
    [Op.or]: [
      { visibilityType: PHOTO_VISIBILITY.ALBUM_DEFAULT },
      {
        visibilityType: PHOTO_VISIBILITY.RESTRICTED,
        '$visibilityAllowlist.userId$': userId,
      },
    ],
  };
};

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

const resolvePhotoVisibility = async (photoId, userId, albumOwnerId) => {
  const { Photo, PhotoVisibility } = db;

  const photo = await Photo.findByPk(photoId, {
    attributes: ['id', 'visibilityType'],
  });

  if (!photo) {
    throw new NotFoundError('Photo');
  }

  if (userId && userId === albumOwnerId) {
    return { allowed: true, reason: 'Album owner bypass' };
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
      reason: 'This photo is private to the album owner',
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

const setPhotoVisibility = async (
  photoId,
  visibilityType,
  allowedUserIds = [],
  userId,
  systemRole = 'user'
) => {
  const { Photo, PhotoVisibility, AlbumMember, Album } = db;

  if (!Object.values(PHOTO_VISIBILITY).includes(visibilityType)) {
    throw new ValidationError(`Invalid visibility type: ${visibilityType}`);
  }

  const photo = await Photo.findByPk(photoId, {
    include: [{ model: Album, as: 'album', attributes: ['id', 'ownerId'] }],
  });
  if (!photo) throw new NotFoundError('Photo');

  const isAlbumOwner = photo.album && photo.album.ownerId === userId;
  const isSystemAdmin = systemRole === 'admin';
  if (!isAlbumOwner && !isSystemAdmin) {
    throw new ForbiddenError('Only the album owner can change photo visibility');
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
