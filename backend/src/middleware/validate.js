'use strict';

/**
 * src/middleware/validate.js
 * Zod schema validation wrappers for Express.
 *
 * Usage:
 * - Body validation: router.post('/path', validate(BodySchema), handler)
 * - Query validation: router.get('/path', validateQuery(QuerySchema), handler)
 */

function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Pass ZodError to centralised errorHandler
      return next(result.error);
    }
    req.body = result.data; // replace with parsed + stripped data
    next();
  };
}

function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      // Pass ZodError to centralised errorHandler
      return next(result.error);
    }
    req.query = result.data; // replace with parsed + coerced/stripped data
    next();
  };
}

validate.validate = validate;
validate.validateQuery = validateQuery;
validate.query = validateQuery;

module.exports = validate;
module.exports.validate = validate;
module.exports.validateQuery = validateQuery;
module.exports.query = validateQuery;

