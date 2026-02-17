'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

/**
 * AlbumPermissionOverride Model
 *
 * Allows fine-grained permission control BEYOND the member's base role.
 * Each record grants or denies a specific action for a specific member.
 *
 * Override resolution (always applied AFTER base role check):
 *  - granted: true  → user CAN do this action even if role wouldn't allow
 *  - granted: false → user CANNOT do this action even if role would allow
 *
 * Override always wins over role. This enables:
 *  - Blocking a contributor from deleting photos (deny override)
 *  - Letting a viewer add comments (grant override)
 *
 * Defined actions (expand as domain grows):
 *   album:view, album:edit, album:delete
 *   member:add, member:remove, member:change_role
 *   photo:upload, photo:delete, photo:view_restricted
 *   comment:create, comment:delete
 *
 * Associations:
 *  - BelongsTo AlbumMember
 *  - BelongsTo Album (for indexed queries)
 */

const PERMISSION_ACTIONS = Object.freeze({
  ALBUM_VIEW: 'album:view',
  ALBUM_EDIT: 'album:edit',
  ALBUM_DELETE: 'album:delete',
  ALBUM_MANAGE_SETTINGS: 'album:manage_settings',
  MEMBER_ADD: 'member:add',
  MEMBER_REMOVE: 'member:remove',
  MEMBER_CHANGE_ROLE: 'member:change_role',
  PHOTO_UPLOAD: 'photo:upload',
  PHOTO_DELETE: 'photo:delete',
  PHOTO_VIEW_RESTRICTED: 'photo:view_restricted',
  COMMENT_CREATE: 'comment:create',
  COMMENT_DELETE: 'comment:delete',
  INVITATION_CREATE: 'invitation:create',
});

module.exports = (sequelize) => {
  class AlbumPermissionOverride extends Model {
    static associate(models) {
      AlbumPermissionOverride.belongsTo(models.AlbumMember, {
        foreignKey: 'albumMemberId',
        as: 'member',
      });

      AlbumPermissionOverride.belongsTo(models.Album, {
        foreignKey: 'albumId',
        as: 'album',
      });
    }
  }

  AlbumPermissionOverride.init(
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
      albumMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'album_members', key: 'id' },
      },
      // The specific action this override applies to
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          isIn: [Object.values(PERMISSION_ACTIONS)],
        },
      },
      // true = explicitly granted, false = explicitly denied
      granted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
      },
      // Who set this override (audit trail)
      setById: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Optional human-readable reason for this override',
      },
    },
    {
      sequelize,
      modelName: 'AlbumPermissionOverride',
      tableName: 'album_permission_overrides',
      paranoid: false,
      underscored: true,
      timestamps: true,
      updatedAt: false,

      indexes: [
        // Core lookup: all overrides for a member in an album
        {
          fields: ['album_id', 'album_member_id'],
          name: 'idx_override_album_member',
        },
        // Unique: one override per member per action
        {
          fields: ['album_member_id', 'action'],
          unique: true,
          name: 'idx_override_member_action_unique',
        },
        { fields: ['album_id'] },
      ],
    }
  );

  // Attach constants to class for external use
  AlbumPermissionOverride.ACTIONS = PERMISSION_ACTIONS;

  return AlbumPermissionOverride;
};