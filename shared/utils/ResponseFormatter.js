'use strict';

/**
 * API Response Formatter
 *
 * Enforces a consistent response envelope across all endpoints.
 *
 * Success shape:
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "page": 1, "total": 100 }   // optional, for paginated responses
 * }
 *
 * Error shape:
 * {
 *   "success": false,
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Album not found"
 *     "details": [ ... ]   // optional, for validation errors
 *   }
 * }
 *
 * Usage:
 *   return ResponseFormatter.success(res, { user }, 201);
 *   return ResponseFormatter.paginated(res, albums, { page: 1, total: 50, limit: 10 });
 *   return ResponseFormatter.error(res, error);
 */

class ResponseFormatter {
  /**
   * Standard success response.
   * @param {Response} res - Express response object
   * @param {*} data - Payload to return
   * @param {number} statusCode - HTTP status (default 200)
   * @param {string} message - Optional human-readable message
   */
  static success(res, data = null, statusCode = 200, message = null) {
    const body = { success: true };
    if (message) body.message = message;
    if (data !== null && data !== undefined) body.data = data;
    return res.status(statusCode).json(body);
  }

  /**
   * Paginated list response.
   * @param {Response} res
   * @param {Array} items - Array of records
   * @param {object} pagination - { page, limit, total, totalPages }
   */
  static paginated(res, items, pagination) {
    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.ceil(pagination.total / pagination.limit),
        hasNextPage: pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrevPage: pagination.page > 1,
      },
    });
  }

  /**
   * Created response (201).
   */
  static created(res, data, message = 'Created successfully') {
    return ResponseFormatter.success(res, data, 201, message);
  }

  /**
   * No content response (204).
   */
  static noContent(res) {
    return res.status(204).send();
  }

  /**
   * Error response — used by global error handler.
   * @param {Response} res
   * @param {AppError} error
   */
  static error(res, error) {
    const body = {
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred',
      },
    };

    if (error.details) {
      body.error.details = error.details;
    }

    return res.status(error.statusCode || 500).json(body);
  }
}

module.exports = ResponseFormatter;