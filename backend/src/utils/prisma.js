'use strict';

/**
 * src/utils/prisma.js
 * PrismaClient singleton — prevents multiple instances during hot reload.
 */

const path = require('path');
const fs = require('fs');

// Ensure DATABASE_URL is available even if imported outside server.js
if (!process.env.DATABASE_URL) {
  const rootEnv = path.resolve(__dirname, '../../../.env');
  const backendEnv = path.resolve(__dirname, '../../.env');
  const envPath = fs.existsSync(rootEnv) ? rootEnv : backendEnv;
  require('dotenv').config({ path: envPath });
}

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;

