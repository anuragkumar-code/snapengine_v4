'use strict';

const { Router } = require('express');
const searchController = require('./search.controller');
const { optionalAuth } = require('../../shared/middleware/authenticate');
const { validate } = require('../../shared/middleware/validate');
const searchValidator = require('./validators/search.validator');

/**
 * Search Routes
 * Base path: /api/v1/search
 *
 * Single unified search endpoint with context switching.
 *
 * Examples:
 *  GET /api/v1/search?q=sunset&context=albums
 *  GET /api/v1/search?q=sunset&context=photos&albumId=uuid
 *  GET /api/v1/search?q=sunset&context=photos  (cross-album)
 */

const router = Router();

/**
 * @route   GET /api/v1/search
 * @desc    Unified search across albums and photos
 * @access  Public (enriched if authenticated)
 * @query   q - search query
 * @query   context - 'albums' | 'photos'
 * @query   albumId - (optional) for photo search within album
 * @query   dateFrom, dateTo - (optional) date range filters
 * @query   page, limit - pagination
 */
router.get(
  '/',
  optionalAuth,
  validate(searchValidator.searchQuery, 'query'),
  searchController.search
);

module.exports = router;