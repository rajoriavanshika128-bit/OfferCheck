'use strict';

/**
 * src/middleware/validate.js
 * Zod schema validation wrapper.
 * Usage: router.post('/path', validate(MyZodSchema), handler)
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

module.exports = validate;

