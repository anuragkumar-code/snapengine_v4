'use strict';

const Joi = require('joi');
const { PHOTO_VISIBILITY, PHOTO_STATUS } = require('../../../shared/constants');

/**
 * Media Validators
 * Covers: photo upload, visibility, tags, comments
 */

// ── Photo ──────────────────────────────────────────────────────────────────
const listPhotos = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...Object.values(PHOTO_STATUS)).optional(),
  tags: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().min(1).max(100)),
      Joi.string().trim().min(1).max(100)
    )
    .optional(),
});

const updatePhotoVisibility = Joi.object({
  visibilityType: Joi.string()
    .valid(...Object.values(PHOTO_VISIBILITY))
    .required()
    .messages({
      'any.only': `Visibility type must be one of: ${Object.values(PHOTO_VISIBILITY).join(', ')}`,
    }),

  allowedUserIds: Joi.array()
    .items(Joi.string().uuid())
    .default([])
    .when('visibilityType', {
      is: PHOTO_VISIBILITY.RESTRICTED,
      then: Joi.array().min(1).required()
        .messages({ 'array.min': 'At least one user must be specified for restricted photos' }),
      otherwise: Joi.array().max(0)
        .messages({ 'array.max': 'allowedUserIds should only be provided for restricted photos' }),
    }),
});

const photoIdParam = Joi.object({
  photoId: Joi.string().uuid().required(),
});

const albumIdParam = Joi.object({
  albumId: Joi.string().uuid().required(),
});

// ── Tag ────────────────────────────────────────────────────────────────────
const tagPhoto = Joi.object({
  tags: Joi.array()
    .items(Joi.string().trim().min(1).max(100))
    .min(1)
    .max(10)
    .required()
    .messages({
      'array.min': 'At least one tag is required',
      'array.max': 'Maximum 10 tags per request',
    }),
});

const untagPhoto = Joi.object({
  tagId: Joi.string().uuid().required(),
});

const tagAutocomplete = Joi.object({
  q: Joi.string().trim().min(2).max(100).required()
    .messages({ 'string.min': 'Query must be at least 2 characters' }),
});

const searchByTag = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  albumId: Joi.string().uuid().optional(),
});

const tagSlugParam = Joi.object({
  slug: Joi.string().trim().min(1).max(100).required(),
});

// ── Comment ────────────────────────────────────────────────────────────────
const addComment = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required()
    .messages({
      'string.empty': 'Comment content is required',
      'string.max': 'Comment cannot exceed 5000 characters',
    }),

  parentId: Joi.string().uuid().allow(null).optional()
    .messages({ 'string.guid': 'parentId must be a valid UUID' }),
});

const editComment = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required()
    .messages({ 'string.empty': 'Comment content is required' }),
});

const listComments = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const commentIdParam = Joi.object({
  commentId: Joi.string().uuid().required(),
});

// ── Bulk Operations ────────────────────────────────────────────────────────
const bulkDeletePhotos = Joi.object({
  photoIds: Joi.array()
    .items(Joi.string().uuid())
    .min(1)
    .max(100)
    .required()
    .messages({
      'array.min': 'At least one photo ID is required',
      'array.max': 'Cannot delete more than 100 photos at once',
    }),
});

const bulkChangeVisibility = Joi.object({
  photoIds: Joi.array()
    .items(Joi.string().uuid())
    .min(1)
    .max(100)
    .required()
    .messages({
      'array.min': 'At least one photo ID is required',
      'array.max': 'Cannot update more than 100 photos at once',
    }),

  visibilityType: Joi.string()
    .valid(...Object.values(PHOTO_VISIBILITY))
    .required()
    .messages({
      'any.only': `Visibility type must be one of: ${Object.values(PHOTO_VISIBILITY).join(', ')}`,
    }),

  allowedUserIds: Joi.array()
    .items(Joi.string().uuid())
    .default([])
    .when('visibilityType', {
      is: PHOTO_VISIBILITY.RESTRICTED,
      then: Joi.array().min(1).required().messages({
        'array.min': 'At least one user must be specified for restricted photos',
      }),
      otherwise: Joi.array().max(0).messages({
        'array.max': 'allowedUserIds should only be provided for restricted photos',
      }),
    }),
});

module.exports = {
  listPhotos,
  updatePhotoVisibility,
  photoIdParam,
  albumIdParam,
  tagPhoto,
  untagPhoto,
  tagAutocomplete,
  searchByTag,
  tagSlugParam,
  addComment,
  editComment,
  listComments,
  commentIdParam,
  bulkDeletePhotos,
  bulkChangeVisibility,
};