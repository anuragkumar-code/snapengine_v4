'use strict';

/**
 * Migration: Initial Schema
 * Creates: users, password_reset_tokens
 *
 * Run:  npx sequelize-cli db:migrate
 * Undo: npx sequelize-cli db:migrate:undo
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── ENUM Types (PostgreSQL requires explicit enum creation) ───────────
    await queryInterface.sequelize.query(
      `CREATE TYPE "user_status_enum" AS ENUM ('active', 'inactive', 'suspended', 'pending_verification')`
    );
    await queryInterface.sequelize.query(
      `CREATE TYPE "user_role_enum" AS ENUM ('user', 'admin')`
    );

    // ── users ─────────────────────────────────────────────────────────────
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      email: {
        type: Sequelize.STRING(320),
        allowNull: true,
        unique: true,
      },
      mobile: {
        type: Sequelize.STRING(20),
        allowNull: true,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(72),
        allowNull: false,
      },
      first_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      avatar_url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      avatar_key: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      status: {
        type: '"user_status_enum"',
        allowNull: false,
        defaultValue: 'active',
      },
      role: {
        type: '"user_role_enum"',
        allowNull: false,
        defaultValue: 'user',
      },
      email_verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      mobile_verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_login_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_login_ip: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      bio: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      preferences: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: '{}',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // ── users: indexes ────────────────────────────────────────────────────
    // Partial unique indexes (ignore soft-deleted rows)
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX "users_email_unique_active"
      ON users (email)
      WHERE deleted_at IS NULL;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX "users_mobile_unique_active"
      ON users (mobile)
      WHERE deleted_at IS NULL;
    `);

    await queryInterface.addIndex('users', ['status'], { name: 'idx_users_status' });
    await queryInterface.addIndex('users', ['role'], { name: 'idx_users_role' });
    await queryInterface.addIndex('users', ['created_at'], { name: 'idx_users_created_at' });

    // ── password_reset_tokens ─────────────────────────────────────────────
    await queryInterface.createTable('password_reset_tokens', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      used_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      requested_from_ip: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      requested_from_user_agent: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // ── password_reset_tokens: indexes ────────────────────────────────────
    await queryInterface.addIndex('password_reset_tokens', ['user_id'], {
      name: 'idx_prt_user_id',
    });
    await queryInterface.addIndex('password_reset_tokens', ['token_hash'], {
      name: 'idx_prt_token_hash',
      unique: true,
    });
    await queryInterface.addIndex('password_reset_tokens', ['expires_at'], {
      name: 'idx_prt_expires_at',
    });
    await queryInterface.addIndex(
      'password_reset_tokens',
      ['user_id', 'used_at', 'expires_at'],
      { name: 'idx_prt_validity' }
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('password_reset_tokens');
    await queryInterface.dropTable('users');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "user_status_enum"');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "user_role_enum"');
  },
};