'use strict';

const db = require('../../infrastructure/database');
const { Op } = require('sequelize');
const albumPermissionService = require('../album/service/albumPermission.service');
const photoVisibilityService = require('../media/service/photoVisibility.service');
const { NotFoundError } = require('../../shared/utils/AppError');
const logger = require('../../infrastructure/logger');

/**
 * SearchService
 *
 * Unified search across albums and photos.
 * Context-aware: switches behavior based on search context.
 *
 * Three search modes:
 *  1. Album search (context=albums)
 *  2. Photo search within album (context=photos + albumId)
 *  3. Global photo search (context=photos, no albumId)
 *
 * Security:
 *  - Album search: respects album visibility (public + member albums)
 *  - Photo search: enforces photoVisibilityService filters
 *  - All queries visibility-filtered — no data leakage
 */

// ── 1. ALBUM SEARCH ────────────────────────────────────────────────────────
/**
 * Search albums by name, description, or owner.
 * Uses PostgreSQL full-text search + ILIKE for fuzzy matching.
 *
 * @param {string} query - Search query string
 * @param {string|null} userId - Current user ID
 * @param {object} options - { page, limit, dateFrom, dateTo }
 */
const searchAlbums = async (query, userId, { page = 1, limit = 20, dateFrom, dateTo } = {}) => {
  const { Album, AlbumMember, User } = db;
  const offset = (page - 1) * limit;

  // ── Build WHERE clause ─────────────────────────────────────────────────
  const searchConditions = [];

  if (query && query.trim()) {
    const searchTerm = query.trim();
    
    // Fuzzy match on name and description
    searchConditions.push({
      [Op.or]: [
        { name: { [Op.iLike]: `%${searchTerm}%` } },
        { description: { [Op.iLike]: `%${searchTerm}%` } },
      ],
    });
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const dateFilter = {};
    if (dateFrom) dateFilter[Op.gte] = dateFrom;
    if (dateTo) dateFilter[Op.lte] = dateTo;
    searchConditions.push({ date: dateFilter });
  }

  // ── Visibility filter ──────────────────────────────────────────────────
  let visibilityWhere = {};

  if (userId) {
    // Show: public albums + private albums user is member of
    const memberships = await AlbumMember.findAll({
      where: { userId },
      attributes: ['albumId'],
    });
    const memberAlbumIds = memberships.map((m) => m.albumId);

    visibilityWhere = {
      [Op.or]: [
        { isPublic: true },
        { id: { [Op.in]: memberAlbumIds } },
      ],
    };
  } else {
    // Unauthenticated: only public albums
    visibilityWhere = { isPublic: true };
  }

  // ── Combine filters ────────────────────────────────────────────────────
  const where = {
    [Op.and]: [
      visibilityWhere,
      ...(searchConditions.length > 0 ? [{ [Op.and]: searchConditions }] : []),
    ],
  };

  const { rows, count } = await Album.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
    ],
    limit,
    offset,
    order: [['createdAt', 'DESC']],
  });

  return {
    results: rows.map((a) => a.toSafeJSON()),
    total: count,
    page,
    limit,
    query,
    context: 'albums',
  };
};

// ── 2. PHOTO SEARCH (WITHIN ALBUM) ─────────────────────────────────────────
/**
 * Search photos within a specific album.
 * Searches by: tags, filename, upload date.
 *
 * @param {string} query - Search query
 * @param {string} albumId - Album to search within
 * @param {string|null} userId - Current user ID
 * @param {string} systemRole - User's system role
 * @param {object} options - { page, limit, dateFrom, dateTo }
 */
const searchPhotosInAlbum = async (
  query,
  albumId,
  userId,
  systemRole,
  { page = 1, limit = 20, dateFrom, dateTo } = {}
) => {
  const { Photo, Album, User, Tag } = db;
  const offset = (page - 1) * limit;

  // ── Album access check ─────────────────────────────────────────────────
  const album = await Album.findByPk(albumId);
  if (!album) throw new NotFoundError('Album');

  await albumPermissionService.assertPermission(albumId, userId, 'album:view', systemRole);

  // ── Build search WHERE clause ──────────────────────────────────────────
  const searchConditions = [];

  if (query && query.trim()) {
    const searchTerm = query.trim();

    // Search by filename OR tags
    searchConditions.push({
      [Op.or]: [
        { originalFilename: { [Op.iLike]: `%${searchTerm}%` } },
        // Tag search via subquery
        {
          id: {
            [Op.in]: db.sequelize.literal(`(
              SELECT pt.photo_id 
              FROM photo_tags pt 
              JOIN tags t ON pt.tag_id = t.id 
              WHERE t.name ILIKE '%${searchTerm.replace(/'/g, "''")}%'
            )`),
          },
        },
      ],
    });
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const dateFilter = {};
    if (dateFrom) dateFilter[Op.gte] = dateFrom;
    if (dateTo) dateFilter[Op.lte] = dateTo;
    searchConditions.push({ createdAt: dateFilter });
  }

  // ── Visibility filter ──────────────────────────────────────────────────
  const visibilityWhere = photoVisibilityService.buildVisibilityFilter(userId, album.ownerId);

  // ── Combine filters ────────────────────────────────────────────────────
  const where = {
    albumId,
    ...visibilityWhere,
    ...(searchConditions.length > 0 ? { [Op.and]: searchConditions } : {}),
  };

  const { rows, count } = await Photo.findAndCountAll({
    where,
    include: [
      photoVisibilityService.buildVisibilityInclude(userId),
      {
        model: User,
        as: 'uploadedBy',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
      {
        model: Tag,
        as: 'tags',
        attributes: ['id', 'name', 'slug'],
        through: { attributes: [] },
      },
    ],
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    distinct: true,
  });

  return {
    results: rows.map((p) => p.toSafeJSON()),
    total: count,
    page,
    limit,
    query,
    context: 'photos',
    albumId,
  };
};

// ── 3. GLOBAL PHOTO SEARCH (CROSS-ALBUM) ───────────────────────────────────
/**
 * Search photos across ALL albums user has access to.
 * Most useful for tag-based search.
 *
 * @param {string} query - Search query
 * @param {string|null} userId - Current user ID
 * @param {string} systemRole - User's system role
 * @param {object} options - { page, limit, dateFrom, dateTo }
 */
const searchPhotosGlobal = async (
  query,
  userId,
  systemRole,
  { page = 1, limit = 20, dateFrom, dateTo } = {}
) => {
  const { Photo, Album, AlbumMember, User, Tag } = db;
  const offset = (page - 1) * limit;

  // ── Get accessible album IDs ───────────────────────────────────────────
  let accessibleAlbumIds;

  if (userId) {
    const memberships = await AlbumMember.findAll({
      where: { userId },
      attributes: ['albumId'],
    });
    const memberAlbumIds = memberships.map((m) => m.albumId);

    const publicAlbums = await Album.findAll({
      where: { isPublic: true },
      attributes: ['id'],
    });
    const publicAlbumIds = publicAlbums.map((a) => a.id);

    // Combine: user's albums + public albums
    accessibleAlbumIds = [...new Set([...memberAlbumIds, ...publicAlbumIds])];
  } else {
    // Unauthenticated: only public albums
    const publicAlbums = await Album.findAll({
      where: { isPublic: true },
      attributes: ['id'],
    });
    accessibleAlbumIds = publicAlbums.map((a) => a.id);
  }

  if (accessibleAlbumIds.length === 0) {
    return {
      results: [],
      total: 0,
      page,
      limit,
      query,
      context: 'photos',
    };
  }

  // ── Build search WHERE clause ──────────────────────────────────────────
  const searchConditions = [];

  if (query && query.trim()) {
    const searchTerm = query.trim();

    searchConditions.push({
      [Op.or]: [
        { originalFilename: { [Op.iLike]: `%${searchTerm}%` } },
        // Tag search
        {
          id: {
            [Op.in]: db.sequelize.literal(`(
              SELECT pt.photo_id 
              FROM photo_tags pt 
              JOIN tags t ON pt.tag_id = t.id 
              WHERE t.name ILIKE '%${searchTerm.replace(/'/g, "''")}%'
            )`),
          },
        },
      ],
    });
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const dateFilter = {};
    if (dateFrom) dateFilter[Op.gte] = dateFrom;
    if (dateTo) dateFilter[Op.lte] = dateTo;
    searchConditions.push({ createdAt: dateFilter });
  }

  // ── Visibility filter ──────────────────────────────────────────────────
  // For cross-album search, we simplify: only show ALBUM_DEFAULT photos
  // (RESTRICTED/HIDDEN require per-album owner checks, too complex for cross-album)
  const where = {
    albumId: { [Op.in]: accessibleAlbumIds },
    visibilityType: 'album_default',
    ...(searchConditions.length > 0 ? { [Op.and]: searchConditions } : {}),
  };

  const { rows, count } = await Photo.findAndCountAll({
    where,
    include: [
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
      {
        model: Tag,
        as: 'tags',
        attributes: ['id', 'name', 'slug'],
        through: { attributes: [] },
      },
    ],
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    distinct: true,
  });

  return {
    results: rows.map((p) => p.toSafeJSON()),
    total: count,
    page,
    limit,
    query,
    context: 'photos',
  };
};

module.exports = {
  searchAlbums,
  searchPhotosInAlbum,
  searchPhotosGlobal,
};