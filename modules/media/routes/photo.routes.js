'use strict';

const { Router } = require('express');
const photoController = require('../controller/photo.controller');

const { authenticate, optionalAuth } = require('../../../shared/middleware/authenticate');
const { validate } = require('../../../shared/middleware/validate');
const mediaValidator = require('../validators/media.validator');

/**
 * Photo Routes (Standalone)
 * Base path: /api/v1/photos
 *
 * Handles operations on individual photos.
 * Album-scoped photo listing/upload lives in albumPhoto.routes.js
 */

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO ROUTES (BY PHOTO ID)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/photos/:photoId
 * @desc    Get single photo by ID (visibility check applied)
 * @access  Public (if visible) / Authenticated (if restricted/hidden)
 */
router.get(
  '/:photoId',
  optionalAuth,
  validate(mediaValidator.photoIdParam, 'params'),
  photoController.getOne
);

/**
 * @route   PATCH /api/v1/photos/:photoId/visibility
 * @desc    Change photo visibility type and allowlist
 * @access  Authenticated — Uploader or Album Admin+
 */
router.patch(
  '/:photoId/visibility',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  validate(mediaValidator.updatePhotoVisibility, 'body'),
  photoController.updateVisibility
);

/**
 * @route   DELETE /api/v1/photos/:photoId
 * @desc    Soft delete photo (move to trash)
 * @access  Authenticated — Uploader or Album Admin+
 */
router.delete(
  '/:photoId',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  photoController.remove
);

/**
 * @route   POST /api/v1/photos/:photoId/restore
 * @desc    Restore photo from trash
 * @access  Authenticated — Uploader or Album Owner
 */
router.post(
  '/:photoId/restore',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  photoController.restore
);

module.exports = router;
