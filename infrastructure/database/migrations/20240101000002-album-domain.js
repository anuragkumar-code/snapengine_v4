'use strict';

/**
 * Migration: Album Domain Schema
 * Creates:
 *   albums
 *   album_members
 *   album_permission_overrides
 *   invitations
 *   album_activity_logs
 *
 * Run:  npx sequelize-cli db:migrate
 * Undo: npx sequelize-cli db:migrate:undo
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── ENUM Types ─────────────────────────────────────────────────────────
    await queryInterface.sequelize.query(
      `CREATE TYPE "album_role_enum" AS ENUM ('viewer', 'contributor', 'admin', 'owner')`
    );
    await queryInterface.sequelize.query(
      `CREATE TYPE "invitation_status_enum" AS ENUM ('pending', 'accepted', 'declined', 'expired', 'revoked')`
    );

    // ── albums ─────────────────────────────────────────────────────────────
    await queryInterface.createTable('albums', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      owner_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      is_public: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      public_token: {
        type: Sequelize.STRING(64),
        allowNull: true,
        unique: true,
      },
      master_image_url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      master_image_key: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      cover_photo_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'FK to photos table — wired in Phase 3',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: '{}',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('albums', ['owner_id'], { name: 'idx_albums_owner_id' });
    await queryInterface.addIndex('albums', ['is_public'], { name: 'idx_albums_is_public' });
    await queryInterface.addIndex('albums', ['created_at'], { name: 'idx_albums_created_at' });
    await queryInterface.addIndex('albums', ['date'], { name: 'idx_albums_date' });
    await queryInterface.addIndex('albums', ['owner_id', 'deleted_at', 'created_at'], {
      name: 'idx_albums_owner_active',
    });
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX "albums_public_token_unique"
      ON albums (public_token)
      WHERE public_token IS NOT NULL;
    `);

    // ── album_members ──────────────────────────────────────────────────────
    await queryInterface.createTable('album_members', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      album_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'albums', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role: {
        type: '"album_role_enum"',
        allowNull: false,
        defaultValue: 'viewer',
      },
      added_by_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      role_changed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('album_members', ['album_id', 'user_id'], {
      unique: true,
      name: 'idx_album_members_unique',
    });
    await queryInterface.addIndex('album_members', ['album_id'], { name: 'idx_album_members_album' });
    await queryInterface.addIndex('album_members', ['user_id'], { name: 'idx_album_members_user' });
    await queryInterface.addIndex('album_members', ['album_id', 'user_id', 'role'], {
      name: 'idx_album_members_permission_lookup',
    });

    // ── album_permission_overrides ─────────────────────────────────────────
    await queryInterface.createTable('album_permission_overrides', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      album_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'albums', key: 'id' },
        onDelete: 'CASCADE',
      },
      album_member_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'album_members', key: 'id' },
        onDelete: 'CASCADE',
      },
      action: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      granted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      },
      set_by_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      reason: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex(
      'album_permission_overrides',
      ['album_id', 'album_member_id'],
      { name: 'idx_override_album_member' }
    );
    await queryInterface.addIndex(
      'album_permission_overrides',
      ['album_member_id', 'action'],
      { unique: true, name: 'idx_override_member_action_unique' }
    );

    // ── invitations ────────────────────────────────────────────────────────
    await queryInterface.createTable('invitations', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      album_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'albums', key: 'id' },
        onDelete: 'CASCADE',
      },
      invited_by_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      invited_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      invited_email: {
        type: Sequelize.STRING(320),
        allowNull: true,
      },
      invited_role: {
        type: '"album_role_enum"',
        allowNull: false,
        defaultValue: 'viewer',
      },
      token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      status: {
        type: '"invitation_status_enum"',
        allowNull: false,
        defaultValue: 'pending',
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      accepted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      max_uses: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 1,
      },
      use_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      note: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('invitations', ['token_hash'], {
      unique: true, name: 'idx_invitations_token_hash',
    });
    await queryInterface.addIndex('invitations', ['album_id'], { name: 'idx_invitations_album' });
    await queryInterface.addIndex('invitations', ['status'], { name: 'idx_invitations_status' });
    await queryInterface.addIndex('invitations', ['expires_at'], { name: 'idx_invitations_expires' });
    await queryInterface.addIndex(
      'invitations', ['album_id', 'invited_email', 'status'],
      { name: 'idx_invitations_album_email_status' }
    );

    // ── album_activity_logs ────────────────────────────────────────────────
    await queryInterface.createTable('album_activity_logs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      album_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'albums', key: 'id' },
        onDelete: 'CASCADE',
      },
      actor_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      type: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      target_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      target_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: '{}',
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('album_activity_logs', ['album_id'], {
      name: 'idx_activity_log_album',
    });
    await queryInterface.addIndex('album_activity_logs', ['actor_id'], {
      name: 'idx_activity_log_actor',
    });
    await queryInterface.addIndex('album_activity_logs', ['type'], {
      name: 'idx_activity_log_type',
    });
    await queryInterface.addIndex('album_activity_logs', ['album_id', 'created_at'], {
      name: 'idx_activity_log_album_feed',
    });
    await queryInterface.addIndex('album_activity_logs', ['album_id', 'actor_id', 'created_at'], {
      name: 'idx_activity_log_album_actor',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('album_activity_logs');
    await queryInterface.dropTable('invitations');
    await queryInterface.dropTable('album_permission_overrides');
    await queryInterface.dropTable('album_members');
    await queryInterface.dropTable('albums');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "album_role_enum"');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "invitation_status_enum"');
  },
};