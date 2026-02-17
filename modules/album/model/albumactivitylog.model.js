'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { ACTIVITY_TYPE } = require('../../../shared/constants');

/**
 * AlbumActivityLog Model
 *
 * Immutable audit trail for all events that occur within an album.
 * Records are NEVER updated or deleted — they are the permanent record.
 *
 * Written by:
 *  - AlbumActivityLogService (via queue worker in production)
 *  - Direct write in critical sync paths
 *
 * Structure:
 *  - actorId     : who triggered the action
 *  - targetId    : what entity was acted upon (userId, photoId, etc.)
 *  - targetType  : type of that entity ('user', 'photo', 'album', etc.)
 *  - type        : the ACTIVITY_TYPE constant
 *  - metadata    : JSONB — event-specific payload (before/after values, IPs, etc.)
 *
 * Associations:
 *  - BelongsTo Album
 *  - BelongsTo User (actor)
 */

module.exports = (sequelize) => {
  class AlbumActivityLog extends Model {
    static associate(models) {
      AlbumActivityLog.belongsTo(models.Album, {
        foreignKey: 'albumId',
        as: 'album',
      });

      AlbumActivityLog.belongsTo(models.User, {
        foreignKey: 'actorId',
        as: 'actor',
      });
    }
  }

  AlbumActivityLog.init(
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
      // Who performed the action (null = system-generated event)
      actorId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      type: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'ACTIVITY_TYPE constant — e.g. album.created, member.added',
      },
      // The entity that was acted upon
      targetId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'ID of the affected entity (userId, photoId, etc.)',
      },
      targetType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Type of the affected entity: user, photo, album, comment',
      },
      // Rich event payload: before/after state, IPs, computed diffs
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      // IP of the actor at time of event
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AlbumActivityLog',
      tableName: 'album_activity_logs',
      paranoid: false,    // Logs are never deleted
      underscored: true,
      timestamps: true,
      updatedAt: false,   // Logs are immutable — no updates ever

      indexes: [
        { fields: ['album_id'] },
        { fields: ['actor_id'] },
        { fields: ['type'] },
        { fields: ['created_at'] },
        // Paginated activity feed for an album (primary use case)
        {
          fields: ['album_id', 'created_at'],
          name: 'idx_activity_log_album_feed',
        },
        // Filter by actor within album
        {
          fields: ['album_id', 'actor_id', 'created_at'],
          name: 'idx_activity_log_album_actor',
        },
      ],

      hooks: {
        // Enforce immutability: prevent any update to a log record
        beforeUpdate: () => {
          throw new Error('AlbumActivityLog records are immutable and cannot be updated');
        },
      },
    }
  );

  return AlbumActivityLog;
};