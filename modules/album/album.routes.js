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
 * Validation is applied at the route level via validate() middleware.
 * Controllers receive req.body/params/query that is already clean and typed.
 *
 * Auth strategy:
 *  - optionalAuth  → Public albums accessible to all, extra data if authenticated
 *  - authenticate  → Requires valid JWT (write operations, member management)
 */

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ALBUM CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/albums
 * @desc    List albums (public + authenticated user's private albums)
 * @access  Public (enriched if authenticated)
 */
router.get(
  '/',
  optionalAuth,
  validate(albumValidator.listAlbums, 'query'),
  albumController.list
);

/**
 * @route   POST /api/v1/albums
 * @desc    Create a new album
 * @access  Authenticated
 */
router.post(
  '/',
  authenticate,
  validate(albumValidator.createAlbum, 'body'),
  albumController.create
);

/**
 * @route   GET /api/v1/albums/public/:token
 * @desc    Get album by public share token (no auth needed)
 * @access  Public
 * NOTE: this must be defined BEFORE /:albumId to avoid route conflict
 */
router.get(
  '/public/:token',
  albumController.getByPublicToken
);

/**
 * @route   GET /api/v1/albums/:albumId
 * @desc    Get single album by ID
 * @access  Public (if public album) / Authenticated (if private)
 */
router.get(
  '/:albumId',
  optionalAuth,
  validate(albumValidator.albumIdParam, 'params'),
  albumController.getOne
);

/**
 * @route   PATCH /api/v1/albums/:albumId
 * @desc    Update album fields
 * @access  Authenticated — Admin+ role in album
 */
router.patch(
  '/:albumId',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(albumValidator.updateAlbum, 'body'),
  albumController.update
);

/**
 * @route   DELETE /api/v1/albums/:albumId
 * @desc    Soft delete album
 * @access  Authenticated — Owner only
 */
router.delete(
  '/:albumId',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  albumController.remove
);

/**
 * @route   POST /api/v1/albums/:albumId/restore
 * @desc    Restore soft-deleted album
 * @access  Authenticated — Owner or system admin
 */
router.post(
  '/:albumId/restore',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  albumController.restore
);

// ═══════════════════════════════════════════════════════════════════════════
// ALBUM ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/albums/:albumId/activity
 * @desc    Paginated activity log for an album
 * @access  Authenticated — any member
 */
router.get(
  '/:albumId/activity',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  invitationController.getActivityLog
);

// ═══════════════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/albums/:albumId/members
 * @desc    List album members
 * @access  Authenticated — any member
 */
router.get(
  '/:albumId/members',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(memberValidator.listMembers, 'query'),
  memberController.listMembers
);

/**
 * @route   POST /api/v1/albums/:albumId/members
 * @desc    Add a member directly (without invitation)
 * @access  Authenticated — Admin+ role
 */
router.post(
  '/:albumId/members',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(memberValidator.addMember, 'body'),
  memberController.addMember
);

/**
 * @route   DELETE /api/v1/albums/:albumId/members/:userId
 * @desc    Remove a member (self-removal or admin+)
 * @access  Authenticated
 */
router.delete(
  '/:albumId/members/:userId',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  memberController.removeMember
);

/**
 * @route   PATCH /api/v1/albums/:albumId/members/:userId/role
 * @desc    Change a member's role
 * @access  Authenticated — Admin+ role
 */
router.patch(
  '/:albumId/members/:userId/role',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  validate(memberValidator.changeMemberRole, 'body'),
  memberController.changeMemberRole
);

/**
 * @route   GET /api/v1/albums/:albumId/members/:userId/permissions
 * @desc    Get effective permissions for a member (with overrides applied)
 * @access  Authenticated — any member
 */
router.get(
  '/:albumId/members/:userId/permissions',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  memberController.getEffectivePermissions
);

/**
 * @route   PUT /api/v1/albums/:albumId/members/:userId/permissions/overrides
 * @desc    Set a permission override for a member
 * @access  Authenticated — Admin+ role
 */
router.put(
  '/:albumId/members/:userId/permissions/overrides',
  authenticate,
  validate(memberValidator.memberUserIdParam, 'params'),
  validate(memberValidator.setPermissionOverride, 'body'),
  memberController.setPermissionOverride
);

/**
 * @route   DELETE /api/v1/albums/:albumId/members/:userId/permissions/overrides/:action
 * @desc    Remove a specific permission override for a member
 * @access  Authenticated — Admin+ role
 */
router.delete(
  '/:albumId/members/:userId/permissions/overrides/:action',
  authenticate,
  validate(memberValidator.memberActionParam, 'params'),
  memberController.removePermissionOverride
);

// ═══════════════════════════════════════════════════════════════════════════
// INVITATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/albums/:albumId/invitations
 * @desc    List all invitations for an album
 * @access  Authenticated — Admin+ role
 */
router.get(
  '/:albumId/invitations',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(invitationValidator.listInvitations, 'query'),
  invitationController.list
);

/**
 * @route   POST /api/v1/albums/:albumId/invitations
 * @desc    Create a new invitation token
 * @access  Authenticated — Contributor+ role
 */
router.post(
  '/:albumId/invitations',
  authenticate,
  validate(albumValidator.albumIdParam, 'params'),
  validate(invitationValidator.createInvitation, 'body'),
  invitationController.create
);

/**
 * @route   DELETE /api/v1/albums/:albumId/invitations/:invitationId
 * @desc    Revoke an outstanding invitation
 * @access  Authenticated — Admin+ role
 */
router.delete(
  '/:albumId/invitations/:invitationId',
  authenticate,
  validate(invitationValidator.invitationIdParam, 'params'),
  invitationController.revoke
);

// ═══════════════════════════════════════════════════════════════════════════
// INVITATION TOKEN ACTIONS (public — token is the credential)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/invitations/:token
 * @desc    Preview invitation (album name, who invited, role offered)
 * @access  Public — token acts as credential
 */
router.get(
  '/invitations/:token',
  validate(invitationValidator.tokenParam, 'params'),
  invitationController.preview
);

/**
 * @route   POST /api/v1/invitations/:token/accept
 * @desc    Accept invitation and join album
 * @access  Authenticated (must be logged in to join)
 */
router.post(
  '/invitations/:token/accept',
  authenticate,
  validate(invitationValidator.tokenParam, 'params'),
  invitationController.accept
);

/**
 * @route   POST /api/v1/invitations/:token/decline
 * @desc    Decline an invitation
 * @access  Authenticated
 */
router.post(
  '/invitations/:token/decline',
  authenticate,
  validate(invitationValidator.tokenParam, 'params'),
  invitationController.decline
);

module.exports = router;