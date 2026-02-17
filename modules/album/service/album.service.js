'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../../../infrastructure/database');
const permissionService = require('./albumPermission.service');
const activityLogService = require('./albumActivityLog.service');
const {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../shared/utils/AppError');
const {
  ALBUM_ROLE,
  ALBUM_VISIBILITY,
  ACTIVITY_TYPE,
} = require('../../../shared/constants');
const logger = require('../../../infrastructure/logger');

/**
 * Album Service
 *
 * Owns all business logic for album lifecycle.
 * Permission checks are ALWAYS delegated to AlbumPermissionService —
 * never inline here.
 *
 * Service flow pattern:
 *  1. Assert permission (throws if denied)
 *  2. Execute DB operation (inside transaction where needed)
 *  3. Log activity
 *  4. Return safe payload
 */

// ── Create Album ───────────────────────────────────────────────────────────
/**
 * Create a new album. Creator automatically becomes owner member.
 *
 * @param {object} data - Validated album fields
 * @param {string} userId - Creator's user ID
 * @param {string} ipAddress
 * @returns {object} Safe album JSON
 */
const createAlbum = async (data, userId, ipAddress) => {
  const { Album, AlbumMember } = db;

  const t = await db.sequelize.transaction();
  try {
    // Generate publicToken immediately if album is public
    const publicToken = data.isPublic ? crypto.randomBytes(32).toString('hex') : null;

    const album = await Album.create(
      {
        ownerId: userId,
        name: data.name,
        description: data.description || null,
        date: data.date || null,
        isPublic: data.isPublic || false,
        publicToken,
        metadata: data.metadata || {},
      },
      { transaction: t }
    );

    // Owner membership is created automatically — cannot be removed
    await AlbumMember.create(
      {
        albumId: album.id,
        userId,
        role: ALBUM_ROLE.OWNER,
        addedById: userId,
      },
      { transaction: t }
    );

    await t.commit();

    await activityLogService.logActivity({
      albumId: album.id,
      actorId: userId,
      type: ACTIVITY_TYPE.ALBUM_CREATED,
      targetId: album.id,
      targetType: 'album',
      metadata: { name: album.name, isPublic: album.isPublic },
      ipAddress,
    });

    logger.info('[AlbumService] Album created', { albumId: album.id, ownerId: userId });
    return album.toSafeJSON();
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ── Get Album ──────────────────────────────────────────────────────────────
/**
 * Fetch a single album with access control applied.
 * Public albums return to anyone. Private albums require membership.
 */
const getAlbum = async (albumId, userId, systemRole) => {
  // resolveAlbumAccess throws if no access
  const { album } = await permissionService.resolveAlbumAccess(albumId, userId, systemRole);
  return album.toSafeJSON();
};

// ── List Albums ────────────────────────────────────────────────────────────
/**
 * List albums visible to the requesting user.
 *  - Public albums: visible to everyone
 *  - Private albums: only visible if user is a member
 *
 * @param {string|null} userId
 * @param {object} options - { page, limit, ownerId }
 */
const listAlbums = async (userId, { page = 1, limit = 20, ownerId } = {}) => {
  const { Album, AlbumMember } = db;
  const offset = (page - 1) * limit;

  let where = {};

  if (ownerId) {
    // Viewing a specific user's albums
    if (userId === ownerId) {
      // Own albums — show all (public + private)
      where.ownerId = ownerId;
    } else {
      // Another user's albums — show only public
      where = { ownerId, isPublic: true };
    }
  } else if (userId) {
    // Feed: public albums + private albums user is a member of
    const memberships = await AlbumMember.findAll({
      where: { userId },
      attributes: ['albumId'],
    });
    const memberAlbumIds = memberships.map((m) => m.albumId);

    where = {
      [Op.or]: [
        { isPublic: true },
        { id: { [Op.in]: memberAlbumIds } },
      ],
    };
  } else {
    // Unauthenticated: public only
    where.isPublic = true;
  }

  const { rows, count } = await Album.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: db.User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
    ],
  });

  return {
    albums: rows.map((a) => a.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

// ── Update Album ───────────────────────────────────────────────────────────
/**
 * Update album properties. Handles visibility transitions.
 *
 * Visibility transition rules:
 *  - Private → Public  : generate publicToken
 *  - Public  → Private : nullify publicToken (disables public URL immediately)
 */
const updateAlbum = async (albumId, data, userId, systemRole, ipAddress) => {
  await permissionService.assertPermission(albumId, userId, 'album:edit', systemRole);

  const { Album } = db;
  const album = await Album.findByPk(albumId);

  const updates = {};
  const before = {};
  const activityMeta = {};

  if (data.name !== undefined) {
    before.name = album.name;
    updates.name = data.name;
  }
  if (data.description !== undefined) {
    before.description = album.description;
    updates.description = data.description;
  }
  if (data.date !== undefined) {
    before.date = album.date;
    updates.date = data.date;
  }

  // ── Visibility transition ──────────────────────────────────────────
  if (data.isPublic !== undefined && data.isPublic !== album.isPublic) {
    before.isPublic = album.isPublic;
    updates.isPublic = data.isPublic;

    if (data.isPublic === true) {
      // Becoming public — generate public token
      updates.publicToken = crypto.randomBytes(32).toString('hex');
      activityMeta.visibilityChange = 'private_to_public';
    } else {
      // Becoming private — disable public URL immediately
      updates.publicToken = null;
      activityMeta.visibilityChange = 'public_to_private';
    }
  }

  await album.update(updates);

  const activityType =
    activityMeta.visibilityChange
      ? ACTIVITY_TYPE.ALBUM_VISIBILITY_CHANGED
      : ACTIVITY_TYPE.ALBUM_UPDATED;

  await activityLogService.logActivity({
    albumId,
    actorId: userId,
    type: activityType,
    targetId: albumId,
    targetType: 'album',
    metadata: { before, after: updates, ...activityMeta },
    ipAddress,
  });

  logger.info('[AlbumService] Album updated', { albumId, updatedBy: userId });
  return album.toSafeJSON();
};

// ── Soft Delete Album ──────────────────────────────────────────────────────
/**
 * Soft delete — only owner can delete.
 */
const deleteAlbum = async (albumId, userId, systemRole, ipAddress) => {
  await permissionService.assertPermission(albumId, userId, 'album:delete', systemRole);

  const { Album } = db;
  const album = await Album.findByPk(albumId);

  // Disable public URL before soft delete
  if (album.publicToken) {
    await album.update({ publicToken: null, isPublic: false });
  }

  await album.destroy(); // paranoid: sets deletedAt

  await activityLogService.logActivity({
    albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.ALBUM_DELETED,
    targetId: albumId,
    targetType: 'album',
    metadata: { name: album.name },
    ipAddress,
  });

  logger.info('[AlbumService] Album soft-deleted', { albumId, deletedBy: userId });
};

// ── Restore Album ──────────────────────────────────────────────────────────
/**
 * Restore soft-deleted album. Owner or system admin only.
 */
const restoreAlbum = async (albumId, userId, systemRole, ipAddress) => {
  const { Album } = db;

  const album = await Album.findOne({ where: { id: albumId }, paranoid: false });
  if (!album) throw new NotFoundError('Album');
  if (!album.deletedAt) throw new ConflictError('Album is not deleted');

  // Only owner or system admin can restore
  if (album.ownerId !== userId && systemRole !== 'admin') {
    throw new ForbiddenError('Only the album owner can restore this album');
  }

  await album.restore();

  await activityLogService.logActivity({
    albumId,
    actorId: userId,
    type: ACTIVITY_TYPE.ALBUM_RESTORED,
    targetId: albumId,
    targetType: 'album',
    metadata: { name: album.name },
    ipAddress,
  });

  logger.info('[AlbumService] Album restored', { albumId, restoredBy: userId });
  return album.toSafeJSON();
};

// ── Get Album by Public Token ──────────────────────────────────────────────
/**
 * Resolve a public album by its shareToken.
 * Returns 404 if album is now private (publicToken was nullified).
 */
const getAlbumByPublicToken = async (token) => {
  const { Album, User } = db;

  const album = await Album.findOne({
    where: { publicToken: token, isPublic: true },
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
    ],
  });

  if (!album) {
    throw new NotFoundError('Album');
  }

  return album.toSafeJSON();
};

module.exports = {
  createAlbum,
  getAlbum,
  listAlbums,
  updateAlbum,
  deleteAlbum,
  restoreAlbum,
  getAlbumByPublicToken,
};