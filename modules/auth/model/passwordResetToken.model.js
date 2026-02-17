'use strict';

const { Model, DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * PasswordResetToken Model
 *
 * One-time token issued when a user requests a password reset.
 * Flow:
 *  1. AuthService creates a token record with a hashed token value
 *  2. Raw token is emailed to user (never stored in DB)
 *  3. User submits raw token → AuthService hashes + compares → resets password
 *  4. Token is marked used = true (or deleted)
 *
 * Security principles:
 *  - Token stored as SHA256 hash (raw token only travels via email)
 *  - Tokens expire after config.passwordReset.tokenExpiresIn ms
 *  - Once used, token is invalidated immediately
 *  - Old unused tokens for same user are invalidated on new request
 */

module.exports = (sequelize) => {
  class PasswordResetToken extends Model {
    /**
     * Generate a cryptographically secure raw token.
     * Returns { rawToken, hashedToken } pair.
     * Store hashedToken in DB, send rawToken via email.
     */
    static generateToken() {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      return { rawToken, hashedToken };
    }

    /**
     * Hash a raw token for DB comparison.
     */
    static hashToken(rawToken) {
      return crypto.createHash('sha256').update(rawToken).digest('hex');
    }

    /**
     * Check if this token record is still valid (not expired, not used).
     */
    isValid() {
      return !this.usedAt && new Date() < new Date(this.expiresAt);
    }

    static associate(models) {
      PasswordResetToken.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user',
        onDelete: 'CASCADE',
      });
    }
  }

  PasswordResetToken.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      // Only the SHA256 hash is stored — raw token travels via email only
      tokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      usedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      // IP and user agent for audit trail
      requestedFromIp: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      requestedFromUserAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PasswordResetToken',
      tableName: 'password_reset_tokens',
      paranoid: false,       // Hard delete — expired/used tokens get cleaned up
      timestamps: true,
      updatedAt: false,      // Only createdAt matters for reset tokens

      indexes: [
        { fields: ['user_id'] },
        { fields: ['token_hash'], unique: true },
        { fields: ['expires_at'] },
        // Composite for fast lookup of valid tokens
        {
          fields: ['user_id', 'used_at', 'expires_at'],
          name: 'idx_reset_token_validity',
        },
      ],
    }
  );

  return PasswordResetToken;
};