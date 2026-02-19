'use strict';

const trashService = require('../service/trash.service');
const ResponseFormatter = require('../../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../../shared/utils/pagination');

/**
 * Trash Controller
 * Manages soft-deleted albums and photos.
 */

const listTrashedAlbums = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await trashService.listTrashedAlbums(req.user.id, { page, limit });
    return ResponseFormatter.paginated(res, result.albums, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

const listTrashedPhotos = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await trashService.listTrashedPhotos(req.user.id, {
      page,
      limit,
      albumId: req.query.albumId,
    });
    return ResponseFormatter.paginated(res, result.photos, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

const emptyTrash = async (req, res, next) => {
  try {
    const { type } = req.params; // 'albums' or 'photos'
    const result = await trashService.emptyTrash(req.user.id, type);
    return ResponseFormatter.success(
      res,
      result,
      200,
      `Permanently deleted ${result.deletedCount} ${type}`
    );
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listTrashedAlbums,
  listTrashedPhotos,
  emptyTrash,
};