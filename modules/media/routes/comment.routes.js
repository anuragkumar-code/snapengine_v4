'use strict';

const { Router } = require('express');
const mediaController = require('../controller/media.controller');

const { authenticate } = require('../../../shared/middleware/authenticate');
const { validate } = require('../../../shared/middleware/validate');
const mediaValidator = require('../validators/media.validator');

/**
 * Comment Routes
 * Base path: /api/v1/comments
 *
 * Handles comment-level operations.
 * Photo-scoped comment listing/creation should live under photo.routes.js
 */

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// COMMENT MUTATION ROUTES (BY COMMENT ID)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   PATCH /api/v1/comments/:commentId
 * @desc    Edit a comment (author only, within time limit)
 * @access  Authenticated — Comment Author
 */
router.patch(
  '/:commentId',
  authenticate,
  validate(mediaValidator.commentIdParam, 'params'),
  validate(mediaValidator.editComment, 'body'),
  mediaController.editComment
);

/**
 * @route   DELETE /api/v1/comments/:commentId
 * @desc    Delete a comment
 * @access  Authenticated — Author, Uploader, or Album Admin+
 */
router.delete(
  '/:commentId',
  authenticate,
  validate(mediaValidator.commentIdParam, 'params'),
  mediaController.deleteComment
);

module.exports = router;
