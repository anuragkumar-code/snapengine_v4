'use strict';

const photoBulkService = require('../service/photobulk.service');
const ResponseFormatter = require('../../../shared/utils/ResponseFormatter');

/**
 * PhotoBulk Controller
 * HTTP layer for bulk photo operations.
 */

const bulkDelete = async (req, res, next) => {
  try {
    const result = await photoBulkService.bulkDeletePhotos(
      req.params.albumId,
      req.body.photoIds,
      req.user.id,
      req.user.role,
      req.ip
    );

    return ResponseFormatter.success(
      res,
      result,
      200,
      `${result.deletedCount} photo(s) moved to trash`
    );
  } catch (err) {
    next(err);
  }
};

const bulkChangeVisibility = async (req, res, next) => {
  try {
    const result = await photoBulkService.bulkChangeVisibility(
      req.params.albumId,
      req.body.photoIds,
      req.body.visibilityType,
      req.body.allowedUserIds || [],
      req.user.id,
      req.user.role,
      req.ip
    );

    return ResponseFormatter.success(
      res,
      { updatedCount: result.updatedCount, photos: result.photos },
      200,
      `Visibility updated for ${result.updatedCount} photo(s)`
    );
  } catch (err) {
    next(err);
  }
};

module.exports = {
  bulkDelete,
  bulkChangeVisibility,
};