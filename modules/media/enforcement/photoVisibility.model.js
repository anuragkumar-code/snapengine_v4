'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

/**
 * PhotoVisibility Model
 *
 * Allowlist for RESTRICTED photos.
 * If photo.visibilityType === 'restricted', ONLY users in this table can see it
 * (plus album owner and uploader, who always see everything).
 *
 * This table is ONLY consulted for RESTRICTED photos.
 * ALBUM_DEFAULT photos ignore this table entirely.
 * HIDDEN photos block everyone except owner+uploader (this table is irrelevant).
 *
 * One record per (photoId, userId) pair.
 *
 * Usage:
 *  - Uploader sets restricted visibility on photo
 *  - Uploader selects which album members can see it
 *  - PhotoVisibility records are created for each selected user
 *  - Query engine JOINs this table only for RESTRICTED photos
 *
 * Associations:
 *  - BelongsTo Photo
 *  - BelongsTo User
 */

module.exports = (sequelize) => {
  class PhotoVisibility extends Model {
    static associate(models) {
      PhotoVisibility.belongsTo(models.Photo, {
        foreignKey: 'photoId',
        as: 'photo',
      });

      PhotoVisibility.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user',
      });
    }
  }

  PhotoVisibility.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
        allowNull: false,
      },
      photoId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'photos', key: 'id' },
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      // Who granted this user visibility (audit trail)
      grantedById: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      sequelize,
      modelName: 'PhotoVisibility',
      tableName: 'photo_visibilities',
      paranoid: false,
      underscored: true,
      timestamps: true,
      updatedAt: false,

      indexes: [
        // Unique: one visibility grant per photo per user
        {
          fields: ['photo_id', 'user_id'],
          unique: true,
          name: 'idx_photo_visibility_unique',
        },
        { fields: ['photo_id'] },
        { fields: ['user_id'] },
        // Fast lookup: "can this user see this restricted photo?"
        {
          fields: ['photo_id', 'user_id'],
          name: 'idx_photo_visibility_access_check',
        },
      ],
    }
  );

  return PhotoVisibility;
};