'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

/**
 * Tag Model
 *
 * Reusable tags that can be attached to photos across all albums.
 * Tags are global — not scoped to a single album.
 * This enables cross-album search (e.g. "show all photos tagged 'sunset'").
 *
 * Normalization:
 *  - name is stored lowercase, trimmed
 *  - slug is auto-generated (alphanumeric only, for URLs)
 *
 * Many-to-Many:
 *  Photo ↔ Tag via PhotoTag join table
 *
 * Autocomplete:
 *  - trigram index on name enables fuzzy search
 *  - usageCount denormalized for sorting popular tags first
 *
 * Associations:
 *  - BelongsToMany Photo (via photo_tags)
 */

module.exports = (sequelize) => {
  class Tag extends Model {
    /**
     * Generate URL-safe slug from tag name.
     */
    static slugify(name) {
      return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    static associate(models) {
      Tag.belongsToMany(models.Photo, {
        through: 'photo_tags',
        foreignKey: 'tagId',
        otherKey: 'photoId',
        as: 'photos',
      });
    }
  }

  Tag.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        set(value) {
          // Always store lowercase, trimmed
          this.setDataValue('name', value.toLowerCase().trim());
        },
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      // Denormalized count — updated when tags are added/removed
      usageCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      // Optional description for tag disambiguation
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Tag',
      tableName: 'tags',
      paranoid: false,
      underscored: true,
      timestamps: true,

      indexes: [
        { fields: ['name'], unique: true, name: 'idx_tags_name_unique' },
        { fields: ['slug'], unique: true, name: 'idx_tags_slug_unique' },
        // Autocomplete + popular tags
        { fields: ['usage_count'], name: 'idx_tags_usage_count' },
        // Trigram index for fuzzy search (PostgreSQL extension)
        // Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
        // Applied in migration
      ],

      hooks: {
        beforeValidate: (tag) => {
          if (tag.name && !tag.slug) {
            tag.slug = Tag.slugify(tag.name);
          }
        },
      },
    }
  );

  return Tag;
};