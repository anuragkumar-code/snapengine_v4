'use strict';

const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { USER_STATUS, USER_ROLE } = require('../../../shared/constants');

/**
 * User Model
 *
 * Represents a registered platform user.
 * Supports both email and mobile registration (one required).
 *
 * Associations (defined in associate()):
 *  - HasMany PasswordResetToken
 *  - HasMany AlbumMember (in Album context)
 *  - HasMany Photo (in Media context)
 *  - HasMany Comment (in Media context)
 *
 * Security:
 *  - Passwords are hashed via beforeCreate/beforeUpdate hooks
 *  - passwordHash is excluded from all default queries (defaultScope)
 *  - comparePassword() is the ONLY way to check passwords
 *
 * Soft delete:
 *  - paranoid: true (inherited from global Sequelize config)
 *  - deletedAt is set on soft delete, cleared on restore
 */

module.exports = (sequelize) => {
  class User extends Model {
    /**
     * Verify a plain-text password against the stored hash.
     * Call this ONLY from AuthService — never compare hashes in controllers.
     * @param {string} plainPassword
     * @returns {Promise<boolean>}
     */
    async comparePassword(plainPassword) {
      return bcrypt.compare(plainPassword, this.passwordHash);
    }

    /**
     * Return a safe, serializable user object for API responses.
     * Never exposes passwordHash, resetTokens, or soft delete fields.
     */
    toSafeJSON() {
      const { passwordHash, deletedAt, ...safe } = this.get({ plain: true });
      return safe;
    }

    /**
     * Check if the user account is in an active state.
     */
    isActive() {
      return this.status === USER_STATUS.ACTIVE;
    }

    static associate(models) {
      // Auth context
      User.hasMany(models.PasswordResetToken, {
        foreignKey: 'userId',
        as: 'passwordResetTokens',
        onDelete: 'CASCADE',
      });

      // Album context (will be wired when AlbumMember model is added in Phase 2)
      // User.hasMany(models.AlbumMember, { foreignKey: 'userId', as: 'albumMemberships' });

      // Media context (will be wired in Phase 3)
      // User.hasMany(models.Photo, { foreignKey: 'uploadedById', as: 'photos' });
      // User.hasMany(models.Comment, { foreignKey: 'userId', as: 'comments' });
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(320),
        allowNull: true,
        unique: true,
        validate: {
          isEmail: true,
          len: [5, 320],
        },
        set(value) {
          // Always store email lowercase
          this.setDataValue('email', value ? value.toLowerCase().trim() : null);
        },
      },
      mobile: {
        type: DataTypes.STRING(20),
        allowNull: true,
        unique: true,
        validate: {
          is: /^\+?[1-9]\d{7,14}$/,
        },
      },
      passwordHash: {
        type: DataTypes.STRING(72),
        allowNull: false,
        // Excluded from all default JSON serialization
      },
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { len: [1, 100] },
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { len: [1, 100] },
      },
      avatarUrl: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      avatarKey: {
        type: DataTypes.STRING(512),
        allowNull: true,
        // Internal storage key — not exposed in toSafeJSON unless needed
      },
      status: {
        type: DataTypes.ENUM(...Object.values(USER_STATUS)),
        allowNull: false,
        defaultValue: USER_STATUS.ACTIVE,
      },
      role: {
        type: DataTypes.ENUM(...Object.values(USER_ROLE)),
        allowNull: false,
        defaultValue: USER_ROLE.USER,
      },
      emailVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      mobileVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastLoginIp: {
        type: DataTypes.STRING(45), // IPv6 max length
        allowNull: true,
      },
      bio: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      preferences: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'User-specific settings: notifications, theme, etc.',
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      paranoid: true, // Soft delete via deletedAt

      // Exclude passwordHash from all default queries
      defaultScope: {
        attributes: {
          exclude: ['passwordHash'],
        },
      },

      // Named scope to fetch with password (AuthService only)
      scopes: {
        withPassword: {
          attributes: { include: ['passwordHash'] },
        },
        active: {
          where: { status: USER_STATUS.ACTIVE },
        },
      },

      indexes: [
        { fields: ['email'], unique: true, where: { deleted_at: null } },
        { fields: ['mobile'], unique: true, where: { deleted_at: null } },
        { fields: ['status'] },
        { fields: ['role'] },
        { fields: ['created_at'] },
      ],

      hooks: {
        /**
         * Hash password before creating a new user.
         * saltRounds = 12 is the production-recommended minimum.
         */
        beforeCreate: async (user) => {
          if (user.passwordHash && !user.passwordHash.startsWith('$2')) {
            user.passwordHash = await bcrypt.hash(user.passwordHash, 12);
          }
          // Enforce: at least one of email or mobile must be provided
          if (!user.email && !user.mobile) {
            throw new Error('User must have either an email or mobile number');
          }
        },

        /**
         * Re-hash password only when it has been explicitly changed.
         */
        beforeUpdate: async (user) => {
          if (user.changed('passwordHash') && user.passwordHash && !user.passwordHash.startsWith('$2')) {
            user.passwordHash = await bcrypt.hash(user.passwordHash, 12);
          }
        },
      },
    }
  );

  return User;
};