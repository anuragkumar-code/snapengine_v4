'use strict';

const { Router } = require('express');
const photoController = require('../controller/photo.controller');
const photoBulkController = require('../controller/photobulk.controller');
const mediaController = require('../controller/media.controller');
const { authenticate, optionalAuth } = require('../../../shared/middleware/authenticate');
const { validate } = require('../../../shared/middleware/validate');
const { createUploadMiddleware } = require('../../infrastructure/upload');
const mediaValidator = require('../validators/media.validator');

/**
 * Media Routes
 * Base path: /api/v1/albums/:albumId/photos
 *
 * Photos are ALWAYS scoped to an album.
 * Standalone photo routes (by photoId) are under /api/v1/photos.
 *
 * Tags and Comments are also accessible here for convenience.
 */

const router = Router();

// Photo upload middleware — handles both single and multiple files
const photoUploadSingle = createUploadMiddleware({
  fieldName: 'photo',
  maxSize: 10 * 1024 * 1024, // 10MB per file
  allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
});

const photoUploadMultiple = createUploadMiddleware({
  fieldName: 'photos',
  maxSize: 10 * 1024 * 1024, // 10MB per file
  maxCount: 20,               // Max 20 files
  allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
});

// Combined middleware that tries multiple field first, falls back to single
const photoUpload = (req, res, next) => {
  // Try multi-file upload first
  photoUploadMultiple.array('photos')(req, res, (err) => {
    if (!err && req.files && req.files.length > 0) {
      // Multi-file upload succeeded
      return next();
    }
    
    // Try single-file upload
    photoUploadSingle.single('photo')(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO ROUTES (scoped to album)
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
 * @desc    Upload photo(s) to an album (supports single or multiple files)
 * @access  Authenticated — Contributor+ role
 * @body    Single: { photo: <file> } | Bulk: { photos: [<file1>, <file2>, ...] }
 */
router.post(
  '/:albumId/photos',
  authenticate,
  photoUpload,
  validate(mediaValidator.albumIdParam, 'params'),
  photoController.upload
);

/**
 * @route   POST /api/v1/albums/:albumId/photos/bulk-delete
 * @desc    Bulk delete photos (move to trash)
 * @access  Authenticated — Uploader or Album Admin+
 */
router.post(
  '/:albumId/photos/bulk-delete',
  authenticate,
  validate(mediaValidator.albumIdParam, 'params'),
  validate(mediaValidator.bulkDeletePhotos, 'body'),
  photoBulkController.bulkDelete
);

/**
 * @route   POST /api/v1/albums/:albumId/photos/bulk-visibility
 * @desc    Bulk change photo visibility
 * @access  Authenticated — Uploader or Album Admin+
 */
router.post(
  '/:albumId/photos/bulk-visibility',
  authenticate,
  validate(mediaValidator.albumIdParam, 'params'),
  validate(mediaValidator.bulkChangeVisibility, 'body'),
  photoBulkController.bulkChangeVisibility
);

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO ROUTES (by photoId — standalone)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/photos/:photoId
 * @desc    Get single photo by ID (visibility check applied)
 * @access  Public (if visible) / Authenticated (if restricted/hidden)
 */
router.get(
  '/photos/:photoId',
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
  '/photos/:photoId/visibility',
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
  '/photos/:photoId',
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
  '/photos/:photoId/restore',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  photoController.restore
);

// ═══════════════════════════════════════════════════════════════════════════
// TAG ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/tags/autocomplete
 * @desc    Tag autocomplete search
 * @access  Public
 */
router.get(
  '/tags/autocomplete',
  validate(mediaValidator.tagAutocomplete, 'query'),
  mediaController.tagAutocomplete
);

/**
 * @route   GET /api/v1/tags/popular
 * @desc    List popular tags (by usage count)
 * @access  Public
 */
router.get('/tags/popular', mediaController.listPopularTags);

/**
 * @route   GET /api/v1/tags/:slug/photos
 * @desc    Search photos by tag (visibility-filtered)
 * @access  Public / Authenticated
 */
router.get(
  '/tags/:slug/photos',
  optionalAuth,
  validate(mediaValidator.tagSlugParam, 'params'),
  validate(mediaValidator.searchByTag, 'query'),
  mediaController.searchByTag
);

/**
 * @route   POST /api/v1/photos/:photoId/tags
 * @desc    Add tags to a photo
 * @access  Authenticated — Uploader or Album Contributor+
 */
router.post(
  '/photos/:photoId/tags',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  validate(mediaValidator.tagPhoto, 'body'),
  mediaController.tagPhoto
);

/**
 * @route   DELETE /api/v1/photos/:photoId/tags
 * @desc    Remove a tag from a photo
 * @access  Authenticated — Uploader or Album Contributor+
 */
router.delete(
  '/photos/:photoId/tags',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  validate(mediaValidator.untagPhoto, 'body'),
  mediaController.untagPhoto
);

// ═══════════════════════════════════════════════════════════════════════════
// COMMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/photos/:photoId/comments
 * @desc    List all comments for a photo (threaded)
 * @access  Public (if photo is visible) / Authenticated (if restricted)
 */
router.get(
  '/photos/:photoId/comments',
  optionalAuth,
  validate(mediaValidator.photoIdParam, 'params'),
  validate(mediaValidator.listComments, 'query'),
  mediaController.listComments
);

/**
 * @route   POST /api/v1/photos/:photoId/comments
 * @desc    Add a comment or reply to a photo
 * @access  Authenticated — Album Contributor+
 */
router.post(
  '/photos/:photoId/comments',
  authenticate,
  validate(mediaValidator.photoIdParam, 'params'),
  validate(mediaValidator.addComment, 'body'),
  mediaController.addComment
);

/**
 * @route   PATCH /api/v1/comments/:commentId
 * @desc    Edit a comment (author only, within 5 min)
 * @access  Authenticated — Comment Author
 */
router.patch(
  '/comments/:commentId',
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
  '/comments/:commentId',
  authenticate,
  validate(mediaValidator.commentIdParam, 'params'),
  mediaController.deleteComment
);

module.exports = router;
