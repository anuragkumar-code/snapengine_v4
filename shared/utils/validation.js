'use strict';

const Joi = require('joi');
const { ValidationError } = require('./AppError');

/**
 * Validation Utility
 *
 * Wraps Joi validation with consistent error formatting.
 * All service-layer inputs pass through here before processing.
 *
 * Usage:
 *   const { error, value } = validate(schema, req.body);
 *   // OR
 *   const value = validateOrThrow(schema, req.body); // throws ValidationError
 */

const defaultOptions = {
  abortEarly: false,      // Collect ALL errors, not just the first
  stripUnknown: true,     // Remove keys not in schema
  convert: true,          // Type coercion (string → number where schema expects it)
};

/**
 * Validate data against a Joi schema.
 * Returns { error, value } — never throws.
 */
const validate = (schema, data, options = {}) => {
  return schema.validate(data, { ...defaultOptions, ...options });
};

/**
 * Validate and throw ValidationError if invalid.
 * Returns cleaned, validated value on success.
 */
const validateOrThrow = (schema, data, options = {}) => {
  const { error, value } = validate(schema, data, options);
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
 * Common reusable schema fragments.
 * Import these in module-specific validation schemas.
 */
const commonSchemas = {
  uuid: Joi.string().uuid({ version: 'uuidv4' }),
  email: Joi.string().email({ tlds: { allow: false } }).lowercase().trim().max(320),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .message(
      'Password must be at least 8 characters and include uppercase, lowercase, and a number'
    ),
  mobile: Joi.string()
    .pattern(/^\+?[1-9]\d{7,14}$/)
    .message('Mobile number must be in international format (e.g. +14155552671)'),
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