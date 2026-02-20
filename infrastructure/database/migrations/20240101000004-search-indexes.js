'use strict';

/**
 * Migration: Search Optimization Indexes
 *
 * Adds indexes to optimize search queries:
 *  1. Full-text search (FTS) on albums (name + description)
 *  2. Trigram index on photo filenames (fuzzy search)
 *
 * Note: pg_trgm extension already enabled in Phase 3 migration
 *
 * Run:  npx sequelize-cli db:migrate
 * Undo: npx sequelize-cli db:migrate:undo
 */

module.exports = {
  async up(queryInterface) {
    // ── Full-text search index on albums ───────────────────────────────────
    // Combines name + description into tsvector for fast search
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_albums_fts 
      ON albums 
      USING gin(
        to_tsvector('english', 
          name || ' ' || COALESCE(description, '')
        )
      )
    `);

    // ── Trigram index on photo filenames ───────────────────────────────────
    // Enables fuzzy matching on original_filename
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_photos_filename_trgm 
      ON photos 
      USING gin(original_filename gin_trgm_ops)
    `);

    // ── Additional index: album date (for date range queries) ──────────────
    // Already exists from Phase 2, but adding comment for documentation
    // Index: idx_albums_date (created in 20240101000002-album-domain.js)
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_albums_fts');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_photos_filename_trgm');
  },
};