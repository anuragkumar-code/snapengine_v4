'use strict';

const photoService = require('../service/photo.service');
const ResponseFormatter = require('../../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../../shared/utils/pagination');
const { ValidationError } = require('../../../shared/utils/AppError');

/**
 * Photo Controller
 * HTTP layer only — extract, call service, format response.
 */

const upload = async (req, res, next) => {
  try {
    // Check if files were uploaded
    const hasFiles = req.files || req.file;
    if (!hasFiles) {
      throw new ValidationError('No file uploaded');
    }

    // Convert to array format for service
    let files;
    if (req.files) {
      // Bulk upload (multiple files)
      files = req.files.map((f) => ({
        buffer: f.buffer,
        filename: f.originalname,
        mimetype: f.mimetype,
      }));
    } else {
      // Single upload
      files = [
        {
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
        },
      ];
    }

    const result = await photoService.uploadPhoto(
      req.params.albumId,
      files,
      req.user.id,
      req.user.role,
      req.body.metadata || {}
    );

    // If all failed
    if (result.uploaded.length === 0) {
      return ResponseFormatter.error(
        res,
        400,
        'UPLOAD_FAILED',
        'All uploads failed',
        result.failed
      );
    }

    // If partial success
    if (result.failed.length > 0) {
      return ResponseFormatter.success(
        res,
        {
          uploaded: result.uploaded,
          failed: result.failed,
        },
        201,
        `${result.uploaded.length} photo(s) uploaded, ${result.failed.length} failed. Processing in background.`
      );
    }

    // All succeeded
    return ResponseFormatter.created(
      res,
      {
        uploaded: result.uploaded,
      },
      result.uploaded.length === 1
        ? 'Photo uploaded successfully. Processing in background.'
        : `${result.uploaded.length} photos uploaded successfully. Processing in background.`
    );
  } catch (err) {
    next(err);
  }
};

const list = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const userId = req.user?.id || null;

    const result = await photoService.listPhotos(
      req.params.albumId,
      userId,
      req.user?.role,
      { page, limit, status: req.query.status, tags: req.query.tags }
    );

    return ResponseFormatter.paginated(res, result.photos, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const userId = req.user?.id || null;
    const photo = await photoService.getPhoto(req.params.photoId, userId, req.user?.role);
    return ResponseFormatter.success(res, { photo });
  } catch (err) {
    next(err);
  }
};

const updateVisibility = async (req, res, next) => {
  try {
    const photo = await photoService.updatePhotoVisibility(
      req.params.photoId,
      req.body.visibilityType,
      req.body.allowedUserIds || [],
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.success(res, { photo }, 200, 'Visibility updated');
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    await photoService.deletePhoto(req.params.photoId, req.user.id, req.user.role, req.ip);
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

const restore = async (req, res, next) => {
  try {
    const photo = await photoService.restorePhoto(req.params.photoId, req.user.id, req.user.role);
    return ResponseFormatter.success(res, { photo }, 200, 'Photo restored');
  } catch (err) {
    next(err);
  }
};

module.exports = { upload, list, getOne, updateVisibility, remove, restore };