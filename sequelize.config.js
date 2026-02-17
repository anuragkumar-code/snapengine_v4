'use strict';

const path = require('path');

module.exports = {
  'config': path.resolve('.sequelizerc'),
  'models-path': path.resolve('modules'),
  'seeders-path': path.resolve('infrastructure/database/seeders'),
  'migrations-path': path.resolve('infrastructure/database/migrations'),
};