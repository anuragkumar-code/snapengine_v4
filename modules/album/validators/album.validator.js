'use strict';

const Joi = require('joi');
const { ALBUM_VISIBILITY } = require('../../../shared/constants');

/**
 * Album Validators
 *
 * All schemas live here — imported and applied directly in routes.
 * Services receive already-validated, sanitized data.
 *
 * Validation middleware (validate) is from shared/middleware/validate.js.
 * Usage in routes:
 *   router.post('/', validate(albumValidators.createAlbum), albumController.create);
 */

const createAlbum = Joi.object({
  name: Joi.string().trim().min(1).max(255).required()
    .messages({ 'string.empty': 'Album name is required' }),

  description: Joi.string().trim().max(2000).allow('', null).optional(),

  date: Joi.date().iso().max('now').allow(null).optional()
    .messages({ 'date.max': 'Album date cannot be in the future' }),

  isPublic: Joi.boolean().default(false),

  metadata: Joi.object().max(20).default({}),
});

const updateAlbum = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(2000).allow('', null).optional(),
  date: Joi.date().iso().max('now').allow(null).optional(),
  isPublic: Joi.boolean().optional(),
  metadata: Joi.object().max(20).optional(),
  coverPhotoId: Joi.string().uuid().allow(null).optional()
    .messages({ 'string.guid': 'coverPhotoId must be a valid UUID' }),
}).min(1).messages({ 'object.min': 'At least one field must be provided for update' });

const listAlbums = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  ownerId: Joi.string().uuid().optional(),
});

const albumIdParam = Joi.object({
  albumId: Joi.string().uuid().required()
    .messages({ 'string.guid': 'albumId must be a valid UUID' }),
});

module.exports = { createAlbum, updateAlbum, listAlbums, albumIdParam };