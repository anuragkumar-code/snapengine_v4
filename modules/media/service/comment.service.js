'use strict';

const db = require('../../../infrastructure/database');
const albumPermissionService = require('../../album/service/albumPermission.service');
const photoVisibilityService = require('./photoVisibility.service');
const activityLogService = require('../../album/service/albumActivityLog.service');
const { NotFoundError, ForbiddenError, ValidationError } = require('../../../shared/utils/AppError');
const { ACTIVITY_TYPE } = require('../../../shared/constants');
const logger = require('../../../infrastructure/logger');

/**
 * CommentService
 *
 * Threaded comments on photos.
 * Comment visibility INHERITS from photo visibility — no independent access control.
 *
 * Threading:
 *  - Top-level comments: parentId = null
 *  - Replies: parentId = UUID of parent comment
 *  - Max depth: 3 levels (comment → reply → reply-to-reply → hard stop)
 *
 * Permissions:
 *  - Can comment: album contributor+ (checked via album permission)
 *  - Can delete: comment author, album admin+, or photo uploader
 *  - Can edit: comment author only (within 5 minutes of posting)
 */

const MAX_THREAD_DEPTH = 3;

// ── Add Comment ────────────────────────────────────────────────────────────
/**
 * Add a comment or reply to a photo.
 *
 * @param {string} photoId
 * @param {string} content
 * @param {string|null} parentId
 * @param {string} userId
 * @param {string} systemRole
 */
const addComment = async (photoId, content, parentId, userId, systemRole) => {
  const { Photo, Comment, Album } = db;

  // ── Photo visibility check ─────────────────────────────────────────────
  const photo = await Photo.findByPk(photoId, {
    include: [{ model: Album, as: 'album' }],
  });
  if (!photo) throw new NotFoundError('Photo');

  await albumPermissionService.assertPermission(photo.albumId, userId, 'album:view', systemRole);

  const { allowed } = await photoVisibilityService.resolvePhotoVisibility(
    photoId, userId, photo.album.ownerId
  );
  if (!allowed) {
    throw new ForbiddenError('You cannot comment on photos you cannot view');
  }

  // ── Comment permission check ───────────────────────────────────────────
  const canComment = (
    await albumPermissionService.resolvePermission(photo.albumId, userId, 'comment:create', systemRole)
  ).allowed;

  if (!canComment) {
    throw new ForbiddenError('You do not have permission to comment in this album');
  }

  // ── Thread depth check (prevent infinite nesting) ──────────────────────
  if (parentId) {
    const parent = await Comment.findByPk(parentId);
    if (!parent) throw new NotFoundError('Parent comment');
    if (parent.photoId !== photoId) {
      throw new ValidationError('Parent comment must be on the same photo');
    }

    const depth = await _getCommentDepth(parentId);
    if (depth >= MAX_THREAD_DEPTH) {
      throw new ValidationError(`Comment threads cannot exceed ${MAX_THREAD_DEPTH} levels deep`);
    }
  }

  // ── Create comment ─────────────────────────────────────────────────────
  const comment = await Comment.create({
    photoId,
    userId,
    parentId,
    content,
  });

  await activityLogService.logActivity({
    albumId: photo.albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.COMMENT_ADDED,
    targetId: comment.id,
    targetType: 'comment',
    metadata: { photoId, isReply: !!parentId },
  });

  logger.info('[CommentService] Comment added', { commentId: comment.id, photoId, userId });

  return comment.toSafeJSON();
};

// ── List Comments for Photo (threaded) ────────────────────────────────────
/**
 * Fetch all comments for a photo in threaded structure.
 * Returns top-level comments with nested replies.
 *
 * @param {string} photoId
 * @param {string|null} userId
 * @param {string} systemRole
 * @param {object} options - { page, limit }
 */
const listComments = async (photoId, userId, systemRole, { page = 1, limit = 20 } = {}) => {
  const { Photo, Comment, User, Album } = db;

  // ── Photo visibility check ─────────────────────────────────────────────
  const photo = await Photo.findByPk(photoId, {
    include: [{ model: Album, as: 'album' }],
  });
  if (!photo) throw new NotFoundError('Photo');

  await albumPermissionService.assertPermission(photo.albumId, userId, 'album:view', systemRole);

  const { allowed } = await photoVisibilityService.resolvePhotoVisibility(
    photoId, userId, photo.album.ownerId
  );
  if (!allowed) {
    throw new ForbiddenError('You cannot view comments on photos you cannot view');
  }

  const offset = (page - 1) * limit;

  // ── Fetch top-level comments with nested replies ──────────────────────
  const { rows, count } = await Comment.findAndCountAll({
    where: { photoId, parentId: null },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
      {
        model: Comment,
        as: 'replies',
        separate: true, // Prevents Sequelize N+1 — separate query for replies
        order: [['createdAt', 'ASC']],
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
          },
          // Nested replies (max depth = 3)
          {
            model: Comment,
            as: 'replies',
            separate: true,
            order: [['createdAt', 'ASC']],
            include: [
              {
                model: User,
                as: 'user',
                attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
              },
            ],
          },
        ],
      },
    ],
    limit,
    offset,
    order: [['createdAt', 'ASC']],
  });

  return {
    comments: rows.map((c) => c.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

// ── Edit Comment ───────────────────────────────────────────────────────────
const editComment = async (commentId, newContent, userId) => {
  const { Comment } = db;

  const comment = await Comment.findByPk(commentId);
  if (!comment) throw new NotFoundError('Comment');

  // Only author can edit
  if (comment.userId !== userId) {
    throw new ForbiddenError('You can only edit your own comments');
  }

  // Edit window: 5 minutes
  const ageMs = Date.now() - new Date(comment.createdAt).getTime();
  const editWindowMs = 5 * 60 * 1000;
  if (ageMs > editWindowMs) {
    throw new ForbiddenError('Comments can only be edited within 5 minutes of posting');
  }

  await comment.update({
    content: newContent,
    editedAt: new Date(),
  });

  logger.info('[CommentService] Comment edited', { commentId, userId });
  return comment.toSafeJSON();
};

// ── Delete Comment ─────────────────────────────────────────────────────────
const deleteComment = async (commentId, userId, systemRole) => {
  const { Comment, Photo, Album } = db;

  const comment = await Comment.findByPk(commentId, {
    include: [
      {
        model: Photo,
        as: 'photo',
        include: [{ model: Album, as: 'album' }],
      },
    ],
  });
  if (!comment) throw new NotFoundError('Comment');

  // Can delete: author, photo uploader, or album admin+
  const isAuthor = comment.userId === userId;
  const isUploader = comment.photo.uploadedById === userId;
  const canDeleteComments = (
    await albumPermissionService.resolvePermission(
      comment.photo.albumId, userId, 'comment:delete', systemRole
    )
  ).allowed;

  if (!isAuthor && !isUploader && !canDeleteComments) {
    throw new ForbiddenError('You cannot delete this comment');
  }

  await comment.destroy(); // Soft delete

  await activityLogService.logActivity({
    albumId: comment.photo.albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.COMMENT_DELETED,
    targetId: commentId,
    targetType: 'comment',
    metadata: { photoId: comment.photoId, deletedBy: userId },
  });

  logger.info('[CommentService] Comment deleted', { commentId, deletedBy: userId });
};

// ── Helper: Calculate Comment Depth ────────────────────────────────────────
/**
 * Recursively calculate how deep a comment is in the thread.
 * @private
 */
const _getCommentDepth = async (commentId, depth = 1) => {
  const { Comment } = db;
  const comment = await Comment.findByPk(commentId);
  if (!comment || !comment.parentId) return depth;
  return _getCommentDepth(comment.parentId, depth + 1);
};

module.exports = {
  addComment,
  listComments,
  editComment,
  deleteComment,
};