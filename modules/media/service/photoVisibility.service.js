'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

/**
 * Comment Model
 *
 * Threaded comments on photos.
 *
 * Threading:
 *  - parentId: null  → top-level comment
 *  - parentId: UUID  → reply to another comment
 *
 * Visibility:
 *  - Comment visibility INHERITS from the photo's visibility.
 *  - If you can see the photo, you can see all comments on it.
 *  - If photo is RESTRICTED and you're not in the allowlist, you cannot see comments.
 *  - Comments are NOT independently access-controlled.
 *
 * Soft Delete:
 *  - Deleted comments show as "[deleted]" placeholder if they have replies
 *  - If no replies, comment is removed from tree entirely (hard delete after 30 days)
 *
 * Associations:
 *  - BelongsTo Photo
 *  - BelongsTo User (author)
 *  - BelongsTo Comment (parent, for threading)
 *  - HasMany Comment (replies)
 */

module.exports = (sequelize) => {
  class Comment extends Model {
    /**
     * Check if this is a top-level comment (not a reply).
     */
    isTopLevel() {
      return this.parentId === null;
    }

    /**
     * Safe JSON — exclude internal flags.
     */
    toSafeJSON() {
      const { deletedAt, ...safe } = this.get({ plain: true });
      return safe;
    }

    static associate(models) {
      Comment.belongsTo(models.Photo, {
        foreignKey: 'photoId',
        as: 'photo',
      });

      Comment.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user',
      });

      // Self-referencing for threading
      Comment.belongsTo(models.Comment, {
        foreignKey: 'parentId',
        as: 'parent',
      });

      Comment.hasMany(models.Comment, {
        foreignKey: 'parentId',
        as: 'replies',
      });
    }
  }

  Comment.init(
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
      // Null = top-level comment, UUID = reply to another comment
      parentId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'comments', key: 'id' },
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { len: [1, 5000] },
      },
      // Metadata: edited timestamps, reaction counts (future), mentions
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // When comment was last edited (null if never edited)
      editedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Comment',
      tableName: 'comments',
      paranoid: true, // Soft delete
      underscored: true,
      timestamps: true,

      indexes: [
        { fields: ['photo_id'] },
        { fields: ['user_id'] },
        { fields: ['parent_id'] },
        { fields: ['created_at'] },
        // Primary query: all comments for a photo (with replies nested)
        {
          fields: ['photo_id', 'parent_id', 'created_at'],
          name: 'idx_comments_photo_thread',
        },
      ],
    }
  );

  return Comment;
};