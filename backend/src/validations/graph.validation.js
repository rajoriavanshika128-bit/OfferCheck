'use strict';

/**
 * backend/src/validations/graph.validation.js
 * Zod validation schema for Trust Graph and public stats endpoints.
 * Validates optional start node, depth bounds (1-3), flaggedOnly boolean filter, and max limit.
 */

const { z } = require('zod');

const graphQuerySchema = z.object({
  start: z.string().trim().min(1).max(100).optional(),
  depth: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return 2;
      const num = Number(val);
      return Number.isNaN(num) ? val : num;
    }, z.number({ invalid_type_error: 'depth must be a number' })
      .int('depth must be an integer')
      .min(1, 'depth must be at least 1')
      .max(3, 'depth cannot exceed 3')
    )
    .default(2),
  flaggedOnly: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return false;
      if (val === true || val === 'true' || val === 1 || val === '1') return true;
      if (val === false || val === 'false' || val === 0 || val === '0') return false;
      return val; // Returns original value so Zod rejects invalid types/strings with 400
    }, z.boolean({ invalid_type_error: 'flaggedOnly must be a boolean' }))
    .default(false),
  limit: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return 100;
      const num = Number(val);
      return Number.isNaN(num) ? val : num;
    }, z.number({ invalid_type_error: 'limit must be a number' })
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(100, 'limit cannot exceed 100')
    )
    .default(100),
});

module.exports = {
  graphQuerySchema,
};
