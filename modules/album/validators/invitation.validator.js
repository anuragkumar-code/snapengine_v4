'use strict';

const Joi = require('joi');
const { ALBUM_ROLE } = require('../../../shared/constants');

/**
 * Invitation Validators
 * Covers: create, preview, accept, decline, revoke, list
 */

const assignableRoles = Object.values(ALBUM_ROLE).filter((r) => r !== ALBUM_ROLE.OWNER);

const createInvitation = Joi.object({
  invitedEmail: Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .max(320)
    .optional()
    .allow(null),

  invitedRole: Joi.string()
    .valid(...assignableRoles)
    .default(ALBUM_ROLE.VIEWER)
    .messages({ 'any.only': `Role must be one of: ${assignableRoles.join(', ')}` }),

  note: Joi.string().trim().max(500).allow('', null).optional(),

  maxUses: Joi.number().integer().min(1).max(100).default(1),

  expiresInMs: Joi.number()
    .integer()
    .min(60 * 60 * 1000)           // min 1 hour
    .max(30 * 24 * 60 * 60 * 1000) // max 30 days
    .optional(),
});

const tokenParam = Joi.object({
  token: Joi.string().length(64).hex().required()
    .messages({
      'string.length': 'Invalid invitation token format',
      'string.hex': 'Invalid invitation token format',
    }),
});

const invitationIdParam = Joi.object({
  albumId: Joi.string().uuid().required(),
  invitationId: Joi.string().uuid().required(),
});

const listInvitations = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = {
  createInvitation,
  tokenParam,
  invitationIdParam,
  listInvitations,
};