'use strict';

const { Router } = require('express');
const trashController = require('./controller/trash.controller');
const { authenticate } = require('../../../shared/middleware/authenticate');
const { validate } = require('../../../shared/middleware/validate');
const Joi = require('joi');

/**
 * Trash Routes
 * Base path: /api/v1/trash
 *
 * All trash operations require authentication.
 * Users can only view/manage their own trashed items.
 */

const router = Router();

const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  albumId: Joi.string().uuid().optional(),
});

const emptyTrashParam = Joi.object({
  type: Joi.string().valid('albums', 'photos').required(),
});

/**
 * @route   GET /api/v1/trash/albums
 * @desc    List user's trashed albums
 * @access  Authenticated
 */
router.get(
  '/albums',
  authenticate,
  validate(listQuery, 'query'),
  trashController.listTrashedAlbums
);

/**
 * @route   GET /api/v1/trash/photos
 * @desc    List user's trashed photos
 * @access  Authenticated
 */
router.get(
  '/photos',
  authenticate,
  validate(listQuery, 'query'),
  trashController.listTrashedPhotos
);

/**
 * @route   DELETE /api/v1/trash/:type
 * @desc    Empty trash (permanently delete all albums or photos)
 * @access  Authenticated
 * @param   type - 'albums' or 'photos'
 */
router.delete(
  '/:type',
  authenticate,
  validate(emptyTrashParam, 'params'),
  trashController.emptyTrash
);

module.exports = router;