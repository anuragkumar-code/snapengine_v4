'use strict';

const { Router } = require('express');
const invitationController = require('./controller/invitation.controller');

const { authenticate } = require('../../shared/middleware/authenticate');
const { validate } = require('../../shared/middleware/validate');
const invitationValidator = require('./validators/invitation.validator');

/**
 * Invitation Token Routes
 * Base path: /api/v1/invitations
 *
 * These routes are NOT album-scoped.
 * The invitation token itself acts as the credential.
 *
 * Mounted in app.js as:
 *   app.use(`${API_PREFIX}/invitations`, invitationRoutes);
 */

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// INVITATION TOKEN ACTIONS (Public Access via Token)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/v1/invitations/:token
 * @desc    Preview invitation (album name, inviter, role offered)
 * @access  Public — token acts as credential
 */
router.get(
  '/:token',
  validate(invitationValidator.tokenParam, 'params'),
  invitationController.preview
);

/**
 * @route   POST /api/v1/invitations/:token/accept
 * @desc    Accept invitation and join album
 * @access  Authenticated (must be logged in)
 */
router.post(
  '/:token/accept',
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
  '/:token/decline',
  authenticate,
  validate(invitationValidator.tokenParam, 'params'),
  invitationController.decline
);

module.exports = router;
