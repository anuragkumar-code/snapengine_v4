'use strict';

/**
 * Upload Infrastructure — Storage Abstraction Layer
 *
 * Architecture:
 *  StorageProvider (abstract interface)
 *    └── LocalStorageStrategy  (current implementation)
 *    └── S3StorageStrategy     (future — drop-in replacement)
 *
 * The rest of the system interacts only with the StorageProvider interface.
 * Switching from local to S3 requires zero changes outside this file.
 *
 * Provider is selected at startup via config.upload.provider.
 */

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../../config');
const logger = require('../logger');

// ── StorageProvider Interface ──────────────────────────────────────────────
/**
 * All storage strategies must implement this interface.
 * Concrete implementations throw on unimplemented methods.
 */
class StorageProvider {
  /**
   * Save a file buffer or stream to storage.
   * @param {Buffer} buffer - File data
   * @param {string} filename - Desired storage filename (already sanitized)
   * @param {string} mimeType - File MIME type
   * @param {string} folder - Storage subfolder (e.g. 'photos', 'avatars')
   * @returns {Promise<{url: string, key: string, size: number}>}
   */
  async save(buffer, filename, mimeType, folder) {
    throw new Error('StorageProvider.save() must be implemented by subclass');
  }

  /**
   * Delete a file from storage by its storage key.
   * @param {string} key - Storage key returned from save()
   * @returns {Promise<void>}
   */
  async delete(key) {
    throw new Error('StorageProvider.delete() must be implemented by subclass');
  }

  /**
   * Generate a pre-signed or direct URL for a given storage key.
   * @param {string} key
   * @param {number} expiresInSeconds - For signed URLs (S3). Local ignores this.
   * @returns {Promise<string>} Accessible URL
   */
  async getUrl(key, expiresInSeconds = 3600) {
    throw new Error('StorageProvider.getUrl() must be implemented by subclass');
  }

  /**
   * Check if a file exists.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    throw new Error('StorageProvider.exists() must be implemented by subclass');
  }
}

// ── Local Storage Strategy ─────────────────────────────────────────────────
class LocalStorageStrategy extends StorageProvider {
  constructor() {
    super();
    this.basePath = path.resolve(config.upload.local.basePath);
    this.baseUrl = config.upload.local.baseUrl;
    this._ensureBaseDir();
  }

  _ensureBaseDir() {
    fs.ensureDirSync(this.basePath);
    logger.info('[Upload] Local storage initialized', { basePath: this.basePath });
  }

  /**
   * Generate a unique, safe filename.
   * Format: <timestamp>-<randomhex>.<ext>
   */
  _generateStorageKey(folder, originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const randomPart = crypto.randomBytes(12).toString('hex');
    const timestamp = Date.now();
    return path.join(folder, `${timestamp}-${randomPart}${ext}`);
  }

  async save(buffer, filename, mimeType, folder = 'uploads') {
    const key = this._generateStorageKey(folder, filename);
    const fullPath = path.join(this.basePath, key);

    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, buffer);

    const url = `${this.baseUrl}/${key.replace(/\\/g, '/')}`;

    logger.debug('[Upload] File saved locally', { key, size: buffer.length });

    return {
      url,
      key,
      size: buffer.length,
      mimeType,
    };
  }

  async delete(key) {
    const fullPath = path.join(this.basePath, key);
    try {
      await fs.remove(fullPath);
      logger.debug('[Upload] File deleted locally', { key });
    } catch (err) {
      // File already gone — treat as success (idempotent)
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async getUrl(key) {
    // Local files are served as static assets — URL is fixed, no signing needed
    return `${this.baseUrl}/${key.replace(/\\/g, '/')}`;
  }

  async exists(key) {
    const fullPath = path.join(this.basePath, key);
    return fs.pathExists(fullPath);
  }
}

// ── S3 Storage Strategy (Scaffold — future implementation) ─────────────────
class S3StorageStrategy extends StorageProvider {
  constructor() {
    super();
    // AWS SDK v3 will be initialized here when needed
    // const { S3Client } = require('@aws-sdk/client-s3');
    // this.client = new S3Client({ region: config.upload.s3.region, ... });
    // this.bucket = config.upload.s3.bucket;
    logger.info('[Upload] S3 storage strategy selected (scaffold)');
  }

  async save(buffer, filename, mimeType, folder = 'uploads') {
    // const { PutObjectCommand } = require('@aws-sdk/client-s3');
    // const key = `${folder}/${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
    // await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
    // return { url: `https://${this.bucket}.s3.amazonaws.com/${key}`, key, size: buffer.length, mimeType };
    throw new Error('S3StorageStrategy.save() not yet implemented. Set STORAGE_PROVIDER=local.');
  }

  async delete(key) {
    throw new Error('S3StorageStrategy.delete() not yet implemented.');
  }

  async getUrl(key, expiresInSeconds = 3600) {
    // const { GetObjectCommand } = require('@aws-sdk/client-s3');
    // const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    // return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
    throw new Error('S3StorageStrategy.getUrl() not yet implemented.');
  }

  async exists(key) {
    throw new Error('S3StorageStrategy.exists() not yet implemented.');
  }
}

// ── Provider Factory ───────────────────────────────────────────────────────
const createStorageProvider = () => {
  const provider = config.upload.provider;
  switch (provider) {
    case 'local':
      return new LocalStorageStrategy();
    case 's3':
      return new S3StorageStrategy();
    default:
      throw new Error(`[Upload] Unknown storage provider: "${provider}". Use 'local' or 's3'.`);
  }
};

// ── Multer Middleware Factory ───────────────────────────────────────────────
/**
 * Returns a configured Multer instance for handling multipart/form-data uploads.
 * Files are stored in memory (Buffer) and handed off to the storage provider.
 * This keeps the HTTP layer decoupled from storage mechanics.
 *
 * Usage in route:
 *   router.post('/photos', uploadMiddleware.single('photo'), photoController.upload);
 */
const createUploadMiddleware = (options = {}) => {
  const {
    fieldName = 'file',
    maxSize = config.upload.maxFileSize,
    allowedTypes = config.upload.allowedMimeTypes,
  } = options;

  const storage = multer.memoryStorage();

  const fileFilter = (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        Object.assign(new Error(`File type "${file.mimetype}" is not allowed.`), {
          code: 'INVALID_FILE_TYPE',
          status: 422,
        }),
        false
      );
    }
    cb(null, true);
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: maxSize },
  });
};

// ── Singleton Export ───────────────────────────────────────────────────────
const storageProvider = createStorageProvider();

module.exports = {
  storageProvider,
  StorageProvider,
  LocalStorageStrategy,
  S3StorageStrategy,
  createUploadMiddleware,
};