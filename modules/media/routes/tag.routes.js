'use strict';

const { Router } = require('express');
const mediaController = require('../controller/media.controller');

const { optionalAuth } = require('../../../shared/middleware/authenticate');
const { validate } = require('../../../shared/middleware/validate');
const mediaValidator = require('../validators/media.validator');

/**
 * Tag Routes
 * Base path: /api/v1/tags
 *
 * Handles tag discovery and tag-based photo search.
 * Tag-to-photo mutations live under photo.routes.js
 */

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// TAG DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/tags/autocomplete
 * @desc    Tag autocomplete search
 * @access  Public
 */
router.get(
  '/autocomplete',
  validate(mediaValidator.tagAutocomplete, 'query'),
  mediaController.tagAutocomplete
);

/**
 * @route   GET /api/v1/tags/popular
 * @desc    List popular tags (by usage count)
 * @access  Public
 */
router.get(
  '/popular',
  mediaController.listPopularTags
);

// ═══════════════════════════════════════════════════════════════════════════
// TAG-BASED PHOTO SEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/tags/:slug/photos
 * @desc    Search photos by tag (visibility-filtered)
 * @access  Public / Authenticated
 */
router.get(
  '/:slug/photos',
  optionalAuth,
  validate(mediaValidator.tagSlugParam, 'params'),
  validate(mediaValidator.searchByTag, 'query'),
  mediaController.searchByTag
);

module.exports = router;
