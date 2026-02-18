'use strict';

const tagService = require('./service/tag.service');
const commentService = require('./service/comment.service');
const ResponseFormatter = require('../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../shared/utils/pagination');

// ═══════════════════════════════════════════════════════════════════════════
// TAG CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

const tagAutocomplete = async (req, res, next) => {
  try {
    const tags = await tagService.autocomplete(req.query.q);
    return ResponseFormatter.success(res, { tags });
  } catch (err) {
    next(err);
  }
};

const tagPhoto = async (req, res, next) => {
  try {
    const tags = await tagService.tagPhoto(
      req.params.photoId,
      req.body.tags,
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.success(res, { tags }, 200, 'Tags added');
  } catch (err) {
    next(err);
  }
};

const untagPhoto = async (req, res, next) => {
  try {
    await tagService.untagPhoto(
      req.params.photoId,
      req.body.tagId,
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

const searchByTag = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const userId = req.user?.id || null;

    const result = await tagService.searchPhotosByTag(
      req.params.slug,
      userId,
      req.user?.role,
      { page, limit, albumId: req.query.albumId }
    );

    return ResponseFormatter.success(res, {
      tag: result.tag,
      photos: result.photos,
      pagination: buildMeta(result.total, page, limit),
    });
  } catch (err) {
    next(err);
  }
};

const listPopularTags = async (req, res, next) => {
  try {
    const tags = await tagService.listPopularTags({ limit: 20 });
    return ResponseFormatter.success(res, { tags });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// COMMENT CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

const addComment = async (req, res, next) => {
  try {
    const comment = await commentService.addComment(
      req.params.photoId,
      req.body.content,
      req.body.parentId || null,
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.created(res, { comment }, 'Comment added');
  } catch (err) {
    next(err);
  }
};

const listComments = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const userId = req.user?.id || null;

    const result = await commentService.listComments(
      req.params.photoId,
      userId,
      req.user?.role,
      { page, limit }
    );

    return ResponseFormatter.paginated(result.comments, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

const editComment = async (req, res, next) => {
  try {
    const comment = await commentService.editComment(
      req.params.commentId,
      req.body.content,
      req.user.id
    );
    return ResponseFormatter.success(res, { comment }, 200, 'Comment updated');
  } catch (err) {
    next(err);
  }
};

const deleteComment = async (req, res, next) => {
  try {
    await commentService.deleteComment(req.params.commentId, req.user.id, req.user.role);
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // Tag
  tagAutocomplete,
  tagPhoto,
  untagPhoto,
  searchByTag,
  listPopularTags,
  // Comment
  addComment,
  listComments,
  editComment,
  deleteComment,
};