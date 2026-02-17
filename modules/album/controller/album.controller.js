'use strict';

const albumService = require('./service/album.service');
const ResponseFormatter = require('../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../shared/utils/pagination');

/**
 * Album Controller
 * HTTP layer only. Extract from req → call service → format response.
 */

const create = async (req, res, next) => {
  try {
    const album = await albumService.createAlbum(req.body, req.user.id, req.ip);
    return ResponseFormatter.created(res, { album }, 'Album created successfully');
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const userId = req.user?.id || null;
    const album = await albumService.getAlbum(req.params.albumId, userId, req.user?.role);
    return ResponseFormatter.success(res, { album });
  } catch (err) {
    next(err);
  }
};

const list = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const userId = req.user?.id || null;
    const result = await albumService.listAlbums(userId, {
      page,
      limit,
      ownerId: req.query.ownerId,
    });
    return ResponseFormatter.paginated(res, result.albums, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const album = await albumService.updateAlbum(
      req.params.albumId,
      req.body,
      req.user.id,
      req.user.role,
      req.ip
    );
    return ResponseFormatter.success(res, { album }, 200, 'Album updated');
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    await albumService.deleteAlbum(req.params.albumId, req.user.id, req.user.role, req.ip);
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

const restore = async (req, res, next) => {
  try {
    const album = await albumService.restoreAlbum(
      req.params.albumId, req.user.id, req.user.role, req.ip
    );
    return ResponseFormatter.success(res, { album }, 200, 'Album restored');
  } catch (err) {
    next(err);
  }
};

const getByPublicToken = async (req, res, next) => {
  try {
    const album = await albumService.getAlbumByPublicToken(req.params.token);
    return ResponseFormatter.success(res, { album });
  } catch (err) {
    next(err);
  }
};

module.exports = { create, getOne, list, update, remove, restore, getByPublicToken };