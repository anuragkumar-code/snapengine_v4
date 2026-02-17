'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { INVITATION_STATUS, ALBUM_ROLE } = require('../../../shared/constants');

/**
 * Invitation Model
 *
 * Token-based album invitation system.
 *
 * Flow:
 *  1. Album admin/owner creates invitation → rawToken generated
 *  2. rawToken is embedded in shareable link and emailed/shared
 *  3. Recipient opens link → GET /invitations/:token → preview
 *  4. Recipient accepts → POST /invitations/:token/accept
 *     → AlbumMember record created with invitedRole
 *  5. Token status set to 'accepted'
 *
 * Edge cases handled:
 *  - Album becomes private after invite issued → invitation still valid
 *    but newly joined member only gets private access
 *  - Multiple invitations to same email → only latest is valid
 *  - Expired invitations → status updated to 'expired' on access attempt
 *  - Re-invite after removal → previous accepted invitation is revoked,
 *    new one created
 *
 * Security:
 *  - Raw token (32 bytes hex) is never stored — only SHA256 hash
 *  - Token delivered out-of-band (email / shared link)
 *
 * Associations:
 *  - BelongsTo Album
 *  - BelongsTo User (invitedBy — who sent it)
 *  - BelongsTo User (invitedUser — who receives it, nullable for open invites)
 */

module.exports = (sequelize) => {
  class Invitation extends Model {
    /**
     * Generate a cryptographically secure invitation token pair.
     * @returns {{ rawToken: string, hashedToken: string }}
     */
    static generateToken() {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      return { rawToken, hashedToken };
    }

    static hashToken(rawToken) {
      return crypto.createHash('sha256').update(rawToken).digest('hex');
    }

    /**
     * Check if invitation is still actionable.
     */
    isValid() {
      return (
        this.status === INVITATION_STATUS.PENDING &&
        new Date() < new Date(this.expiresAt)
      );
    }

    /**
     * Mark as expired if past expiry date.
     * Called lazily when invitation is looked up.
     */
    async expireIfStale() {
      if (this.status === INVITATION_STATUS.PENDING && new Date() >= new Date(this.expiresAt)) {
        await this.update({ status: INVITATION_STATUS.EXPIRED });
        return true;
      }
      return false;
    }

    toSafeJSON() {
      // Never expose tokenHash in API responses
      const { tokenHash, ...safe } = this.get({ plain: true });
      return safe;
    }

    static associate(models) {
      Invitation.belongsTo(models.Album, {
        foreignKey: 'albumId',
        as: 'album',
      });

      Invitation.belongsTo(models.User, {
        foreignKey: 'invitedById',
        as: 'invitedBy',
      });

      // Nullable: open invitations don't target a specific user
      Invitation.belongsTo(models.User, {
        foreignKey: 'invitedUserId',
        as: 'invitedUser',
      });
    }
  }

  Invitation.init(
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
      invitedById: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      // Null = open invitation (anyone with the link can accept)
      invitedUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      // Email the invitation was sent to (for display/audit even if user not yet registered)
      invitedEmail: {
        type: DataTypes.STRING(320),
        allowNull: true,
        set(val) {
          this.setDataValue('invitedEmail', val ? val.toLowerCase().trim() : null);
        },
      },
      // The role the accepted user will receive
      invitedRole: {
        type: DataTypes.ENUM(...Object.values(ALBUM_ROLE)),
        allowNull: false,
        defaultValue: ALBUM_ROLE.VIEWER,
        validate: {
          // Cannot invite someone as owner
          notOwner(value) {
            if (value === ALBUM_ROLE.OWNER) {
              throw new Error('Cannot invite a user with Owner role');
            }
          },
        },
      },
      // SHA256 hash of the raw token — raw token delivered via email/link only
      tokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM(...Object.values(INVITATION_STATUS)),
        allowNull: false,
        defaultValue: INVITATION_STATUS.PENDING,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Max number of times this token can be used (null = single use)
      maxUses: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
      },
      useCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      note: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Optional message from the inviter',
      },
    },
    {
      sequelize,
      modelName: 'Invitation',
      tableName: 'invitations',
      paranoid: false,
      underscored: true,
      timestamps: true,
      updatedAt: true,

      indexes: [
        { fields: ['token_hash'], unique: true, name: 'idx_invitations_token_hash' },
        { fields: ['album_id'] },
        { fields: ['invited_by_id'] },
        { fields: ['invited_user_id'] },
        { fields: ['invited_email'] },
        { fields: ['status'] },
        { fields: ['expires_at'] },
        // Check for existing pending invites for a user in an album
        {
          fields: ['album_id', 'invited_email', 'status'],
          name: 'idx_invitations_album_email_status',
        },
      ],
    }
  );

  return Invitation;
};