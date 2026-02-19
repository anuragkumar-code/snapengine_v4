'use strict';

const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const config = require('../../config');
const logger = require('../logger');

/**
 * Database Infrastructure
 *
 * Responsibilities:
 *  - Create and export the Sequelize instance (sequelize).
 *  - Auto-load all model files from bounded context directories.
 *  - Run model.associate() for every model that declares associations.
 *  - Export { sequelize, Sequelize, models } as a single registry.
 *
 * Models are discovered from:
 *  - modules/*//*.model.js
 *
 * Each model file is fully self-contained:
 *  - Defines the model class
 *  - Calls sequelize.define() or extends Model
 *  - Exports a static associate(models) method for FK wiring
 */

const sequelize = new Sequelize(
  config.database.name,
  config.database.user,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'postgres',
    benchmark: true,
    logging: (sql, executionTime) => {
      if (config.isDevelopment) {
        logger.debug('SQL Query', {
          sql,
          executionTimeMs: executionTime,
        });
      }
    },
    pool: {
      max: config.database.pool.max,
      min: config.database.pool.min,
      acquire: config.database.pool.acquire,
      idle: config.database.pool.idle,
    },
    define: {
      // Global soft-delete: all models get deletedAt by default
      paranoid: true,
      // Auto snake_case column names from camelCase fields
      underscored: true,
      // Auto-manage createdAt / updatedAt
      timestamps: true,
      // Sequelize will not pluralize table names
      freezeTableName: true,
    },
    dialectOptions: {
      // Required for SSL in production environments (e.g. RDS, Supabase)
      ...(config.isProduction && {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }),
      // Statement timeout: prevent runaway queries
      statement_timeout: 10000,
    },
  }
);

// ── Model Registry ────────────────────────────────────────────────────────
const db = {};

/**
 * Recursively discovers all *.model.js files inside the modules directory.
 * This means adding a new module automatically registers its models.
 */
function loadModels() {
  const modulesDir = path.join(__dirname, '../../modules');

  if (!fs.existsSync(modulesDir)) {
    logger.warn('[DB] modules directory not found, no models loaded');
    return;
  }

  const findModelFiles = (dir) => {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findModelFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.model.js')) {
        results.push(fullPath);
      }
    }
    return results;
  };

  const modelFiles = findModelFiles(modulesDir);

  modelFiles.forEach((filePath) => {
    try {
      const modelDefiner = require(filePath);
      // Each model file exports a function: (sequelize) => ModelClass
      const model = modelDefiner(sequelize);
      db[model.name] = model;
      // logger.debug(`[DB] Model loaded: ${model.name}`);
    } catch (err) {
      logger.error(`[DB] Failed to load model from ${filePath}`, { error: err.message });
      throw err;
    }
  });

  // Run associations after all models are loaded (FK references need all models present)
  Object.values(db).forEach((model) => {
    if (typeof model.associate === 'function') {
      model.associate(db);
      logger.debug(`[DB] Associations wired: ${model.name}`);
    }
  });
}

loadModels();

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// ── Connection Test ────────────────────────────────────────────────────────
/**
 * Called at startup. Crashes with a clear error if DB is unreachable.
 */
db.testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('[DB] PostgreSQL connection established successfully', {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
    });
  } catch (error) {
    logger.error('[DB] Unable to connect to PostgreSQL', {
      error: error.message,
      host: config.database.host,
      port: config.database.port,
    });
    throw error;
  }
};

/**
 * Graceful shutdown: drain connection pool.
 */
db.close = async () => {
  await sequelize.close();
  logger.info('[DB] PostgreSQL connection pool closed');
};

module.exports = db;