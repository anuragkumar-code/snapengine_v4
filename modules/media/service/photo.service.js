'use strict';

const db = require('../../../infrastructure/database');
const { storageProvider } = require('../../../infrastructure/upload');
const { dispatch, QUEUE_NAMES } = require('../../../infrastructure/queue');
const { JOB_NAMES, PHOTO_STATUS, PHOTO_VISIBILITY, ACTIVITY_TYPE } = require('../../../shared/constants');
const albumPermissionService = require('../../album/service/albumPermission.service');
const photoVisibilityService = require('./photoVisibility.service');
const activityLogService = require('../../album/service/albumActivityLog.service');
const { NotFoundError, ForbiddenError, ValidationError } = require('../../../shared/utils/AppError');
const logger = require('../../../infrastructure/logger');

/**
 * PhotoService
 *
 * Manages photo lifecycle with STRICT visibility enforcement.
 * EVERY query uses photoVisibilityService to filter results.
 *
 * Upload Flow:
 *  1. Check album permission (photo:upload)
 *  2. Save file via storageProvider (returns { url, key, size })
 *  3. Create Photo record with status=PENDING
 *  4. Dispatch to photo:processing queue
 *  5. Return immediately (async processing)
 *
 * Worker Flow (handled in workers/photoProcessor.js):
 *  1. Extract metadata (EXIF, dimensions)
 *  2. Generate thumbnail
 *  3. Update Photo: status=READY, processedAt, thumbnailUrl, metadata
 *  4. Log activity
 *
 * Query Security:
 *  - buildVisibilityFilter() applied to ALL list queries
 *  - buildVisibilityInclude() added to ALL queries needing visibility check
 *  - Single photo fetch uses resolvePhotoVisibility() after album check
 */

// ── Upload Photo(s) ────────────────────────────────────────────────────────
/**
 * Upload one or more photos to an album and queue for processing.
 * Supports both single and bulk uploads.
 *
 * @param {string} albumId
 * @param {Array<{buffer: Buffer, filename: string, mimetype: string}>} files - Array of file objects
 * @param {string} userId
 * @param {string} systemRole
 * @param {object} [metadata={}] - Optional EXIF, GPS, camera info
 * @returns {Promise<{ uploaded: Photo[], failed: Array }>}
 */
const uploadPhoto = async (albumId, files, userId, systemRole, metadata = {}) => {
  // ── Permission check ───────────────────────────────────────────────────
  await albumPermissionService.assertPermission(albumId, userId, 'photo:upload', systemRole);

  const { Photo } = db;

  // Support single file (convert to array for uniform processing)
  const fileArray = Array.isArray(files) ? files : [files];

  if (fileArray.length === 0) {
    throw new ValidationError('No files provided');
  }

  if (fileArray.length > 20) {
    throw new ValidationError('Cannot upload more than 20 files at once');
  }

  const uploaded = [];
  const failed = [];

  // ── Process each file ──────────────────────────────────────────────────
  for (const file of fileArray) {
    try {
      // Save file to storage
      const uploadResult = await storageProvider.save(
        file.buffer,
        file.filename,
        file.mimetype,
        'photos'
      );

      // Create Photo record (status=PENDING)
      const photo = await Photo.create({
        albumId,
        uploadedById: userId,
        originalFilename: file.filename,
        fileUrl: uploadResult.url,
        storageKey: uploadResult.key,
        mimeType: file.mimetype,
        sizeBytes: uploadResult.size,
        status: PHOTO_STATUS.PENDING,
        visibilityType: PHOTO_VISIBILITY.ALBUM_DEFAULT,
        metadata,
      });

      // Dispatch to processing queue
      await dispatch(QUEUE_NAMES.PHOTO_PROCESSING, JOB_NAMES.PHOTO_RESIZE, {
        photoId: photo.id,
        storageKey: uploadResult.key,
        mimeType: file.mimetype,
      });

      uploaded.push(photo.toSafeJSON());

      logger.info('[PhotoService] Photo uploaded', {
        photoId: photo.id,
        albumId,
        userId,
        filename: file.filename,
        size: uploadResult.size,
      });
    } catch (err) {
      // Log error and continue with next file
      logger.error('[PhotoService] Photo upload failed', {
        albumId,
        userId,
        filename: file.filename,
        error: err.message,
      });

      failed.push({
        filename: file.filename,
        error: err.message,
        status: 'error',
      });
    }
  }

  // Log activity (bulk if multiple files)
  if (uploaded.length > 0) {
    await activityLogService.logActivity({
      albumId,
      actorId: userId,
      type: ACTIVITY_TYPE.PHOTO_UPLOADED,
      targetId: uploaded.length === 1 ? uploaded[0].id : null,
      targetType: 'photo',
      metadata: {
        count: uploaded.length,
        totalSize: uploaded.reduce((sum, p) => sum + p.sizeBytes, 0),
        bulk: uploaded.length > 1,
      },
    });
  }

  return { uploaded, failed };
};

// ── List Photos (with visibility filtering) ───────────────────────────────
/**
 * List photos in an album with visibility filtering applied.
 * SECURITY CRITICAL: uses buildVisibilityFilter to prevent ID guessing.
 *
 * @param {string} albumId
 * @param {string|null} userId
 * @param {string} systemRole
 * @param {object} options - { page, limit, status, tags }
 */
const listPhotos = async (albumId, userId, systemRole, { page = 1, limit = 20, status, tags } = {}) => {
  // ── Album access check ─────────────────────────────────────────────────
  const { album } = await albumPermissionService.resolveAlbumAccess(albumId, userId, systemRole);

  const { Photo, Tag, User } = db;
  const { Op } = require('sequelize');

  const offset = (page - 1) * limit;

  // ── Build visibility filter ────────────────────────────────────────────
  const visibilityWhere = photoVisibilityService.buildVisibilityFilter(userId, album.ownerId);

  const where = {
    albumId,
    ...visibilityWhere,
  };

  if (status) {
    where.status = status;
  }

  // ── Tag filtering ──────────────────────────────────────────────────────
  const include = [
    photoVisibilityService.buildVisibilityInclude(userId),
    {
      model: User,
      as: 'uploadedBy',
      attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
    },
    {
      model: Tag,
      as: 'tags',
      attributes: ['id', 'name', 'slug'],
      through: { attributes: [] }, // Exclude join table
      ...(tags && { where: { slug: { [Op.in]: tags } }, required: true }),
    },
  ];

  const { rows, count } = await Photo.findAndCountAll({
    where,
    include,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    distinct: true, // Prevent COUNT(*) inflation from JOINs
  });

  return {
    photos: rows.map((p) => p.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

// ── Get Single Photo (with visibility check) ──────────────────────────────
/**
 * Fetch a single photo by ID after visibility check.
 *
 * @param {string} photoId
 * @param {string|null} userId
 * @param {string} systemRole
 * @returns {Promise<Photo>}
 */
const getPhoto = async (photoId, userId, systemRole) => {
  const { Photo, Album } = db;

  const photo = await Photo.findByPk(photoId, {
    include: [{ model: Album, as: 'album', attributes: ['id', 'ownerId'] }],
  });

  if (!photo) throw new NotFoundError('Photo');

  // ── Album access check ─────────────────────────────────────────────────
  await albumPermissionService.assertPermission(photo.albumId, userId, 'album:view', systemRole);

  // ── Photo visibility check ─────────────────────────────────────────────
  const { allowed, reason } = await photoVisibilityService.resolvePhotoVisibility(
    photoId, userId, photo.album.ownerId
  );

  if (!allowed) {
    throw new ForbiddenError(reason);
  }

  return photo.toSafeJSON();
};

// ── Update Photo Visibility ────────────────────────────────────────────────
const updatePhotoVisibility = async (photoId, visibilityType, allowedUserIds, userId, systemRole) => {
  const { Photo, Album } = db;

  const photo = await Photo.findByPk(photoId, {
    include: [{ model: Album, as: 'album' }],
  });
  if (!photo) throw new NotFoundError('Photo');

  await photoVisibilityService.setPhotoVisibility(
    photoId,
    visibilityType,
    allowedUserIds,
    userId,
    systemRole
  );

  await activityLogService.logActivity({
    albumId: photo.albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.PHOTO_VISIBILITY_CHANGED,
    targetId: photoId,
    targetType: 'photo',
    metadata: { visibilityType, allowedUserCount: allowedUserIds.length },
  });

  logger.info('[PhotoService] Photo visibility updated', { photoId, visibilityType, userId });
  return photo.toSafeJSON();
};

// ── Soft Delete Photo (Trash) ──────────────────────────────────────────────
const deletePhoto = async (photoId, userId, systemRole, ipAddress) => {
  const { Photo, Album } = db;

  const photo = await Photo.findByPk(photoId, {
    include: [{ model: Album, as: 'album' }],
  });
  if (!photo) throw new NotFoundError('Photo');

  // ── Permission: uploader or album admin+ ───────────────────────────────
  const isUploader = photo.uploadedById === userId;
  const canDelete = isUploader ||
    (await albumPermissionService.resolvePermission(
      photo.albumId, userId, 'photo:delete', systemRole
    )).allowed;

  if (!canDelete) {
    throw new ForbiddenError('Only the uploader or album admin can delete this photo');
  }

  await photo.destroy(); // Soft delete (sets deletedAt)

  await activityLogService.logActivity({
    albumId: photo.albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.PHOTO_DELETED,
    targetId: photoId,
    targetType: 'photo',
    metadata: { filename: photo.originalFilename },
    ipAddress,
  });

  logger.info('[PhotoService] Photo soft-deleted', { photoId, deletedBy: userId });
};

// ── Restore Photo from Trash ───────────────────────────────────────────────
const restorePhoto = async (photoId, userId, systemRole) => {
  const { Photo, Album } = db;

  const photo = await Photo.scope('withDeleted').findByPk(photoId, {
    include: [{ model: Album, as: 'album' }],
  });
  if (!photo) throw new NotFoundError('Photo');
  if (!photo.deletedAt) throw new Error('Photo is not deleted');

  // Only uploader or album owner can restore
  const isUploader = photo.uploadedById === userId;
  const isOwner = photo.album.ownerId === userId;

  if (!isUploader && !isOwner && systemRole !== 'admin') {
    throw new ForbiddenError('Only the uploader or album owner can restore this photo');
  }

  await photo.restore();

  await activityLogService.logActivity({
    albumId: photo.albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.PHOTO_RESTORED,
    targetId: photoId,
    targetType: 'photo',
    metadata: { filename: photo.originalFilename },
  });

  logger.info('[PhotoService] Photo restored', { photoId, restoredBy: userId });
  return photo.toSafeJSON();
};

module.exports = {
  uploadPhoto,
  listPhotos,
  getPhoto,
  updatePhotoVisibility,
  deletePhoto,
  restorePhoto,
};
