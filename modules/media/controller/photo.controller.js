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
    if (!req.file) {
      throw new ValidationError('No file uploaded');
    }

    const photo = await photoService.uploadPhoto(
      req.params.albumId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.user.id,
      req.user.role,
      req.body.metadata || {}
    );

    return ResponseFormatter.created(
      res,
      { photo },
      'Photo uploaded successfully. Processing in background.'
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