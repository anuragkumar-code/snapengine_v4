'use strict';

const Joi = require('joi');
const { ALBUM_ROLE } = require('../../../shared/constants');

/**
 * Member Validators
 * Covers: add member, change role, set override, list members
 */

// Allowed non-owner roles for assignment
const assignableRoles = Object.values(ALBUM_ROLE).filter((r) => r !== ALBUM_ROLE.OWNER);

const addMember = Joi.object({
  userId: Joi.string().uuid().required()
    .messages({ 'string.guid': 'userId must be a valid UUID' }),

  role: Joi.string()
    .valid(...assignableRoles)
    .default(ALBUM_ROLE.VIEWER)
    .messages({ 'any.only': `Role must be one of: ${assignableRoles.join(', ')}` }),
});

const changeMemberRole = Joi.object({
  role: Joi.string()
    .valid(...assignableRoles)
    .required()
    .messages({ 'any.only': `Role must be one of: ${assignableRoles.join(', ')}` }),
});

const setPermissionOverride = Joi.object({
  action: Joi.string().trim().min(1).max(64).required()
    .messages({ 'string.empty': 'Action is required' }),

  granted: Joi.boolean().required()
    .messages({ 'any.required': 'granted (true/false) is required' }),

  reason: Joi.string().trim().max(500).allow('', null).optional(),
});

const listMembers = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const searchMembers = Joi.object({
  q: Joi.string().trim().min(2).max(100).required()
    .messages({ 'string.min': 'Search query must be at least 2 characters' }),
  limit: Joi.number().integer().min(1).max(20).default(10),
});

const memberUserIdParam = Joi.object({
  albumId: Joi.string().uuid().required(),
  userId: Joi.string().uuid().required(),
});

const memberActionParam = Joi.object({
  albumId: Joi.string().uuid().required(),
  userId: Joi.string().uuid().required(),
  action: Joi.string().trim().min(1).max(64).required(),
});

module.exports = {
  addMember,
  changeMemberRole,
  setPermissionOverride,
  listMembers,
  searchMembers,
  memberUserIdParam,
  memberActionParam,
};
