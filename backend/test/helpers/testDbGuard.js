'use strict';

/**
 * backend/test/helpers/testDbGuard.js
 * Strict safety guard for test database connections.
 * Ensures tests NEVER connect to offercheck_dev, production, remote hosts, or silently fall back to .env.
 */

const APPROVED_PROTOCOLS = ['postgresql:', 'postgres:'];
const APPROVED_HOSTS = ['localhost', '127.0.0.1', '::1'];
const REQUIRED_DB_NAME = 'offercheck_test';

/**
 * Validate a database URL for testing safety.
 *
 * @param {string} urlString - Database connection string to validate
 * @returns {{ valid: boolean, dbName: string, host: string, protocol: string, url: string }}
 * @throws {Error} if any safety condition is violated
 */
function validateTestDatabaseUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error(
      '[FATAL TEST GUARD] No test database URL supplied. ' +
      'Integration tests require an explicit TEST_DATABASE_URL. ' +
      'Refusing to connect or fall back to .env / default database.'
    );
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(
      '[FATAL TEST GUARD] Malformed database URL provided for testing. ' +
      'Refusing to connect.'
    );
  }

  // 1. Protocol check — PostgreSQL only (postgresql: or postgres:)
  const protocol = parsed.protocol.toLowerCase();
  if (!APPROVED_PROTOCOLS.includes(protocol)) {
    throw new Error(
      `[FATAL TEST GUARD] Unapproved database protocol: '${protocol}'. ` +
      `Test database connection must use an approved PostgreSQL protocol (${APPROVED_PROTOCOLS.join(', ')}). ` +
      'Refusing to connect.'
    );
  }

  // 2. Host check — local only (normalizes IPv6 [::1] to ::1)
  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[|\]$/g, '');
  if (!APPROVED_HOSTS.includes(hostname)) {
    throw new Error(
      `[FATAL TEST GUARD] Unapproved host: '${rawHostname}'. ` +
      `Test database MUST run on approved local host (${APPROVED_HOSTS.join(', ')}). ` +
      'Refusing to connect to remote or unapproved host.'
    );
  }

  // 3. Database name check — exactly offercheck_test
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `[FATAL TEST GUARD] Unsafe database target: '${dbName}'. ` +
      `Test runner is strictly restricted to '${REQUIRED_DB_NAME}'. ` +
      `Refusing connection to '${dbName}' (prevents corruption of development/production databases).`
    );
  }

  // 4. Explicit check against offercheck_dev or production keywords
  if (dbName.includes('dev') || dbName.includes('prod') || dbName.includes('stage')) {
    throw new Error(
      `[FATAL TEST GUARD] Database name '${dbName}' matches forbidden environment pattern. ` +
      'Refusing to connect.'
    );
  }

  return {
    valid: true,
    dbName,
    host: hostname,
    protocol,
    url: urlString,
  };
}

module.exports = {
  validateTestDatabaseUrl,
  APPROVED_PROTOCOLS,
  APPROVED_HOSTS,
  REQUIRED_DB_NAME,
};
