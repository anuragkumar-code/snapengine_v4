'use strict';

const db = require('../../../infrastructure/database');
const { Op } = require('sequelize');
const albumPermissionService = require('../../album/service/albumPermission.service');
const photoVisibilityService = require('./photoVisibility.service');
const activityLogService = require('../../album/service/albumActivityLog.service');
const { NotFoundError, ForbiddenError, ValidationError } = require('../../../shared/utils/AppError');
const { PHOTO_VISIBILITY, ACTIVITY_TYPE } = require('../../../shared/constants');
const logger = require('../../../infrastructure/logger');

/**
 * PhotoBulkService
 *
 * Handles bulk operations on photos.
 * All operations are atomic: either all succeed or all fail.
 *
 * Operations:
 *  - Bulk delete (soft delete multiple photos)
 *  - Bulk visibility change (update visibility for multiple photos)
 */

// ── Bulk Delete Photos ─────────────────────────────────────────────────────
/**
 * Soft delete multiple photos at once.
 * Atomic operation: if permission fails for ANY photo, entire operation aborts.
 *
 * @param {string} albumId
 * @param {string[]} photoIds - Array of photo IDs to delete
 * @param {string} userId
 * @param {string} systemRole
 * @param {string} ipAddress
 * @returns {Promise<{ deletedCount: number, photoIds: string[] }>}
 */
const bulkDeletePhotos = async (albumId, photoIds, userId, systemRole, ipAddress) => {
  if (!photoIds || photoIds.length === 0) {
    throw new ValidationError('photoIds array cannot be empty');
  }

  if (photoIds.length > 100) {
    throw new ValidationError('Cannot delete more than 100 photos at once');
  }

  const { Photo, Album } = db;

  // ── Fetch all photos and validate they belong to the album ────────────
  const photos = await Photo.findAll({
    where: {
      id: { [Op.in]: photoIds },
      albumId,
    },
    include: [{ model: Album, as: 'album' }],
  });

  if (photos.length !== photoIds.length) {
    const foundIds = photos.map((p) => p.id);
    const missingIds = photoIds.filter((id) => !foundIds.includes(id));
    throw new NotFoundError(`Photos not found in album: ${missingIds.join(', ')}`);
  }

  // ── Permission check: user must have permission for ALL photos ────────
  // User can delete if they are:
  //  1. Photo uploader, OR
  //  2. Album admin+
  const album = photos[0].album;
  const isAlbumAdmin = (
    await albumPermissionService.resolvePermission(albumId, userId, 'photo:delete', systemRole)
  ).allowed;

  const deniedPhotoIds = [];

  for (const photo of photos) {
    const isUploader = photo.uploadedById === userId;
    if (!isUploader && !isAlbumAdmin) {
      deniedPhotoIds.push(photo.id);
    }
  }

  if (deniedPhotoIds.length > 0) {
    throw new ForbiddenError(`Permission denied for ${deniedPhotoIds.length} photo(s)`, {
      deniedPhotoIds,
    });
  }

  // ── Execute bulk delete (atomic transaction) ───────────────────────────
  const t = await db.sequelize.transaction();
  try {
    await Photo.update(
      { deletedAt: new Date() },
      {
        where: { id: { [Op.in]: photoIds } },
        transaction: t,
      }
    );

    // Log activity for bulk delete
    await activityLogService.logActivity({
      albumId,
      actorId: userId,
      type: ACTIVITY_TYPE.PHOTO_DELETED,
      targetId: null,
      targetType: 'photo',
      metadata: { photoIds, count: photoIds.length, bulk: true },
      ipAddress,
      transaction: t,
    });

    await t.commit();

    logger.info('[PhotoBulkService] Bulk delete completed', {
      albumId,
      count: photoIds.length,
      userId,
    });

    return {
      deletedCount: photoIds.length,
      photoIds,
    };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ── Bulk Change Visibility ─────────────────────────────────────────────────
/**
 * Change visibility for multiple photos at once.
 * Atomic operation: all photos updated together or not at all.
 *
 * @param {string} albumId
 * @param {string[]} photoIds
 * @param {string} visibilityType - 'album_default' | 'restricted' | 'hidden'
 * @param {string[]} allowedUserIds - Required if visibilityType = 'restricted'
 * @param {string} userId
 * @param {string} systemRole
 * @param {string} ipAddress
 * @returns {Promise<{ updatedCount: number, photos: Photo[] }>}
 */
const bulkChangeVisibility = async (
  albumId,
  photoIds,
  visibilityType,
  allowedUserIds = [],
  userId,
  systemRole,
  ipAddress
) => {
  if (!photoIds || photoIds.length === 0) {
    throw new ValidationError('photoIds array cannot be empty');
  }

  if (photoIds.length > 100) {
    throw new ValidationError('Cannot update more than 100 photos at once');
  }

  // Validate visibilityType
  if (!Object.values(PHOTO_VISIBILITY).includes(visibilityType)) {
    throw new ValidationError(`Invalid visibility type: ${visibilityType}`);
  }

  // If restricted, allowedUserIds must be provided
  if (visibilityType === PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length === 0) {
    throw new ValidationError('allowedUserIds required for restricted photos');
  }

  const { Photo, PhotoVisibility, Album, AlbumMember } = db;

  // ── Fetch all photos and validate ──────────────────────────────────────
  const photos = await Photo.findAll({
    where: {
      id: { [Op.in]: photoIds },
      albumId,
    },
    include: [{ model: Album, as: 'album' }],
  });

  if (photos.length !== photoIds.length) {
    const foundIds = photos.map((p) => p.id);
    const missingIds = photoIds.filter((id) => !foundIds.includes(id));
    throw new NotFoundError(`Photos not found in album: ${missingIds.join(', ')}`);
  }

  // ── Permission check ───────────────────────────────────────────────────
  // User can change visibility if they are:
  //  1. Photo uploader, OR
  //  2. Album admin+
  const album = photos[0].album;
  const isAlbumAdmin = (
    await albumPermissionService.resolvePermission(albumId, userId, 'photo:upload', systemRole)
  ).allowed;

  const deniedPhotoIds = [];

  for (const photo of photos) {
    const isUploader = photo.uploadedById === userId;
    if (!isUploader && !isAlbumAdmin) {
      deniedPhotoIds.push(photo.id);
    }
  }

  if (deniedPhotoIds.length > 0) {
    throw new ForbiddenError(`Permission denied for ${deniedPhotoIds.length} photo(s)`, {
      deniedPhotoIds,
    });
  }

  // ── Validate allowedUserIds are album members ──────────────────────────
  if (visibilityType === PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length > 0) {
    const members = await AlbumMember.findAll({
      where: {
        albumId,
        userId: { [Op.in]: allowedUserIds },
      },
    });

    if (members.length !== allowedUserIds.length) {
      const foundUserIds = members.map((m) => m.userId);
      const invalidUserIds = allowedUserIds.filter((id) => !foundUserIds.includes(id));
      throw new ValidationError(`Users not found in album: ${invalidUserIds.join(', ')}`);
    }
  }

  // ── Execute bulk visibility update (atomic transaction) ────────────────
  const t = await db.sequelize.transaction();
  try {
    // Update visibility type for all photos
    await Photo.update(
      { visibilityType },
      {
        where: { id: { [Op.in]: photoIds } },
        transaction: t,
      }
    );

    // Clear existing visibility allowlists
    await PhotoVisibility.destroy({
      where: { photoId: { [Op.in]: photoIds } },
      transaction: t,
    });

    // Create new allowlist records if restricted
    if (visibilityType === PHOTO_VISIBILITY.RESTRICTED && allowedUserIds.length > 0) {
      const allowlistRecords = [];
      for (const photoId of photoIds) {
        for (const allowedUserId of allowedUserIds) {
          allowlistRecords.push({
            photoId,
            userId: allowedUserId,
            grantedById: userId,
          });
        }
      }
      await PhotoVisibility.bulkCreate(allowlistRecords, { transaction: t });
    }

    // Log activity
    await activityLogService.logActivity({
      albumId,
      actorId: userId,
      type: ACTIVITY_TYPE.PHOTO_VISIBILITY_CHANGED,
      targetId: null,
      targetType: 'photo',
      metadata: {
        photoIds,
        count: photoIds.length,
        visibilityType,
        allowedUserCount: allowedUserIds.length,
        bulk: true,
      },
      ipAddress,
      transaction: t,
    });

    await t.commit();

    // Reload photos to get updated data
    const updatedPhotos = await Photo.findAll({
      where: { id: { [Op.in]: photoIds } },
      include: [
        {
          model: PhotoVisibility,
          as: 'visibilityAllowlist',
          required: false,
        },
      ],
    });

    logger.info('[PhotoBulkService] Bulk visibility change completed', {
      albumId,
      count: photoIds.length,
      visibilityType,
      userId,
    });

    return {
      updatedCount: photoIds.length,
      photos: updatedPhotos.map((p) => p.toSafeJSON()),
    };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

module.exports = {
  bulkDeletePhotos,
  bulkChangeVisibility,
};