'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { ALBUM_ROLE } = require('../../../shared/constants');

/**
 * AlbumMember Model
 *
 * Represents a user's membership in an album with an assigned role.
 * This is the primary permission record — role is the base permission level.
 *
 * Role hierarchy (ascending privilege):
 *   viewer → contributor → admin → owner
 *
 * One owner record is always present (created when album is created).
 * Owner cannot be removed or have role changed via normal flow —
 * only via ownership transfer (admin operation).
 *
 * AlbumPermissionOverride can further refine what a specific user can do
 * beyond their base role.
 *
 * Associations:
 *  - BelongsTo Album
 *  - BelongsTo User
 *  - HasMany AlbumPermissionOverride (one member can have multiple action overrides)
 */

module.exports = (sequelize) => {
  class AlbumMember extends Model {
    /**
     * Check if this member has at least the given role rank.
     */
    hasMinimumRole(requiredRole) {
      const { ALBUM_ROLE_RANK } = require('../../../shared/constants');
      return (ALBUM_ROLE_RANK[this.role] || 0) >= (ALBUM_ROLE_RANK[requiredRole] || 99);
    }

    toSafeJSON() {
      const { deletedAt, ...safe } = this.get({ plain: true });
      return safe;
    }

    static associate(models) {
      AlbumMember.belongsTo(models.Album, {
        foreignKey: 'albumId',
        as: 'album',
      });

      AlbumMember.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user',
      });

      AlbumMember.hasMany(models.AlbumPermissionOverride, {
        foreignKey: 'albumMemberId',
        as: 'permissionOverrides',
        onDelete: 'CASCADE',
      });
    }
  }

  AlbumMember.init(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      role: {
        type: DataTypes.ENUM(...Object.values(ALBUM_ROLE)),
        allowNull: false,
        defaultValue: ALBUM_ROLE.VIEWER,
      },
      // Who added this member (for audit trail)
      addedById: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      // Timestamp when role was last changed
      roleChangedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AlbumMember',
      tableName: 'album_members',
      paranoid: false, // Hard membership — no soft delete needed (just remove)
      underscored: true,
      timestamps: true,

      indexes: [
        // Unique: one membership record per user per album
        {
          fields: ['album_id', 'user_id'],
          unique: true,
          name: 'idx_album_members_unique',
        },
        { fields: ['album_id'] },
        { fields: ['user_id'] },
        { fields: ['role'] },
        // Fast lookup: "what role does userId have in albumId?"
        { fields: ['album_id', 'user_id', 'role'], name: 'idx_album_members_permission_lookup' },
      ],
    }
  );

  return AlbumMember;
};