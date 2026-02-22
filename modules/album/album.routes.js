'use strict';

const { Router } = require('express');

const albumController = require('./controller/album.controller');
const memberController = require('./controller/member.controller');
const invitationController = require('./controller/invitation.controller');

const { authenticate, optionalAuth } = require('../../shared/middleware/authenticate');
const { validate } = require('../../shared/middleware/validate');

const albumValidator = require('./validators/album.validator');
const memberValidator = require('./validators/member.validator');
const invitationValidator = require('./validators/invitation.validator');

/**
 * Album Routes
 * Base path: /api/v1/albums
 *
 * Only album-scoped routes live here.
 * Public invitation token routes are extracted into invitation.routes.js
 */

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ALBUM CRUD
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/',
  optionalAuth,
  validate(albumValidator.listAlbums, 'query'),
  albumController.list
);

router.post(
  '/',
  authenticate,
  validate(albumValidator.createAlbum, 'body'),
  albumController.create
);

router.get(
  '/public/:token',
  albumController.getByPublicToken
);

router.get(
  '/:albumId',
  optionalAuth,
  validate(albumValidator.albumIdParam, 'params'),
  albumController.getOne
);

router.patch(
  '/:albumId',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(albumValidator.updateAlbum, 'body'),
  albumController.update
);

router.delete(
  '/:albumId',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  albumController.remove
);

router.post(
  '/:albumId/restore',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  albumController.restore
);

// ═══════════════════════════════════════════════════════════════════════════
// ALBUM ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/:albumId/activity',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  invitationController.getActivityLog   // moved from invitationController
);

// ═══════════════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/:albumId/members',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(memberValidator.listMembers, 'query'),
  memberController.listMembers
);

router.post(
  '/:albumId/members',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(memberValidator.addMember, 'body'),
  memberController.addMember
);

router.get(
  '/:albumId/members/search',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(memberValidator.searchMembers, 'query'),
  memberController.searchUsers
);

router.delete(
  '/:albumId/members/:userId',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  memberController.removeMember
);

router.patch(
  '/:albumId/members/:userId/role',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  validate(memberValidator.changeMemberRole, 'body'),
  memberController.changeMemberRole
);

router.get(
  '/:albumId/members/:userId/permissions',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  memberController.getEffectivePermissions
);

router.put(
  '/:albumId/members/:userId/permissions/overrides',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  validate(memberValidator.setPermissionOverride, 'body'),
  memberController.setPermissionOverride
);

router.delete(
  '/:albumId/members/:userId/permissions/overrides/:action',
  authenticate,
  validate(memberValidator.memberActionParam, 'params'),
  memberController.removePermissionOverride
);

// ═══════════════════════════════════════════════════════════════════════════
// INVITATIONS (Album-Scoped Only)
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/:albumId/invitations',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(invitationValidator.listInvitations, 'query'),
  invitationController.list
);

router.post(
  '/:albumId/invitations',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(invitationValidator.createInvitation, 'body'),
  invitationController.create
);

router.delete(
  '/:albumId/invitations/:invitationId',
  authenticate,
  validate(invitationValidator.invitationIdParam, 'params'),
  invitationController.revoke
);

module.exports = router;
