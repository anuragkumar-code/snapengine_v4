'use strict';

/**
 * Pagination Helper
 *
 * Provides consistent pagination across all list endpoints.
 * Works with Sequelize's findAndCountAll().
 *
 * Usage:
 *   const { limit, offset, page } = parsePagination(req.query);
 *   const { rows, count } = await Model.findAndCountAll({ limit, offset });
 *   return ResponseFormatter.paginated(res, rows, buildMeta(count, page, limit));
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Extract and sanitize pagination params from query string.
 * @param {object} query - req.query
 * @returns {{ page: number, limit: number, offset: number }}
 */
const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT)
  );
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * Build pagination meta object for ResponseFormatter.paginated().
 * @param {number} total - Total count from Sequelize
 * @param {number} page
 * @param {number} limit
 */
const buildMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

module.exports = { parsePagination, buildMeta, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT };