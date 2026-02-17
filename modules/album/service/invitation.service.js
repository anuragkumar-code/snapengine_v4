'use strict';

const db = require('../../../infrastructure/database');
const permissionService = require('./albumPermission.service');
const activityLogService = require('./albumActivityLog.service');
const { dispatch, QUEUE_NAMES } = require('../../../infrastructure/queue');
const { JOB_NAMES, INVITATION_STATUS, ALBUM_ROLE, ACTIVITY_TYPE } = require('../../../shared/constants');
const {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  InvalidTokenError,
  GoneError,
} = require('../../../shared/utils/AppError');
const logger = require('../../../infrastructure/logger');
const config = require('../../../config');

/**
 * InvitationService
 *
 * Manages the full invitation lifecycle:
 *  create → share → preview → accept/decline → revoke
 *
 * Edge cases:
 *  - Album goes private after invitation issued: invitation still activatable
 *    but user joins as private member (no public access)
 *  - User already a member tries to accept: return 409
 *  - Expired invitation accessed: lazily update status to 'expired', return 410
 *  - Revoked invitation: return 410
 *  - Re-invite of previously removed member: allowed (creates new invitation)
 */

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default

// ── Create Invitation ──────────────────────────────────────────────────────
/**
 * Create a shareable invitation token for an album.
 * Requires invitation:create permission.
 *
 * @param {object} data - { invitedEmail?, invitedRole, note?, expiresInMs? }
 * @param {string} albumId
 * @param {string} requesterId
 * @param {string} systemRole
 */
const createInvitation = async (data, albumId, requesterId, systemRole, ipAddress) => {
  await permissionService.assertPermission(albumId, requesterId, 'invitation:create', systemRole);

  const { Invitation, AlbumMember, User, Album } = db;
  const album = await Album.findByPk(albumId);

  // Cannot invite with owner role
  if (data.invitedRole === ALBUM_ROLE.OWNER) {
    throw new ForbiddenError('Cannot invite a user as album owner');
  }

  // Requester cannot invite to a role >= their own
  const requesterMember = await AlbumMember.findOne({ where: { albumId, userId: requesterId } });
  if (requesterMember && requesterMember.role !== ALBUM_ROLE.OWNER) {
    permissionService.assertRoleChangeAllowed(requesterMember.role, 'viewer', data.invitedRole);
  }

  // If targeting a specific email, check they're not already a member
  if (data.invitedEmail) {
    const existingUser = await User.findOne({ where: { email: data.invitedEmail } });
    if (existingUser) {
      const alreadyMember = await AlbumMember.findOne({
        where: { albumId, userId: existingUser.id },
      });
      if (alreadyMember) {
        throw new ConflictError('This user is already a member of the album');
      }
    }

    // Invalidate any existing pending invitation for this email+album
    await Invitation.update(
      { status: INVITATION_STATUS.REVOKED },
      {
        where: {
          albumId,
          invitedEmail: data.invitedEmail,
          status: INVITATION_STATUS.PENDING,
        },
      }
    );
  }

  const { rawToken, hashedToken } = Invitation.generateToken();
  const expiresAt = new Date(Date.now() + (data.expiresInMs || INVITATION_EXPIRY_MS));

  const invitation = await Invitation.create({
    albumId,
    invitedById: requesterId,
    invitedEmail: data.invitedEmail || null,
    invitedRole: data.invitedRole || ALBUM_ROLE.VIEWER,
    tokenHash: hashedToken,
    status: INVITATION_STATUS.PENDING,
    expiresAt,
    maxUses: data.maxUses || 1,
    note: data.note || null,
  });

  // Dispatch email if email was provided
  if (data.invitedEmail) {
    await dispatch(QUEUE_NAMES.NOTIFICATION_EMAIL, JOB_NAMES.SEND_INVITATION_EMAIL, {
      albumId,
      albumName: album.name,
      invitedEmail: data.invitedEmail,
      invitedRole: data.invitedRole,
      rawToken,
      expiresAt,
    }).catch((err) =>
      logger.error('[InvitationService] Failed to dispatch invitation email', { error: err.message })
    );
  }

  logger.info('[InvitationService] Invitation created', {
    albumId, invitedEmail: data.invitedEmail, role: data.invitedRole,
  });

  return {
    ...invitation.toSafeJSON(),
    // Return raw token ONCE — this is the only time it's exposed
    token: rawToken,
  };
};

// ── Preview Invitation ─────────────────────────────────────────────────────
/**
 * Preview invitation details before accepting.
 * Public endpoint — no auth required (token is the credential).
 */
const previewInvitation = async (rawToken) => {
  const { Invitation, Album, User } = db;

  const hashedToken = Invitation.hashToken(rawToken);

  const invitation = await Invitation.findOne({
    where: { tokenHash: hashedToken },
    include: [
      {
        model: Album,
        as: 'album',
        attributes: ['id', 'name', 'description', 'isPublic', 'masterImageUrl'],
      },
      {
        model: User,
        as: 'invitedBy',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
      },
    ],
  });

  if (!invitation) throw new InvalidTokenError('Invitation not found or invalid');

  // Lazily expire if past expiry
  const wasExpired = await invitation.expireIfStale();
  if (wasExpired) throw new GoneError('This invitation has expired');

  if (invitation.status === INVITATION_STATUS.REVOKED) {
    throw new GoneError('This invitation has been revoked');
  }

  if (invitation.status === INVITATION_STATUS.ACCEPTED && invitation.maxUses === 1) {
    throw new GoneError('This invitation has already been used');
  }

  return invitation.toSafeJSON();
};

// ── Accept Invitation ──────────────────────────────────────────────────────
/**
 * Accept an invitation and join the album.
 * Requires authenticated user.
 */
const acceptInvitation = async (rawToken, userId, ipAddress) => {
  const { Invitation, AlbumMember, User } = db;

  const hashedToken = Invitation.hashToken(rawToken);

  const invitation = await Invitation.findOne({
    where: { tokenHash: hashedToken },
  });

  if (!invitation) throw new InvalidTokenError('Invitation not found or invalid');

  const wasExpired = await invitation.expireIfStale();
  if (wasExpired) throw new GoneError('This invitation has expired');

  if (!invitation.isValid()) {
    const statusMsg = {
      [INVITATION_STATUS.ACCEPTED]: 'This invitation has already been used',
      [INVITATION_STATUS.DECLINED]: 'This invitation was declined',
      [INVITATION_STATUS.REVOKED]: 'This invitation has been revoked',
      [INVITATION_STATUS.EXPIRED]: 'This invitation has expired',
    };
    throw new GoneError(statusMsg[invitation.status] || 'This invitation is no longer valid');
  }

  // Check if user is already a member
  const existingMember = await AlbumMember.findOne({
    where: { albumId: invitation.albumId, userId },
  });
  if (existingMember) {
    throw new ConflictError('You are already a member of this album');
  }

  const t = await db.sequelize.transaction();
  try {
    // Create membership
    const member = await AlbumMember.create(
      {
        albumId: invitation.albumId,
        userId,
        role: invitation.invitedRole,
        addedById: invitation.invitedById,
      },
      { transaction: t }
    );

    // Update invitation: increment uses, mark accepted if single-use
    const newUseCount = invitation.useCount + 1;
    const newStatus =
      invitation.maxUses && newUseCount >= invitation.maxUses
        ? INVITATION_STATUS.ACCEPTED
        : INVITATION_STATUS.PENDING;

    await invitation.update(
      {
        useCount: newUseCount,
        status: newStatus,
        acceptedAt: newStatus === INVITATION_STATUS.ACCEPTED ? new Date() : invitation.acceptedAt,
      },
      { transaction: t }
    );

    await t.commit();

    await activityLogService.logActivity({
      albumId: invitation.albumId,
      actorId: userId,
      type: ACTIVITY_TYPE.MEMBER_ADDED,
      targetId: userId,
      targetType: 'user',
      metadata: { role: invitation.invitedRole, via: 'invitation', invitationId: invitation.id },
      ipAddress,
    });

    logger.info('[InvitationService] Invitation accepted', {
      albumId: invitation.albumId, userId, role: invitation.invitedRole,
    });

    return member.toSafeJSON();
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

// ── Decline Invitation ─────────────────────────────────────────────────────
const declineInvitation = async (rawToken, userId) => {
  const { Invitation } = db;

  const hashedToken = Invitation.hashToken(rawToken);
  const invitation = await Invitation.findOne({ where: { tokenHash: hashedToken } });

  if (!invitation) throw new InvalidTokenError('Invitation not found');
  if (!invitation.isValid()) throw new GoneError('This invitation is no longer valid');

  await invitation.update({ status: INVITATION_STATUS.DECLINED });

  logger.info('[InvitationService] Invitation declined', { invitationId: invitation.id, userId });
};

// ── Revoke Invitation ──────────────────────────────────────────────────────
/**
 * Revoke an outstanding invitation. Requires admin+ permission.
 */
const revokeInvitation = async (invitationId, albumId, requesterId, systemRole) => {
  await permissionService.assertPermission(albumId, requesterId, 'invitation:create', systemRole);

  const { Invitation } = db;

  const invitation = await Invitation.findOne({
    where: { id: invitationId, albumId },
  });
  if (!invitation) throw new NotFoundError('Invitation');

  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw new ConflictError(`Cannot revoke an invitation with status "${invitation.status}"`);
  }

  await invitation.update({ status: INVITATION_STATUS.REVOKED });

  logger.info('[InvitationService] Invitation revoked', { invitationId, revokedBy: requesterId });
};

// ── List Invitations ───────────────────────────────────────────────────────
const listInvitations = async (albumId, requesterId, systemRole, { page = 1, limit = 20 } = {}) => {
  await permissionService.assertPermission(albumId, requesterId, 'invitation:create', systemRole);

  const { Invitation, User } = db;
  const offset = (page - 1) * limit;

  const { rows, count } = await Invitation.findAndCountAll({
    where: { albumId },
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: User,
        as: 'invitedBy',
        attributes: ['id', 'firstName', 'lastName'],
      },
    ],
    attributes: { exclude: ['tokenHash'] },
  });

  return {
    invitations: rows.map((i) => i.toSafeJSON()),
    total: count,
    page,
    limit,
  };
};

module.exports = {
  createInvitation,
  previewInvitation,
  acceptInvitation,
  declineInvitation,
  revokeInvitation,
  listInvitations,
};