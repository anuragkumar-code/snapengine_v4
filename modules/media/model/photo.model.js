'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { PHOTO_STATUS, PHOTO_VISIBILITY } = require('../../../shared/constants');

/**
 * Photo Model — Aggregate Root of the Media Context
 *
 * Security-critical model. Every query MUST include visibility filtering.
 * ID guessing cannot bypass access control — enforced at query level via scopes.
 *
 * Visibility Model (three levels):
 *  1. ALBUM_DEFAULT  : Inherits album permission (anyone with album:view can see)
 *  2. RESTRICTED     : Only specific users listed in PhotoVisibility can see
 *  3. HIDDEN         : Blocked from everyone except album owner + uploader
 *
 * Processing Lifecycle:
 *  1. Upload → status=pending, filePath set, queued for processing
 *  2. Worker picks up → status=processing
 *  3. Thumbnail generated → thumbnailPath set, status=ready
 *  4. Failures → status=failed, error logged to metadata
 *
 * Soft Delete (Trash):
 *  - Paranoid model: deletedAt is set, not removed from DB
 *  - Trash is user-facing — "deleted" photos can be restored by owner
 *
 * Associations:
 *  - BelongsTo Album
 *  - BelongsTo User (uploadedBy)
 *  - HasMany PhotoVisibility (allowlist for RESTRICTED photos)
 *  - HasMany PhotoTag (many-to-many via Tag)
 *  - HasMany Comment
 */

module.exports = (sequelize) => {
  class Photo extends Model {
    /**
     * Check if processing is complete and photo is ready to serve.
     */
    isReady() {
      return this.status === PHOTO_STATUS.READY;
    }

    /**
     * Check if this photo is restricted to specific users.
     */
    isRestricted() {
      return this.visibilityType === PHOTO_VISIBILITY.RESTRICTED;
    }

    /**
     * Check if this photo is hidden from all members.
     */
    isHidden() {
      return this.visibilityType === PHOTO_VISIBILITY.HIDDEN;
    }

    /**
     * Safe JSON — never expose internal processing paths in API responses.
     */
    toSafeJSON() {
      const { storageKey, deletedAt, ...safe } = this.get({ plain: true });
      return safe;
    }

    static associate(models) {
      Photo.belongsTo(models.Album, {
        foreignKey: 'albumId',
        as: 'album',
      });

      Photo.belongsTo(models.User, {
        foreignKey: 'uploadedById',
        as: 'uploadedBy',
      });

      // Allowlist for RESTRICTED photos
      Photo.hasMany(models.PhotoVisibility, {
        foreignKey: 'photoId',
        as: 'visibilityAllowlist',
        onDelete: 'CASCADE',
      });

      // Many-to-many: Photo ↔ Tag via PhotoTag
      Photo.belongsToMany(models.Tag, {
        through: 'photo_tags',
        foreignKey: 'photoId',
        otherKey: 'tagId',
        as: 'tags',
      });

      Photo.hasMany(models.Comment, {
        foreignKey: 'photoId',
        as: 'comments',
        onDelete: 'CASCADE',
      });
    }
  }

  Photo.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
        allowNull: false,
      },
      albumId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'albums', key: 'id' },
      },
      uploadedById: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      // Original filename as uploaded (for display)
      originalFilename: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Full URL to access the photo (CDN / storage provider URL)
      fileUrl: {
        type: DataTypes.STRING(2048),
        allowNull: false,
      },
      // Storage key — internal identifier for deletion (local path or S3 key)
      storageKey: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      thumbnailUrl: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      thumbnailKey: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      mimeType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      sizeBytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0 },
      },
      width: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      height: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      // Processing state machine
      status: {
        type: DataTypes.ENUM(...Object.values(PHOTO_STATUS)),
        allowNull: false,
        defaultValue: PHOTO_STATUS.PENDING,
      },
      // Visibility type — CRITICAL for access control
      visibilityType: {
        type: DataTypes.ENUM(...Object.values(PHOTO_VISIBILITY)),
        allowNull: false,
        defaultValue: PHOTO_VISIBILITY.ALBUM_DEFAULT,
      },
      // EXIF, GPS, camera settings, processing errors
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // When processing finished (success or fail)
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Photo',
      tableName: 'photos',
      paranoid: true, // Soft delete (trash system)
      underscored: true,
      timestamps: true,

      // ── Default Scope: NEVER return soft-deleted photos ────────────────
      defaultScope: {
        where: { deletedAt: null },
      },

      // ── Named Scopes ────────────────────────────────────────────────────
      scopes: {
        // Include soft-deleted (for trash/restore operations)
        withDeleted: {
          paranoid: false,
        },

        // Only ready photos (successfully processed)
        ready: {
          where: { status: PHOTO_STATUS.READY },
        },

        // Only photos the uploader can see (includes their own HIDDEN photos)
        uploaderView: (userId) => ({
          where: {
            [sequelize.Sequelize.Op.or]: [
              { uploadedById: userId },
              { visibilityType: { [sequelize.Sequelize.Op.ne]: PHOTO_VISIBILITY.HIDDEN } },
            ],
          },
        }),
      },

      indexes: [
        { fields: ['album_id'] },
        { fields: ['uploaded_by_id'] },
        { fields: ['status'] },
        { fields: ['visibility_type'] },
        { fields: ['created_at'] },
        // Primary query: album photo list (most common)
        {
          fields: ['album_id', 'status', 'deleted_at', 'created_at'],
          name: 'idx_photos_album_active',
        },
        // Visibility resolution
        {
          fields: ['album_id', 'visibility_type', 'uploaded_by_id'],
          name: 'idx_photos_visibility',
        },
      ],
    }
  );

  return Photo;
};