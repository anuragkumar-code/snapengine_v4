'use strict';

const sharp = require('sharp');
const { storageProvider } = require('../../../infrastructure/upload');
const db = require('../../../infrastructure/database');
const { PHOTO_STATUS, ACTIVITY_TYPE } = require('../../../shared/constants');
const activityLogService = require('../../album/service/albumActivityLog.service');
const logger = require('../../../infrastructure/logger');

/**
 * Photo Processing Worker
 *
 * Consumes jobs from QUEUE_NAMES.PHOTO_PROCESSING.
 * Runs asynchronously after photo upload.
 *
 * Processing Steps:
 *  1. Set status = PROCESSING
 *  2. Load original image from storage
 *  3. Extract metadata (dimensions, EXIF)
 *  4. Generate thumbnail (max 300x300, WebP for compression)
 *  5. Save thumbnail to storage
 *  6. Update Photo record: status=READY, thumbnailUrl, metadata, processedAt
 *  7. Log activity
 *
 * Error Handling:
 *  - On failure: set status=FAILED, log error to metadata.error
 *  - Retry strategy: BullMQ default (3 attempts with exponential backoff)
 *
 * This worker is registered in server.js via registerWorker().
 */

const THUMBNAIL_SIZE = 300;
const THUMBNAIL_FORMAT = 'webp';
const THUMBNAIL_QUALITY = 80;

/**
 * Process a photo: extract metadata, generate thumbnail.
 *
 * @param {object} job - BullMQ job
 * @param {string} job.data.photoId
 * @param {string} job.data.storageKey
 * @param {string} job.data.mimeType
 */
const processPhoto = async (job) => {
  const { photoId, storageKey, mimeType } = job.data;

  logger.info('[PhotoWorker] Processing started', { photoId, jobId: job.id });

  const { Photo } = db;

  try {
    // ── Step 1: Update status ──────────────────────────────────────────
    const photo = await Photo.findByPk(photoId);
    if (!photo) {
      logger.error('[PhotoWorker] Photo not found', { photoId });
      throw new Error('Photo not found');
    }

    await photo.update({ status: PHOTO_STATUS.PROCESSING });

    // ── Step 2: Load original image from storage ───────────────────────
    // For local storage, storageKey is a relative path
    // For S3, use storageProvider to download the buffer
    const fs = require('fs-extra');
    const path = require('path');
    const config = require('../../../config');

    let imageBuffer;
    if (config.upload.provider === 'local') {
      const fullPath = path.join(config.upload.local.basePath, storageKey);
      imageBuffer = await fs.readFile(fullPath);
    } else {
      // S3: download buffer (future implementation)
      throw new Error('S3 download not yet implemented');
    }

    // ── Step 3: Extract metadata ───────────────────────────────────────
    const sharpInstance = sharp(imageBuffer);
    const metadata = await sharpInstance.metadata();

    const extractedMetadata = {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      space: metadata.space,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
      exif: metadata.exif || null,
    };

    // ── Step 4: Generate thumbnail ─────────────────────────────────────
    const thumbnailBuffer = await sharpInstance
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFormat(THUMBNAIL_FORMAT, { quality: THUMBNAIL_QUALITY })
      .toBuffer();

    // ── Step 5: Save thumbnail to storage ──────────────────────────────
    const thumbnailFilename = `thumb_${photoId}.${THUMBNAIL_FORMAT}`;
    const thumbnailResult = await storageProvider.save(
      thumbnailBuffer,
      thumbnailFilename,
      `image/${THUMBNAIL_FORMAT}`,
      'thumbnails'
    );

    // ── Step 6: Update Photo record ────────────────────────────────────
    await photo.update({
      width: metadata.width,
      height: metadata.height,
      thumbnailUrl: thumbnailResult.url,
      thumbnailKey: thumbnailResult.key,
      status: PHOTO_STATUS.READY,
      processedAt: new Date(),
      metadata: {
        ...photo.metadata,
        ...extractedMetadata,
      },
    });

    // ── Step 7: Log activity ───────────────────────────────────────────
    await activityLogService.logActivity({
      albumId: photo.albumId,
      actorId: photo.uploadedById,
      type: ACTIVITY_TYPE.PHOTO_PROCESSED,
      targetId: photoId,
      targetType: 'photo',
      metadata: {
        width: metadata.width,
        height: metadata.height,
        thumbnailSize: thumbnailResult.size,
      },
    });

    logger.info('[PhotoWorker] Processing completed', {
      photoId,
      jobId: job.id,
      width: metadata.width,
      height: metadata.height,
      thumbnailUrl: thumbnailResult.url,
    });

    return { success: true, photoId };
  } catch (error) {
    // ── Error Handling ──────────────────────────────────────────────────
    logger.error('[PhotoWorker] Processing failed', {
      photoId,
      jobId: job.id,
      error: error.message,
      stack: error.stack,
    });

    // Update photo status to FAILED, log error
    const photo = await Photo.findByPk(photoId);
    if (photo) {
      await photo.update({
        status: PHOTO_STATUS.FAILED,
        processedAt: new Date(),
        metadata: {
          ...photo.metadata,
          error: error.message,
          failedAt: new Date().toISOString(),
        },
      });
    }

    // Re-throw so BullMQ retries
    throw error;
  }
};

module.exports = { processPhoto };