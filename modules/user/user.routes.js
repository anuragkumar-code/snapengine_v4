'use strict';

const { Router } = require('express');
const userService = require('./service/user.service');
const ResponseFormatter = require('../../shared/utils/ResponseFormatter');
const { authenticate, requireRole } = require('../../shared/middleware/authenticate');
const { parsePagination, buildMeta } = require('../../shared/utils/pagination');
const { createUploadMiddleware } = require('../../infrastructure/upload');
const { storageProvider } = require('../../infrastructure/upload');

// ── Controller ─────────────────────────────────────────────────────────────

const getProfile = async (req, res, next) => {
  try {
    const targetId = req.params.id === 'me' ? req.user.id : req.params.id;
    const user = await userService.getProfile(targetId, req.user);
    return ResponseFormatter.success(res, { user });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const targetId = req.params.id === 'me' ? req.user.id : req.params.id;
    const user = await userService.updateProfile(targetId, req.body, req.user);
    return ResponseFormatter.success(res, { user }, 200, 'Profile updated');
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    await userService.changePassword(req.user.id, req.body);
    return ResponseFormatter.success(res, null, 200, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
};

const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      const { ValidationError } = require('../../shared/utils/AppError');
      throw new ValidationError('No file uploaded');
    }

    const result = await storageProvider.save(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'avatars'
    );

    const { avatarUrl } = await userService.updateAvatar(req.user.id, result);

    return ResponseFormatter.success(
      res,
      { avatarUrl },
      200,
      'Avatar updated successfully'
    );
  } catch (err) {
    next(err);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, role } = req.query;

    const result = await userService.listUsers({ page, limit, status, role });

    return ResponseFormatter.paginated(
      res,
      result.users,
      buildMeta(result.total, page, limit)
    );
  } catch (err) {
    next(err);
  }
};

// ── Routes ─────────────────────────────────────────────────────────────────

const router = Router();
const avatarUpload = createUploadMiddleware({ fieldName: 'avatar' });

/**
 * @route   GET /api/v1/users/me
 * @desc    Get own profile (shorthand for /users/:id with id=me)
 */
router.get('/me', authenticate, getProfile);

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user profile by ID
 */
router.get('/:id', authenticate, getProfile);

/**
 * @route   PATCH /api/v1/users/me
 * @desc    Update own profile
 */
router.patch('/me', authenticate, updateProfile);

/**
 * @route   PATCH /api/v1/users/:id
 * @desc    Update user profile (admin or self only)
 */
router.patch('/:id', authenticate, updateProfile);

/**
 * @route   POST /api/v1/users/me/password
 * @desc    Change own password
 */
router.post('/me/password', authenticate, changePassword);

/**
 * @route   POST /api/v1/users/me/avatar
 * @desc    Upload/replace own avatar
 */
router.post('/me/avatar', authenticate, avatarUpload.single('avatar'), uploadAvatar);

/**
 * @route   GET /api/v1/users
 * @desc    List all users (admin only)
 */
router.get('/', authenticate, requireRole('admin'), listUsers);

module.exports = router;