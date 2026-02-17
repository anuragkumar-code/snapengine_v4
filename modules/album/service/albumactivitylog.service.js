'use strict';

const db = require('../../../infrastructure/database');
const logger = require('../../../infrastructure/logger');

/**
 * AlbumActivityLogService
 *
 * Single responsibility: write activity log entries for album domain events.
 * Called from AlbumService, MemberService, InvitationService after
 * every state-changing operation.
 *
 * Two write modes:
 *  1. Synchronous (direct DB write) — for critical operations where log
 *     must be guaranteed before response (e.g. album deletion)
 *  2. Asynchronous (via queue worker) — for non-critical high-frequency events
 *     (e.g. photo views). Worker calls logActivity() directly.
 *
 * Records are immutable once written (enforced by model hook).
 */

/**
 * Write an activity log entry synchronously.
 *
 * @param {object} params
 * @param {string} params.albumId
 * @param {string|null} params.actorId
 * @param {string} params.type           - ACTIVITY_TYPE constant
 * @param {string|null} [params.targetId]
 * @param {string|null} [params.targetType]
 * @param {object} [params.metadata]
 * @param {string|null} [params.ipAddress]
 * @param {object} [params.transaction]  - Sequelize transaction (optional)
 * @returns {Promise<AlbumActivityLog>}
 */
const logActivity = async ({
  albumId,
  actorId = null,
  type,
  targetId = null,
  targetType = null,
  metadata = {},
  ipAddress = null,
  transaction = null,
}) => {
  try {
    const { AlbumActivityLog } = db;
    const entry = await AlbumActivityLog.create(
      {
        albumId,
        actorId,
        type,
        targetId,
        targetType,
        metadata,
        ipAddress,
      },
      { transaction }
    );

    logger.debug('[ActivityLog] Entry written', { albumId, type, actorId });
    return entry;
  } catch (err) {
    // Activity logging must never crash the main operation
    logger.error('[ActivityLog] Failed to write entry', {
      albumId,
      type,
      actorId,
      error: err.message,
    });
    // Swallow — do not re-throw
  }
};

/**
 * Get paginated activity log for an album.
 *
 * @param {string} albumId
 * @param {object} options - { page, limit, actorId, type }
 * @returns {Promise<{ rows: AlbumActivityLog[], count: number }>}
 */
const getAlbumActivity = async (albumId, { page = 1, limit = 20, actorId, type } = {}) => {
  const { AlbumActivityLog, User } = db;
  const { Op } = require('sequelize');

  const where = { albumId };
  if (actorId) where.actorId = actorId;
  if (type) where.type = type;

  const offset = (page - 1) * limit;

  return AlbumActivityLog.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: User,
        as: 'actor',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
        required: false,
      },
    ],
  });
};

module.exports = { logActivity, getAlbumActivity };