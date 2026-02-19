'use strict';

const invitationService = require('../service/invitation.service');
const activityLogService = require('../service/albumActivityLog.service');
const ResponseFormatter = require('../../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../../shared/utils/pagination');

/**
 * Invitation Controller 
 * HTTP layer only.
 */

const create = async (req, res, next) => {
  try {
    const invitation = await invitationService.createInvitation(
      req.body,
      req.params.albumId,
      req.user.id,
      req.user.role,
      req.ip
    );
    return ResponseFormatter.created(res, { invitation }, 'Invitation created');
  } catch (err) {
    next(err);
  }
};

const preview = async (req, res, next) => {
  try {
    const invitation = await invitationService.previewInvitation(req.params.token);
    return ResponseFormatter.success(res, { invitation });
  } catch (err) {
    next(err);
  }
};

const accept = async (req, res, next) => {
  try {
    const member = await invitationService.acceptInvitation(
      req.params.token,
      req.user.id,
      req.ip
    );
    return ResponseFormatter.success(res, { member }, 200, 'Invitation accepted. You are now a member.');
  } catch (err) {
    next(err);
  }
};

const decline = async (req, res, next) => {
  try {
    await invitationService.declineInvitation(req.params.token, req.user.id);
    return ResponseFormatter.success(res, null, 200, 'Invitation declined');
  } catch (err) {
    next(err);
  }
};

const revoke = async (req, res, next) => {
  try {
    await invitationService.revokeInvitation(
      req.params.invitationId,
      req.params.albumId,
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

const list = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await invitationService.listInvitations(
      req.params.albumId,
      req.user.id,
      req.user.role,
      { page, limit }
    );
    return ResponseFormatter.paginated(
      res, result.invitations, buildMeta(result.total, page, limit)
    );
  } catch (err) {
    next(err);
  }
};

const getActivityLog = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const offset = (page - 1) * limit;
    const { rows, count } = await activityLogService.getAlbumActivity(
      req.params.albumId,
      { page, limit, actorId: req.query.actorId, type: req.query.type }
    );
    return ResponseFormatter.paginated(res, rows, buildMeta(count, page, limit));
  } catch (err) {
    next(err);
  }
};

module.exports = { create, preview, accept, decline, revoke, list, getActivityLog };