/**
 * @fileoverview Validation Middleware
 * Express middleware for request body and query parameter validation using Joi
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

/**
 * Validate request body against a Joi schema
 * @param {Object} schema - Joi schema for validation
 * @returns {Function} Express middleware function
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Return all errors
      stripUnknown: true // Remove unknown fields
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
        timestamp: new Date().toISOString()
      });
    }

    req.body = value; // Use validated/sanitized data
    next();
  };
}

/**
 * Validate query parameters against a Joi schema
 * @param {Object} schema - Joi schema for validation
 * @returns {Function} Express middleware function
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors,
        timestamp: new Date().toISOString()
      });
    }

    req.query = value;
    next();
  };
}

module.exports = { validate, validateQuery };
