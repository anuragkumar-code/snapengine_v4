'use strict';

/**
 * Application Constants
 *
 * Single source of truth for all domain enumerations.
 * Never use raw strings in business logic — import from here.
 */

// ── User ───────────────────────────────────────────────────────────────────
const USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  PENDING_VERIFICATION: 'pending_verification',
});

const USER_ROLE = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});

// ── Album ──────────────────────────────────────────────────────────────────
const ALBUM_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
});

// ── Album Member Roles (permission levels within an album) ─────────────────
// Higher number = more permissions (used for comparison in permission engine)
const ALBUM_ROLE = Object.freeze({
  VIEWER: 'viewer',        // Can view photos (if visibility allows)
  CONTRIBUTOR: 'contributor', // Can add photos, comment
  ADMIN: 'admin',          // Can manage members, edit album settings
  OWNER: 'owner',          // Full control, can delete album, transfer ownership
});

// Permission rank map for comparison
const ALBUM_ROLE_RANK = Object.freeze({
  viewer: 1,
  contributor: 2,
  admin: 3,
  owner: 4,
});

/**
 * Check if roleA has at least the same rank as roleB.
 * Usage: hasMinimumRole('admin', 'contributor') → true
 */
const hasMinimumRole = (userRole, requiredRole) => {
  return (ALBUM_ROLE_RANK[userRole] || 0) >= (ALBUM_ROLE_RANK[requiredRole] || 99);
};

// ── Photo ──────────────────────────────────────────────────────────────────
const PHOTO_STATUS = Object.freeze({
  PENDING: 'pending',       // Uploaded, awaiting queue processing
  PROCESSING: 'processing', // Worker currently processing
  READY: 'ready',           // Available to serve
  FAILED: 'failed',         // Processing failed
});

const PHOTO_VISIBILITY = Object.freeze({
  ALBUM_DEFAULT: 'album_default', // Inherits album permission model
  RESTRICTED: 'restricted',       // Only specific users can see
  HIDDEN: 'hidden',               // Hidden from all non-owners
});

// ── Invitation ─────────────────────────────────────────────────────────────
const INVITATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

// ── Activity Types ─────────────────────────────────────────────────────────
const ACTIVITY_TYPE = Object.freeze({
  // Album
  ALBUM_CREATED: 'album.created',
  ALBUM_UPDATED: 'album.updated',
  ALBUM_DELETED: 'album.deleted',
  ALBUM_RESTORED: 'album.restored',
  ALBUM_VISIBILITY_CHANGED: 'album.visibility_changed',

  // Album Member
  MEMBER_ADDED: 'member.added',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',

  // Photo
  PHOTO_UPLOADED: 'photo.uploaded',
  PHOTO_PROCESSED: 'photo.processed',
  PHOTO_DELETED: 'photo.deleted',
  PHOTO_RESTORED: 'photo.restored',
  PHOTO_VISIBILITY_CHANGED: 'photo.visibility_changed',

  // Comment
  COMMENT_ADDED: 'comment.added',
  COMMENT_DELETED: 'comment.deleted',

  // Auth
  USER_REGISTERED: 'auth.user_registered',
  USER_LOGIN: 'auth.login',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
});

// ── HTTP ───────────────────────────────────────────────────────────────────
const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

// ── Queue ──────────────────────────────────────────────────────────────────
const JOB_NAMES = Object.freeze({
  PHOTO_RESIZE: 'photo:resize',
  PHOTO_THUMBNAIL: 'photo:thumbnail',
  SEND_PASSWORD_RESET_EMAIL: 'email:password_reset',
  SEND_INVITATION_EMAIL: 'email:invitation',
  LOG_ACTIVITY: 'activity:log',
  PACKAGE_ZIP: 'zip:package',
});

module.exports = {
  USER_STATUS,
  USER_ROLE,
  ALBUM_VISIBILITY,
  ALBUM_ROLE,
  ALBUM_ROLE_RANK,
  hasMinimumRole,
  PHOTO_STATUS,
  PHOTO_VISIBILITY,
  INVITATION_STATUS,
  ACTIVITY_TYPE,
  HTTP_STATUS,
  JOB_NAMES,
};