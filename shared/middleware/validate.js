'use strict';

const Joi = require('joi');
const { ValidationError } = require('../utils/AppError');

/**
 * Validation Middleware + Utility
 *
 * - Used in routes as Express middleware
 * - Also reusable in service layer if needed
 */

const defaultOptions = {
  abortEarly: false,
  stripUnknown: true,
  convert: true,
};

/**
 * Express middleware factory
 *
 * Usage:
 *   validate(schema, 'body')
 *   validate(schema, 'query')
 *   validate(schema, 'params')
 */
const validate = (schema, source = 'body', options = {}) => {
  return (req, res, next) => {
    const data = req[source];

    const { error, value } = schema.validate(data, {
      ...defaultOptions,
      ...options,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
        type: d.type,
      }));

      return next(new ValidationError('Validation failed', details));
    }

    // Replace request data with validated & sanitized value
    req[source] = value;

    next();
  };
};

/**
 * Direct validation utility (for service-layer use)
 */
const validateOrThrow = (schema, data, options = {}) => {
  const { error, value } = schema.validate(data, {
    ...defaultOptions,
    ...options,
  });

  if (error) {
    const details = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message.replace(/['"]/g, ''),
      type: d.type,
    }));

    throw new ValidationError('Validation failed', details);
  }

  return value;
};

/**
 * Common reusable schema fragments
 */
const commonSchemas = {
  uuid: Joi.string().uuid({ version: 'uuidv4' }),

  email: Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .max(320),

  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .messages({
      'string.pattern.base':
        'Password must include uppercase, lowercase, and a number',
    }),

  mobile: Joi.string()
    .pattern(/^\+?[1-9]\d{7,14}$/)
    .messages({
      'string.pattern.base':
        'Mobile number must be in international format (e.g. +14155552671)',
    }),

  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  },
};

module.exports = {
  validate,
  validateOrThrow,
  commonSchemas,
  Joi,
};
