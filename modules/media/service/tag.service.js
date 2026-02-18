'use strict';

const db = require('../../../infrastructure/database');
const { Op } = require('sequelize');
const albumPermissionService = require('../../album/service/albumPermission.service');
const photoVisibilityService = require('./photoVisibility.service');
const { NotFoundError, ForbiddenError } = require('../../../shared/utils/AppError');
const logger = require('../../../infrastructure/logger');

/**
 * TagService
 *
 * Manages tags and photo-tag relationships.
 * Tag search MUST respect photo visibility — cannot surface hidden photos via tags.
 *
 * Features:
 *  - Autocomplete (fuzzy search via trigram index)
 *  - Create or reuse existing tags
 *  - Tag photos
 *  - Untag photos
 *  - Search photos by tag (visibility-filtered)
 */

// ── Tag Autocomplete ───────────────────────────────────────────────────────
/**
 * Fuzzy search tags by name for autocomplete.
 * Returns top 10 matches sorted by usage count (popularity).
 *
 * @param {string} query - Partial tag name
 * @returns {Promise<Tag[]>}
 */
const autocomplete = async (query) => {
  const { Tag } = db;

  if (!query || query.trim().length < 2) return [];

  const tags = await Tag.findAll({
    where: {
      name: { [Op.iLike]: `%${query.toLowerCase().trim()}%` },
    },
    order: [
      ['usageCount', 'DESC'],
      ['name', 'ASC'],
    ],
    limit: 10,
    attributes: ['id', 'name', 'slug', 'usageCount'],
  });

  return tags;
};

// ── Get or Create Tag ──────────────────────────────────────────────────────
/**
 * Find existing tag by name or create a new one.
 * Names are case-insensitive and auto-lowercased.
 *
 * @param {string} tagName
 * @returns {Promise<Tag>}
 */
const getOrCreateTag = async (tagName) => {
  const { Tag } = db;

  const normalized = tagName.toLowerCase().trim();

  const [tag, created] = await Tag.findOrCreate({
    where: { name: normalized },
    defaults: {
      name: normalized,
      slug: Tag.slugify(normalized),
      usageCount: 0,
    },
  });

  if (created) {
    logger.info('[TagService] Tag created', { tagId: tag.id, name: tag.name });
  }

  return tag;
};

// ── Tag a Photo ────────────────────────────────────────────────────────────
/**
 * Attach one or more tags to a photo.
 * Only uploader or album admin+ can tag photos.
 *
 * @param {string} photoId
 * @param {string[]} tagNames
 * @param {string} userId
 * @param {string} systemRole
 * @returns {Promise<Tag[]>} Tags that were added
 */
const tagPhoto = async (photoId, tagNames, userId, systemRole) => {
  const { Photo, Tag, PhotoTag } = db;

  const photo = await Photo.findByPk(photoId);
  if (!photo) throw new NotFoundError('Photo');

  // Permission: uploader or album contributor+
  const isUploader = photo.uploadedById === userId;
  const canTag = isUploader ||
    (await albumPermissionService.resolvePermission(
      photo.albumId, userId, 'photo:upload', systemRole
    )).allowed;

  if (!canTag) {
    throw new ForbiddenError('Only the uploader or album contributors can tag photos');
  }

  const t = await db.sequelize.transaction();
  try {
    const addedTags = [];

    for (const tagName of tagNames) {
      const tag = await getOrCreateTag(tagName);

      // Check if already tagged
      const existing = await PhotoTag.findOne({
        where: { photoId, tagId: tag.id },
        transaction: t,
      });

      if (!existing) {
        await PhotoTag.create(
          { photoId, tagId: tag.id, taggedById: userId, source: 'user' },
          { transaction: t }
        );

        // Increment usage count
        await tag.increment('usageCount', { transaction: t });

        addedTags.push(tag);
      }
    }

    await t.commit();

    logger.info('[TagService] Photo tagged', {
      photoId, tagNames: addedTags.map((t) => t.name), userId,
    });

    return addedTags;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ── Untag a Photo ──────────────────────────────────────────────────────────
const untagPhoto = async (photoId, tagId, userId, systemRole) => {
  const { Photo, PhotoTag, Tag } = db;

  const photo = await Photo.findByPk(photoId);
  if (!photo) throw new NotFoundError('Photo');

  const isUploader = photo.uploadedById === userId;
  const canUntag = isUploader ||
    (await albumPermissionService.resolvePermission(
      photo.albumId, userId, 'photo:upload', systemRole
    )).allowed;

  if (!canUntag) {
    throw new ForbiddenError('Only the uploader or album contributors can untag photos');
  }

  const photoTag = await PhotoTag.findOne({ where: { photoId, tagId } });
  if (!photoTag) throw new NotFoundError('Tag not found on this photo');

  const t = await db.sequelize.transaction();
  try {
    await photoTag.destroy({ transaction: t });

    // Decrement usage count
    const tag = await Tag.findByPk(tagId, { transaction: t });
    if (tag && tag.usageCount > 0) {
      await tag.decrement('usageCount', { transaction: t });
    }

    await t.commit();

    logger.info('[TagService] Photo untagged', { photoId, tagId, userId });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ── Search Photos by Tag (visibility-filtered) ─────────────────────────────
/**
 * Find all photos with a given tag, respecting visibility rules.
 * SECURITY CRITICAL: applies visibility filter to prevent leaking hidden photos via tags.
 *
 * @param {string} tagSlug
 * @param {string|null} userId
 * @param {string} systemRole
 * @param {object} options - { page, limit, albumId }
 */
const searchPhotosByTag = async (tagSlug, userId, systemRole, { page = 1, limit = 20, albumId } = {}) => {
  const { Tag, Photo, Album, User, PhotoTag } = db;

  const tag = await Tag.findOne({ where: { slug: tagSlug } });
  if (!tag) throw new NotFoundError('Tag');

  const offset = (page - 1) * limit;

  // ── Build base WHERE clause ────────────────────────────────────────────
  const where = {};
  if (albumId) {
    // Scoped to specific album
    where.albumId = albumId;

    const album = await Album.findByPk(albumId);
    if (!album) throw new NotFoundError('Album');

    // Apply visibility filter for this specific album
    Object.assign(where, photoVisibilityService.buildVisibilityFilter(userId, album.ownerId));
  } else {
    // Cross-album search — visibility is trickier (needs per-album owner check)
    // For now, only return ALBUM_DEFAULT photos across all albums
    // Full cross-album visibility requires JOIN on albums table
    where.visibilityType = 'album_default';
  }

  const include = [
    {
      model: Tag,
      as: 'tags',
      where: { id: tag.id },
      through: { attributes: [] },
    },
    {
      model: Album,
      as: 'album',
      attributes: ['id', 'name', 'isPublic', 'ownerId'],
    },
    {
      model: User,
      as: 'uploadedBy',
      attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
    },
  ];

  if (albumId) {
    include.push(photoVisibilityService.buildVisibilityInclude(userId));
  }

  const { rows, count } = await Photo.findAndCountAll({
    where,
    include,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    distinct: true,
  });

  return {
    photos: rows.map((p) => p.toSafeJSON()),
    tag,
    total: count,
    page,
    limit,
  };
};

// ── List Popular Tags ──────────────────────────────────────────────────────
const listPopularTags = async ({ limit = 20 } = {}) => {
  const { Tag } = db;

  const tags = await Tag.findAll({
    where: { usageCount: { [Op.gt]: 0 } },
    order: [
      ['usageCount', 'DESC'],
      ['name', 'ASC'],
    ],
    limit,
    attributes: ['id', 'name', 'slug', 'usageCount'],
  });

  return tags;
};

module.exports = {
  autocomplete,
  getOrCreateTag,
  tagPhoto,
  untagPhoto,
  searchPhotosByTag,
  listPopularTags,
};