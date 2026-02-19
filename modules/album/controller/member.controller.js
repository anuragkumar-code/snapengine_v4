'use strict';

const memberService = require('../service/albumMember.service');
const ResponseFormatter = require('../../../shared/utils/ResponseFormatter');
const { parsePagination, buildMeta } = require('../../../shared/utils/pagination');

/**
 * Member Controller
 * HTTP layer only.
 */

const listMembers = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await memberService.listMembers(
      req.params.albumId, req.user.id, req.user.role, { page, limit }
    );
    return ResponseFormatter.paginated(res, result.members, buildMeta(result.total, page, limit));
  } catch (err) {
    next(err);
  }
};

const addMember = async (req, res, next) => {
  try {
    const member = await memberService.addMember(
      req.params.albumId,
      req.body.userId,
      req.body.role,
      req.user.id,
      req.user.role,
      req.ip
    );
    return ResponseFormatter.created(res, { member }, 'Member added successfully');
  } catch (err) {
    next(err);
  }
};

const removeMember = async (req, res, next) => {
  try {
    await memberService.removeMember(
      req.params.albumId,
      req.params.userId,
      req.user.id,
      req.user.role,
      req.ip
    );
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

const changeMemberRole = async (req, res, next) => {
  try {
    const member = await memberService.changeMemberRole(
      req.params.albumId,
      req.params.userId,
      req.body.role,
      req.user.id,
      req.user.role,
      req.ip
    );
    return ResponseFormatter.success(res, { member }, 200, 'Role updated');
  } catch (err) {
    next(err);
  }
};

const setPermissionOverride = async (req, res, next) => {
  try {
    const override = await memberService.setPermissionOverride(
      req.params.albumId,
      req.params.userId,
      req.body.action,
      req.body.granted,
      req.user.id,
      req.user.role,
      req.body.reason,
      req.ip
    );
    return ResponseFormatter.success(res, { override }, 200, 'Permission override applied');
  } catch (err) {
    next(err);
  }
};

const removePermissionOverride = async (req, res, next) => {
  try {
    await memberService.removePermissionOverride(
      req.params.albumId,
      req.params.userId,
      req.params.action,
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.noContent(res);
  } catch (err) {
    next(err);
  }
};

const getEffectivePermissions = async (req, res, next) => {
  try {
    const permissions = await memberService.getMemberEffectivePermissions(
      req.params.albumId,
      req.params.userId,
      req.user.id,
      req.user.role
    );
    return ResponseFormatter.success(res, { permissions });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listMembers,
  addMember,
  removeMember,
  changeMemberRole,
  setPermissionOverride,
  removePermissionOverride,
  getEffectivePermissions,
};