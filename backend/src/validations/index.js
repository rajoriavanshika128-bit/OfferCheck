'use strict';

/**
 * backend/src/validations/index.js
 * Centralized exports for all OfferCheck Zod validation schemas.
 */

const authValidations = require('./auth.validation');
const identifierValidations = require('./identifier.validation');
const reportValidations = require('./report.validation');
const checkValidations = require('./check.validation');
const adminValidations = require('./admin.validation');

module.exports = {
  ...authValidations,
  ...identifierValidations,
  ...reportValidations,
  ...checkValidations,
  ...adminValidations,
};
