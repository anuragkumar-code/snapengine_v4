'use strict';

/**
 * Migration: Media Domain Schema
 * Creates:
 *   photos
 *   photo_visibilities
 *   tags
 *   photo_tags
 *   comments
 *
 * Also enables PostgreSQL extension: pg_trgm (for tag autocomplete)
 *
 * Run:  npx sequelize-cli db:migrate
 * Undo: npx sequelize-cli db:migrate:undo
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Enable trigram extension (for fuzzy tag search) ───────────────────
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    // ── ENUM Types ─────────────────────────────────────────────────────────
    await queryInterface.sequelize.query(
      `CREATE TYPE "photo_status_enum" AS ENUM ('pending', 'processing', 'ready', 'failed')`
    );
    await queryInterface.sequelize.query(
      `CREATE TYPE "photo_visibility_enum" AS ENUM ('album_default', 'restricted', 'hidden')`
    );

    // ── photos ─────────────────────────────────────────────────────────────
    await queryInterface.createTable('photos', {
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
      uploaded_by_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      original_filename: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      file_url: {
        type: Sequelize.STRING(2048),
        allowNull: false,
      },
      storage_key: {
        type: Sequelize.STRING(512),
        allowNull: false,
      },
      thumbnail_url: {
        type: Sequelize.STRING(2048),
        allowNull: true,
      },
      thumbnail_key: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      mime_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      size_bytes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      width: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      height: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      status: {
        type: '"photo_status_enum"',
        allowNull: false,
        defaultValue: 'pending',
      },
      visibility_type: {
        type: '"photo_visibility_enum"',
        allowNull: false,
        defaultValue: 'album_default',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: '{}',
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('photos', ['album_id'], { name: 'idx_photos_album_id' });
    await queryInterface.addIndex('photos', ['uploaded_by_id'], { name: 'idx_photos_uploaded_by' });
    await queryInterface.addIndex('photos', ['status'], { name: 'idx_photos_status' });
    await queryInterface.addIndex('photos', ['visibility_type'], { name: 'idx_photos_visibility_type' });
    await queryInterface.addIndex('photos', ['created_at'], { name: 'idx_photos_created_at' });
    await queryInterface.addIndex(
      'photos',
      ['album_id', 'status', 'deleted_at', 'created_at'],
      { name: 'idx_photos_album_active' }
    );
    await queryInterface.addIndex(
      'photos',
      ['album_id', 'visibility_type', 'uploaded_by_id'],
      { name: 'idx_photos_visibility' }
    );

    // ── photo_visibilities ─────────────────────────────────────────────────
    await queryInterface.createTable('photo_visibilities', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      photo_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'photos', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      granted_by_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex(
      'photo_visibilities',
      ['photo_id', 'user_id'],
      { unique: true, name: 'idx_photo_visibility_unique' }
    );
    await queryInterface.addIndex('photo_visibilities', ['photo_id'], { name: 'idx_photo_visibility_photo' });
    await queryInterface.addIndex('photo_visibilities', ['user_id'], { name: 'idx_photo_visibility_user' });
    await queryInterface.addIndex(
      'photo_visibilities',
      ['photo_id', 'user_id'],
      { name: 'idx_photo_visibility_access_check' }
    );

    // ── tags ───────────────────────────────────────────────────────────────
    await queryInterface.createTable('tags', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      slug: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      usage_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      description: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('tags', ['name'], { unique: true, name: 'idx_tags_name_unique' });
    await queryInterface.addIndex('tags', ['slug'], { unique: true, name: 'idx_tags_slug_unique' });
    await queryInterface.addIndex('tags', ['usage_count'], { name: 'idx_tags_usage_count' });

    // Trigram index for fuzzy search on tag names
    await queryInterface.sequelize.query(
      'CREATE INDEX idx_tags_name_trgm ON tags USING gin (name gin_trgm_ops)'
    );

    // ── photo_tags ─────────────────────────────────────────────────────────
    await queryInterface.createTable('photo_tags', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      photo_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'photos', key: 'id' },
        onDelete: 'CASCADE',
      },
      tag_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tags', key: 'id' },
        onDelete: 'CASCADE',
      },
      tagged_by_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      source: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'user',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex(
      'photo_tags',
      ['photo_id', 'tag_id'],
      { unique: true, name: 'idx_photo_tags_unique' }
    );
    await queryInterface.addIndex('photo_tags', ['photo_id'], { name: 'idx_photo_tags_photo' });
    await queryInterface.addIndex('photo_tags', ['tag_id'], { name: 'idx_photo_tags_tag' });
    await queryInterface.addIndex(
      'photo_tags',
      ['tag_id', 'photo_id'],
      { name: 'idx_photo_tags_search' }
    );

    // ── comments ───────────────────────────────────────────────────────────
    await queryInterface.createTable('comments', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      photo_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'photos', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      parent_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'comments', key: 'id' },
        onDelete: 'CASCADE',
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: '{}',
      },
      edited_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('comments', ['photo_id'], { name: 'idx_comments_photo_id' });
    await queryInterface.addIndex('comments', ['user_id'], { name: 'idx_comments_user_id' });
    await queryInterface.addIndex('comments', ['parent_id'], { name: 'idx_comments_parent_id' });
    await queryInterface.addIndex('comments', ['created_at'], { name: 'idx_comments_created_at' });
    await queryInterface.addIndex(
      'comments',
      ['photo_id', 'parent_id', 'created_at'],
      { name: 'idx_comments_photo_thread' }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('comments');
    await queryInterface.dropTable('photo_tags');
    await queryInterface.dropTable('tags');
    await queryInterface.dropTable('photo_visibilities');
    await queryInterface.dropTable('photos');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "photo_status_enum"');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "photo_visibility_enum"');
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS pg_trgm');
  },
};