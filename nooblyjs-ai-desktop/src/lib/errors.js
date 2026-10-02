'use strict';

class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { status: 400, code: 'VALIDATION_FAILED', details });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found', details) {
    super(message, { status: 404, code: 'NOT_FOUND', details });
  }
}

class ProviderUnavailableError extends AppError {
  constructor(message, details) {
    super(message, { status: 409, code: 'PROVIDER_NOT_CONFIGURED', details });
  }
}

class StorageError extends AppError {
  constructor(message, cause) {
    super(message, { status: 500, code: 'STORAGE_FAILED', cause });
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ProviderUnavailableError,
  StorageError
};
