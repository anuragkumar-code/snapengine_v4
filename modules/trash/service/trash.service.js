'use strict';

const db = require('../../../infrastructure/database');
const { parsePagination } = require('../../../shared/utils/pagination');
const { NotFoundError, ForbiddenError } = require('../../../shared/utils/AppError');

/**
 * TrashService
 *
 * Manages soft-deleted (trashed) albums and photos.
 * Only owners/uploaders can view and restore their trashed items.
 *
 * Trash Retention:
 *  - Albums: kept in trash indefinitely until manually hard-deleted (future)
 *  - Photos: kept in trash indefinitely until manually hard-deleted (future)
 *
 * Future: implement auto-purge after 30 days.
 */

// ── List User's Trashed Albums ─────────────────────────────────────────────
/**
 * Get all soft-deleted albums owned by the user.
 *
 * @param {string} userId
 * @param {object} options - { page, limit }
 */
const listTrashedAlbums = async (userId, { page = 1, limit = 20 } = {}) => {
  const { Album, User } = db;
  const offset = (page - 1) * limit;

  const { rows, count } = await Album.scope('withDeleted').findAndCountAll({
    where: {
      ownerId: userId,
      deletedAt: { [db.Sequelize.Op.ne]: null },
    },
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
    ],
    limit,
    offset,
    order: [['deletedAt', 'DESC']],
  });

  return {
    albums: rows.map((a) => a.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

// ── List User's Trashed Photos ─────────────────────────────────────────────
/**
 * Get all soft-deleted photos uploaded by the user.
 * Optionally scoped to a specific album.
 *
 * @param {string} userId
 * @param {object} options - { page, limit, albumId }
 */
const listTrashedPhotos = async (userId, { page = 1, limit = 20, albumId } = {}) => {
  const { Photo, Album } = db;
  const offset = (page - 1) * limit;

  const where = {
    uploadedById: userId,
    deletedAt: { [db.Sequelize.Op.ne]: null },
  };

  if (albumId) {
    where.albumId = albumId;
  }

  const { rows, count } = await Photo.scope('withDeleted').findAndCountAll({
    where,
    include: [
      {
        model: Album,
        as: 'album',
        attributes: ['id', 'name', 'isPublic'],
        paranoid: false, // Include even if album is also deleted
      },
    ],
    limit,
    offset,
    order: [['deletedAt', 'DESC']],
  });

  return {
    photos: rows.map((p) => p.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

// ── Empty Trash (Hard Delete All) ──────────────────────────────────────────
/**
 * Permanently delete all trashed albums or photos for a user.
 * WARNING: This cannot be undone.
 *
 * @param {string} userId
 * @param {'albums'|'photos'} resourceType
 */
const emptyTrash = async (userId, resourceType) => {
  if (resourceType === 'albums') {
    const { Album } = db;
    const albums = await Album.scope('withDeleted').findAll({
      where: {
        ownerId: userId,
        deletedAt: { [db.Sequelize.Op.ne]: null },
      },
    });

    for (const album of albums) {
      await album.destroy({ force: true }); // Hard delete
    }

    return { deletedCount: albums.length };
  } else if (resourceType === 'photos') {
    const { Photo } = db;
    const photos = await Photo.scope('withDeleted').findAll({
      where: {
        uploadedById: userId,
        deletedAt: { [db.Sequelize.Op.ne]: null },
      },
    });

    for (const photo of photos) {
      // TODO: Also delete file from storage (storageKey)
      await photo.destroy({ force: true }); // Hard delete
    }

    return { deletedCount: photos.length };
  }

  throw new Error('Invalid resource type. Must be "albums" or "photos".');
};

module.exports = {
  listTrashedAlbums,
  listTrashedPhotos,
  emptyTrash,
};