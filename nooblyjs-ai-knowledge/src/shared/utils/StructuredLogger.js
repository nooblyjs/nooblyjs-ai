/**
 * @fileoverview Structured Logger Wrapper
 * Provides JSON-formatted logging for better observability in production environments.
 * Implements the same interface as the core logging service.
 */

'use strict';

const os = require('os');

class StructuredLogger {
  /**
   * @param {Object} coreLogger - The original core logger instance
   * @param {Object} options - Configuration options
   */
  constructor(coreLogger, options = {}) {
    this.coreLogger = coreLogger;
    this.instanceName = options.instanceName || 'default';
    this.serviceName = options.serviceName || 'unified-backend';
    this.isProduction = process.env.NODE_ENV === 'production';
    this.hostname = os.hostname();
  }

  /**
   * Formats and outputs the log entry
   * @private
   */
  _log(level, message, meta = {}) {
    if (typeof this.coreLogger.shouldLog === 'function' && !this.coreLogger.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      service: this.serviceName,
      instance: this.instanceName,
      hostname: this.hostname,
      message: message
    };

    // Handle metadata, including Error objects
    if (meta instanceof Error) {
      logEntry.error = {
        message: meta.message,
        stack: meta.stack,
        code: meta.code
      };
    } else if (typeof meta === 'object' && meta !== null) {
      // If meta contains an Error object (common pattern: { error: err })
      if (meta.error instanceof Error) {
        const { error, ...rest } = meta;
        Object.assign(logEntry, rest);
        logEntry.error = {
          message: error.message,
          stack: error.stack,
          code: error.code
        };
      } else {
        Object.assign(logEntry, meta);
      }
    } else if (meta !== undefined && meta !== null) {
      logEntry.meta = meta;
    }

    if (this.isProduction) {
      // In production, always output structured JSON to stdout for log aggregators
      process.stdout.write(JSON.stringify(logEntry) + '\n');
    } else {
      // In development, we can still use the core logger for pretty-ish output
      // or fallback to JSON if preferred. Let's keep it JSON for consistency if requested.
      // But usually developers prefer readable logs.
      // For now, let's use JSON if LOG_FORMAT=json is set
      if (process.env.LOG_FORMAT === 'json') {
        console.log(JSON.stringify(logEntry));
      } else {
        // Fallback to core logger's default formatting for human readability
        const method = level === 'debug' ? 'log' : level;
        if (typeof this.coreLogger[method] === 'function') {
          this.coreLogger[method](message, meta);
        } else {
          console.log(`[${level.toUpperCase()}] ${message}`, meta);
        }
      }
    }

    // Also emit event if core logger has an event emitter
    if (this.coreLogger.eventEmitter_) {
      const eventName = `log:${level}:${this.instanceName}`;
      this.coreLogger.eventEmitter_.emit(eventName, { 
        message: message, 
        entry: logEntry 
      });
    }
  }

  async info(message, meta) {
    this._log('info', message, meta);
  }

  async warn(message, meta) {
    this._log('warn', message, meta);
  }

  async error(message, meta) {
    this._log('error', message, meta);
  }

  async debug(message, meta) {
    this._log('log', message, meta);
  }

  async log(message, meta) {
    this._log('log', message, meta);
  }

  // Support for core logger settings methods
  async getSettings() {
    return this.coreLogger.getSettings ? await this.coreLogger.getSettings() : {};
  }

  async saveSettings(settings) {
    if (this.coreLogger.saveSettings) {
      await this.coreLogger.saveSettings(settings);
    }
  }
}

module.exports = StructuredLogger;
