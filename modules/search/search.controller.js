'use strict';

const searchService = require('./search.service');
const ResponseFormatter = require('../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../shared/utils/pagination');

/**
 * Search Controller
 *
 * Single search endpoint that switches behavior based on context parameter.
 */

const search = async (req, res, next) => {
  try {
    const { q: query, context, albumId, dateFrom, dateTo } = req.query;
    const { page, limit } = parsePagination(req.query);
    const userId = req.user?.id || null;
    const systemRole = req.user?.role || 'user';

    let result;

    switch (context) {
      case 'albums':
        // Search albums
        result = await searchService.searchAlbums(query, userId, {
          page,
          limit,
          dateFrom,
          dateTo,
        });
        break;

      case 'photos':
        if (albumId) {
          // Search photos within specific album
          result = await searchService.searchPhotosInAlbum(
            query,
            albumId,
            userId,
            systemRole,
            { page, limit, dateFrom, dateTo }
          );
        } else {
          // Global photo search (cross-album)
          result = await searchService.searchPhotosGlobal(query, userId, systemRole, {
            page,
            limit,
            dateFrom,
            dateTo,
          });
        }
        break;

      default:
        // Default to album search if context not specified
        result = await searchService.searchAlbums(query, userId, {
          page,
          limit,
          dateFrom,
          dateTo,
        });
        break;
    }

    return ResponseFormatter.success(res, {
      results: result.results,
      query: result.query,
      context: result.context,
      ...(result.albumId && { albumId: result.albumId }),
    }, 200, null, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

module.exports = { search };