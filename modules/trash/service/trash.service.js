'use strict';

const db = require('../../../infrastructure/database');
const { NotFoundError, ConflictError } = require('../../../shared/utils/AppError');

/**
 * TrashService
 *
 * Manages soft-deleted (trashed) albums and photos.
 * Users can only view/manage their own trashed items.
 */

const toTrashedAlbumJSON = (album) => {
  const data = album.toSafeJSON();
  return { ...data, deletedAt: album.deletedAt };
};

const toTrashedPhotoJSON = (photo) => {
  const data = photo.toSafeJSON();
  return { ...data, deletedAt: photo.deletedAt };
};

const getOwnedAlbumIds = async (userId) => {
  const { Album } = db;
  const ownedAlbums = await Album.findAll({
    paranoid: false,
    where: { ownerId: userId },
    attributes: ['id'],
  });
  return ownedAlbums.map((a) => a.id);
};

const canManagePhotoTrash = (photo, userId, ownedAlbumIdsSet) => {
  return photo.uploadedById === userId || ownedAlbumIdsSet.has(photo.albumId);
};

/**
 * Get all soft-deleted albums owned by the user.
 */
const listTrashedAlbums = async (userId, { page = 1, limit = 20 } = {}) => {
  const { Album, User } = db;
  const offset = (page - 1) * limit;

  const { rows, count } = await Album.findAndCountAll({
    paranoid: false,
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
    albums: rows.map(toTrashedAlbumJSON),
    total: count,
    page,
    limit,
  };
};

/**
 * Get all soft-deleted photos uploaded by the user.
 * Optionally scoped to a specific album.
 */
const listTrashedPhotos = async (userId, { page = 1, limit = 20, albumId } = {}) => {
  const { Photo, Album } = db;
  const offset = (page - 1) * limit;
  const { Op } = db.Sequelize;
  const ownedAlbumIds = await getOwnedAlbumIds(userId);

  const where = {
    deletedAt: { [db.Sequelize.Op.ne]: null },
    [Op.or]: [
      { uploadedById: userId },
      ...(ownedAlbumIds.length > 0 ? [{ albumId: { [Op.in]: ownedAlbumIds } }] : []),
    ],
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
        paranoid: false,
      },
    ],
    limit,
    offset,
    order: [['deletedAt', 'DESC']],
  });

  return {
    photos: rows.map(toTrashedPhotoJSON),
    total: count,
    page,
    limit,
  };
};

/**
 * Permanently delete one trashed album owned by the user.
 */
const permanentlyDeleteAlbum = async (userId, albumId) => {
  const { Album } = db;

  const album = await Album.findOne({
    paranoid: false,
    where: {
      id: albumId,
      ownerId: userId,
    },
  });

  if (!album) throw new NotFoundError('Album');
  if (!album.deletedAt) throw new ConflictError('Album is not in trash');

  await album.destroy({ force: true });
};

/**
 * Permanently delete one trashed photo uploaded by the user.
 */
const permanentlyDeletePhoto = async (userId, photoId) => {
  const { Photo, Album } = db;
  const ownedAlbumIds = await getOwnedAlbumIds(userId);
  const ownedAlbumIdsSet = new Set(ownedAlbumIds);

  const photo = await Photo.scope('withDeleted').findOne({
    where: {
      id: photoId,
    },
    include: [
      {
        model: Album,
        as: 'album',
        attributes: ['id', 'ownerId'],
        paranoid: false,
      },
    ],
  });

  if (!photo) throw new NotFoundError('Photo');
  if (!canManagePhotoTrash(photo, userId, ownedAlbumIdsSet)) throw new NotFoundError('Photo');
  if (!photo.deletedAt) throw new ConflictError('Photo is not in trash');

  // TODO: Also delete file from storage (storageKey)
  await photo.destroy({ force: true });
};

/**
 * Permanently delete all trashed albums or photos for a user.
 */
const emptyTrash = async (userId, resourceType) => {
  if (resourceType === 'albums') {
    const { Album } = db;
    const albums = await Album.findAll({
      paranoid: false,
      where: {
        ownerId: userId,
        deletedAt: { [db.Sequelize.Op.ne]: null },
      },
    });

    for (const album of albums) {
      await album.destroy({ force: true });
    }

    return { deletedCount: albums.length };
  }

  if (resourceType === 'photos') {
    const { Photo } = db;
    const { Op } = db.Sequelize;
    const ownedAlbumIds = await getOwnedAlbumIds(userId);
    const photos = await Photo.scope('withDeleted').findAll({
      where: {
        deletedAt: { [db.Sequelize.Op.ne]: null },
        [Op.or]: [
          { uploadedById: userId },
          ...(ownedAlbumIds.length > 0 ? [{ albumId: { [Op.in]: ownedAlbumIds } }] : []),
        ],
      },
    });

    for (const photo of photos) {
      // TODO: Also delete file from storage (storageKey)
      await photo.destroy({ force: true });
    }

    return { deletedCount: photos.length };
  }

  throw new Error('Invalid resource type. Must be "albums" or "photos".');
};

module.exports = {
  listTrashedAlbums,
  listTrashedPhotos,
  permanentlyDeleteAlbum,
  permanentlyDeletePhoto,
  emptyTrash,
};
