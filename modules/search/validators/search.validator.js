'use strict';

const Joi = require('joi');

/**
 * Search Validators
 * Single search endpoint with context switching
 */

const searchQuery = Joi.object({
  // Search query string
  q: Joi.string().trim().max(200).optional().allow(''),

  // Search context: albums or photos
  context: Joi.string().valid('albums', 'photos').default('albums'),

  // For photo search within a specific album
  albumId: Joi.string().uuid().optional()
    .when('context', {
      is: 'photos',
      then: Joi.optional(), // Optional — if not provided, does global photo search
      otherwise: Joi.forbidden(), // Not allowed for album search
    }),

  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),

  // Date range filters (for albums: album.date, for photos: photo.createdAt)
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional()
    .messages({ 'date.min': 'dateTo must be after dateFrom' }),
});

module.exports = { searchQuery };