'use strict';

require('dotenv').config();

/**
 * Config is the single source of truth for all environment-driven settings.
 * Every module reads from here — never from process.env directly.
 * This makes config testable, auditable, and explainable at startup.
 */

const _required = (key) => {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`[CONFIG] Required environment variable "${key}" is not set.`);
  }
  return value;
};

const _optional = (key, defaultValue) => {
  return process.env[key] !== undefined ? process.env[key] : defaultValue;
};

const _int = (key, defaultValue) => {
  const val = process.env[key];
  const parsed = parseInt(val, 10);
  if (val !== undefined && isNaN(parsed)) {
    throw new Error(`[CONFIG] Environment variable "${key}" must be an integer, got: ${val}`);
  }
  return isNaN(parsed) ? defaultValue : parsed;
};

const _bool = (key, defaultValue) => {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  throw new Error(`[CONFIG] Environment variable "${key}" must be true/false/1/0, got: ${val}`);
};

const config = {
  env: _optional('NODE_ENV', 'development'),
  isProduction: _optional('NODE_ENV', 'development') === 'production',
  isDevelopment: _optional('NODE_ENV', 'development') === 'development',

  server: {
    port: _int('PORT', 3000),
    apiVersion: _optional('API_VERSION', 'v1'),
  },

  database: {
    host: _optional('DB_HOST', 'localhost'),
    port: _int('DB_PORT', 5432),
    name: _optional('DB_NAME', 'album_platform'),
    user: _optional('DB_USER', 'postgres'),
    password: _optional('DB_PASSWORD', ''),
    pool: {
      max: _int('DB_POOL_MAX', 10),
      min: _int('DB_POOL_MIN', 2),
      acquire: _int('DB_POOL_ACQUIRE', 30000),
      idle: _int('DB_POOL_IDLE', 10000),
    },
  },

  redis: {
    host: _optional('REDIS_HOST', 'localhost'),
    port: _int('REDIS_PORT', 6379),
    password: _optional('REDIS_PASSWORD', '') || undefined,
    db: _int('REDIS_DB', 0),
    keyPrefix: _optional('REDIS_KEY_PREFIX', 'album:'),
  },

  jwt: {
    secret: _optional('JWT_SECRET', 'dev-secret-change-in-production-must-be-64-chars-minimum-here'),
    expiresIn: _optional('JWT_EXPIRES_IN', '15m'),
    refreshSecret: _optional('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production-64-chars'),
    refreshExpiresIn: _optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  passwordReset: {
    tokenExpiresIn: _int('PASSWORD_RESET_TOKEN_EXPIRES_IN', 3600000), // ms
  },

  rateLimit: {
    global: {
      windowMs: _int('RATE_LIMIT_WINDOW_MS', 900000),
      max: _int('RATE_LIMIT_MAX_REQUESTS', 100),
    },
    auth: {
      windowMs: _int('AUTH_RATE_LIMIT_WINDOW_MS', 900000),
      max: _int('AUTH_RATE_LIMIT_MAX_REQUESTS', 10),
    },
  },

  upload: {
    provider: _optional('STORAGE_PROVIDER', 'local'), // 'local' | 's3'
    maxFileSize: _int('UPLOAD_MAX_FILE_SIZE', 10 * 1024 * 1024), // 10MB
    allowedMimeTypes: _optional(
      'UPLOAD_ALLOWED_MIME_TYPES',
      'image/jpeg,image/png,image/gif,image/webp'
    ).split(','),
    local: {
      basePath: _optional('UPLOAD_LOCAL_BASE_PATH', './uploads'),
      baseUrl: _optional('UPLOAD_BASE_URL', 'http://localhost:3000/uploads'),
    },
    s3: {
      accessKeyId: _optional('AWS_ACCESS_KEY_ID', ''),
      secretAccessKey: _optional('AWS_SECRET_ACCESS_KEY', ''),
      region: _optional('AWS_REGION', 'us-east-1'),
      bucket: _optional('AWS_S3_BUCKET', ''),
    },
  },

  logging: {
    level: _optional('LOG_LEVEL', 'debug'),
    dir: _optional('LOG_DIR', './logs'),
    maxSize: _optional('LOG_MAX_SIZE', '20m'),
    maxFiles: _optional('LOG_MAX_FILES', '14d'),
  },

  cors: {
    origin: _optional('CORS_ORIGIN', 'http://localhost:8084').split(','),
  },
};

// Production-level safety checks
if (config.isProduction) {
  const insecureDefaults = [
    { key: 'jwt.secret', value: config.jwt.secret, check: (v) => v.length < 64 },
    { key: 'jwt.refreshSecret', value: config.jwt.refreshSecret, check: (v) => v.length < 64 },
  ];
  insecureDefaults.forEach(({ key, value, check }) => {
    if (check(value)) {
      throw new Error(`[CONFIG] "${key}" does not meet production security requirements.`);
    }
  });
}

module.exports = config;