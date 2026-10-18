/**
 * @fileoverview Workflow Validation Schemas
 * Joi validation schemas for all workflow API inputs
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const Joi = require('joi');

/**
 * Step configuration schema for workflow steps
 */
const stepConfigSchema = Joi.object({
  type: Joi.string()
    .valid('transform', 'api', 'conditional', 'parallel', 'delay', 'identity')
    .required(),

  // Transform step fields
  script: Joi.when('type', {
    is: 'transform',
    then: Joi.string().max(10000).required(),
    otherwise: Joi.string().max(10000).optional()
  }),

  // Conditional step fields
  condition: Joi.when('type', {
    is: 'conditional',
    then: Joi.string().max(5000).required(),
    otherwise: Joi.string().max(5000).optional()
  }),

  // API step fields
  endpoint: Joi.when('type', {
    is: 'api',
    then: Joi.string().uri().max(2048).required(),
    otherwise: Joi.string().uri().max(2048).optional()
  }),
  method: Joi.when('type', {
    is: 'api',
    then: Joi.string()
      .valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH')
      .default('GET'),
    otherwise: Joi.string()
      .valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH')
      .optional()
  }),
  headers: Joi.when('type', {
    is: 'api',
    then: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
    otherwise: Joi.object().pattern(Joi.string(), Joi.string()).optional()
  }),
  body: Joi.when('type', {
    is: 'api',
    then: Joi.any().optional(),
    otherwise: Joi.any().optional()
  }),

  // Parallel step fields
  branches: Joi.when('type', {
    is: 'parallel',
    then: Joi.array().items(Joi.object()).required(),
    otherwise: Joi.array().items(Joi.object()).optional()
  }),

  // Delay step fields
  duration: Joi.when('type', {
    is: 'delay',
    then: Joi.number().integer().min(0).max(300000).required(),
    otherwise: Joi.number().integer().min(0).max(300000).optional()
  }),

  // Common step fields
  timeout: Joi.number().integer().min(1).max(300).default(30),
  retries: Joi.number().integer().min(0).max(5).default(1),
  continueOnError: Joi.boolean().default(false)
}).unknown(true);

/**
 * Individual step schema (used in array)
 */
const stepSchema = Joi.object({
  id: Joi.string().max(100).optional(),
  name: Joi.string().min(1).max(200).required(),
  config: stepConfigSchema.required()
});

/**
 * Schema for creating a new workflow
 */
const createWorkflowSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).allow('').default(''),
  tags: Joi.array()
    .items(Joi.string().max(50))
    .max(20)
    .default([]),
  steps: Joi.array()
    .items(stepSchema)
    .min(1)
    .max(100)
    .required(),
  status: Joi.string()
    .valid('draft', 'active', 'archived')
    .default('draft')
});

/**
 * Schema for updating an existing workflow
 */
const updateWorkflowSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  description: Joi.string().max(500).allow(''),
  tags: Joi.array()
    .items(Joi.string().max(50))
    .max(20),
  steps: Joi.array()
    .items(stepSchema)
    .min(1)
    .max(100),
  status: Joi.string()
    .valid('draft', 'active', 'archived')
}).min(1); // At least one field must be present

/**
 * Schema for executing a workflow
 */
const executeWorkflowSchema = Joi.object({
  input: Joi.object().max(100).default({}),
  variables: Joi.object()
    .pattern(Joi.string(), Joi.any())
    .default({})
});

/**
 * Schema for creating a schedule
 */
const createScheduleSchema = Joi.object({
  workflowId: Joi.string().required(),
  cronExpression: Joi.string()
    .pattern(/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/)
    .required(),
  enabled: Joi.boolean().default(true)
});

/**
 * Schema for pagination query parameters
 */
const paginationSchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(10000)
    .default(10),
  offset: Joi.number()
    .integer()
    .min(0)
    .default(0),
  starred: Joi.string()
    .valid('true', 'false')
    .optional(),
  tags: Joi.string()
    .optional(),
  status: Joi.string()
    .optional(),
  __nocache: Joi.string()
    .valid('true')
    .optional()
});

module.exports = {
  createWorkflowSchema,
  updateWorkflowSchema,
  executeWorkflowSchema,
  createScheduleSchema,
  paginationSchema,
  stepConfigSchema,
  stepSchema
};
