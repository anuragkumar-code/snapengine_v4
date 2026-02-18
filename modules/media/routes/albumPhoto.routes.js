'use strict';

const { Router } = require('express');
const photoController = require('../controller/photo.controller');

const { authenticate, optionalAuth } = require('../../../shared/middleware/authenticate');
const { validate } = require('../../../shared/middleware/validate');
const { createUploadMiddleware } = require('../../../infrastructure/upload');
const mediaValidator = require('../validators/media.validator');

/**
 * Album Photo Routes
 * Base path: /api/v1/albums
 *
 * Handles album-scoped photo operations:
 *   /:albumId/photos
 */

const router = Router();

// Photo upload middleware — handles multipart/form-data
const photoUpload = createUploadMiddleware({
  fieldName: 'photo',
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
});

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO ROUTES (SCOPED TO ALBUM)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/albums/:albumId/photos
 * @desc    List all photos in an album (visibility-filtered)
 * @access  Public (if album is public) / Authenticated (if private)
 */
router.get(
  '/:albumId/photos',
  optionalAuth,
  validate(mediaValidator.albumIdParam, 'params'),
  validate(mediaValidator.listPhotos, 'query'),
  photoController.list
);

/**
 * @route   POST /api/v1/albums/:albumId/photos
 * @desc    Upload a photo to an album
 * @access  Authenticated — Contributor+ role
 */
router.post(
  '/:albumId/photos',
  authenticate,
  photoUpload.single('photo'),
  validate(mediaValidator.albumIdParam, 'params'),
  photoController.upload
);

module.exports = router;
