'use strict';

/**
 * The contract every provider adapter implements. Routes and services depend on
 * this shape alone and never on a vendor SDK.
 *
 * @typedef {Object} ModelInfo
 * @property {string} id
 * @property {string} label
 * @property {number} contextWindow
 *
 * @typedef {Object} CompletionRequest
 * @property {string} system
 * @property {{role: 'user'|'assistant', content: string}[]} messages
 * @property {string} model
 * @property {number} temperature
 * @property {number} maxOutputTokens
 * @property {AbortSignal} [signal]
 *
 * @typedef {{type:'delta', text:string}
 *   | {type:'done', usage:{inputTokens:number, outputTokens:number}, finishReason:string}
 *   | {type:'error', error:{code:string, message:string, retryable:boolean}}} StreamEvent
 *
 * @typedef {Object} ProviderAdapter
 * @property {string} id
 * @property {string} label
 * @property {string} apiKeyEnvVar
 * @property {() => boolean} isConfigured
 * @property {() => ModelInfo[]} listModels
 * @property {(req: CompletionRequest) => AsyncIterable<StreamEvent>} streamCompletion
 */

module.exports = {};
