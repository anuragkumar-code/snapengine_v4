'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { ALBUM_VISIBILITY } = require('../../../shared/constants');

/**
 * Album Model — Aggregate Root of the Album Context
 *
 * Owns the album's identity, metadata, and visibility state.
 * All permission and membership resolution flows through this aggregate.
 *
 * Associations:
 *  - BelongsTo User (owner)
 *  - HasMany AlbumMember
 *  - HasMany AlbumPermissionOverride
 *  - HasMany Invitation
 *  - HasMany AlbumActivityLog
 *
 * Soft delete: paranoid: true — deletedAt set on soft delete.
 *
 * Public URL behavior:
 *  - isPublic=true  → publicToken is set, album viewable by anyone with URL
 *  - isPublic=false → publicToken is nullified, public URL stops working
 *  This is enforced in AlbumService, not here.
 */

module.exports = (sequelize) => {
  class Album extends Model {
    /**
     * Safe serialization — never exposes internal fields.
     */
    toSafeJSON() {
      const { deletedAt, ...safe } = this.get({ plain: true });
      return safe;
    }

    /**
     * Whether this album can be viewed by the general public.
     */
    isPubliclyViewable() {
      return this.isPublic === true && this.publicToken !== null;
    }

    static associate(models) {
      Album.belongsTo(models.User, {
        foreignKey: 'ownerId',
        as: 'owner',
      });

      Album.hasMany(models.AlbumMember, {
        foreignKey: 'albumId',
        as: 'members',
        onDelete: 'CASCADE',
      });

      Album.hasMany(models.AlbumPermissionOverride, {
        foreignKey: 'albumId',
        as: 'permissionOverrides',
        onDelete: 'CASCADE',
      });

      Album.hasMany(models.Invitation, {
        foreignKey: 'albumId',
        as: 'invitations',
        onDelete: 'CASCADE',
      });

      Album.hasMany(models.AlbumActivityLog, {
        foreignKey: 'albumId',
        as: 'activityLogs',
        onDelete: 'CASCADE',
      });
    }
  }

  Album.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
        allowNull: false,
      },
      ownerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { len: [1, 255] },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: 'The date this album represents (e.g. event date), not creation date',
      },
      isPublic: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Token that powers the shareable public URL.
      // Set when album becomes public, nullified when it becomes private.
      publicToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
      masterImageUrl: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      masterImageKey: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      coverPhotoId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'FK to Photo — set after photos are uploaded (Phase 3)',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Extensible key-value store for future album attributes',
      },
    },
    {
      sequelize,
      modelName: 'Album',
      tableName: 'albums',
      paranoid: true,
      underscored: true,
      timestamps: true,

      indexes: [
        { fields: ['owner_id'] },
        { fields: ['is_public'] },
        { fields: ['public_token'], unique: true, where: { public_token: { [require('sequelize').Op.ne]: null } } },
        { fields: ['created_at'] },
        { fields: ['date'] },
        // Composite: owner's albums list (most common query)
        { fields: ['owner_id', 'deleted_at', 'created_at'], name: 'idx_albums_owner_active' },
      ],
    }
  );

  return Album;
};