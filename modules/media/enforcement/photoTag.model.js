'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

/**
 * PhotoTag Model
 *
 * Join table for Photo ↔ Tag many-to-many relationship.
 * Includes metadata about who tagged and when.
 *
 * Auto-tagging support:
 *  - AI-generated tags can be marked with source: 'ai'
 *  - User-added tags: source: 'user'
 *
 * Associations:
 *  - BelongsTo Photo
 *  - BelongsTo Tag
 *  - BelongsTo User (taggedBy)
 */

module.exports = (sequelize) => {
  class PhotoTag extends Model {
    static associate(models) {
      PhotoTag.belongsTo(models.Photo, {
        foreignKey: 'photoId',
        as: 'photo',
      });

      PhotoTag.belongsTo(models.Tag, {
        foreignKey: 'tagId',
        as: 'tag',
      });

      PhotoTag.belongsTo(models.User, {
        foreignKey: 'taggedById',
        as: 'taggedBy',
      });
    }
  }

  PhotoTag.init(
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
      tagId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'tags', key: 'id' },
      },
      // Who applied this tag (null for AI-generated)
      taggedById: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      // 'user' | 'ai' | 'exif'
      source: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'user',
      },
    },
    {
      sequelize,
      modelName: 'PhotoTag',
      tableName: 'photo_tags',
      paranoid: false,
      underscored: true,
      timestamps: true,
      updatedAt: false,

      indexes: [
        // Unique: one tag per photo (can't tag the same photo twice with the same tag)
        {
          fields: ['photo_id', 'tag_id'],
          unique: true,
          name: 'idx_photo_tags_unique',
        },
        { fields: ['photo_id'] },
        { fields: ['tag_id'] },
        // Tag search: "all photos with tag X"
        { fields: ['tag_id', 'photo_id'], name: 'idx_photo_tags_search' },
      ],
    }
  );

  return PhotoTag;
};