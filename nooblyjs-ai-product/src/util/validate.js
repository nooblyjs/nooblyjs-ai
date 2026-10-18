// Checks a request body field by field, collecting every problem so the screen can show each one next to its
// field: 422 { error: { code: 'invalid', details: { field: message } } }.
import { unprocessable } from './errors.js';

/** What a list item check returns for a bad item (a plain string is a valid text item, not an error). */
class Invalid {
  constructor(message) {
    this.message = message;
  }
}
export const invalid = (message) => new Invalid(message);

export function validator(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = {};
  const out = {};
  const has = (field) => input[field] !== undefined;

  const v = {
    input,
    has,
    errors,
    /** A string, trimmed. `required` refuses empty. */
    string(field, { required = false, max = 200 } = {}) {
      if (!has(field)) {
        if (required) errors[field] = `${field} is required`;
        return v;
      }
      const value = input[field];
      if (typeof value !== 'string') errors[field] = `${field} must be text`;
      else if (required && !value.trim()) errors[field] = `${field} can't be empty`;
      else if (value.length > max) errors[field] = `${field} must be at most ${max} characters`;
      else out[field] = value.trim();
      return v;
    },
    /** One of a fixed set of values. */
    oneOf(field, values, { required = false } = {}) {
      if (!has(field)) {
        if (required) errors[field] = `${field} is required`;
      } else if (!values.includes(input[field])) {
        errors[field] = `${field} must be one of ${values.join(', ')}`;
      } else {
        out[field] = input[field];
      }
      return v;
    },
    /** An array, each item checked by `item(value, index)`, which returns the clean item or invalid(message). */
    list(field, item, { max = 50 } = {}) {
      if (!has(field)) return v;
      const value = input[field];
      if (!Array.isArray(value)) {
        errors[field] = `${field} must be a list`;
        return v;
      }
      if (value.length > max) {
        errors[field] = `${field} can have at most ${max} items`;
        return v;
      }
      const clean = [];
      for (const [i, entry] of value.entries()) {
        const result = item(entry, i);
        if (result instanceof Invalid) {
          errors[`${field}[${i}]`] = result.message;
        } else {
          clean.push(result);
        }
      }
      out[field] = clean;
      return v;
    },
    /** A field checked by a function returning { value } or { errors: { sub: message } }. */
    custom(field, check) {
      if (!has(field)) return v;
      const result = check(input[field]);
      if (result.errors) for (const [k, m] of Object.entries(result.errors)) errors[`${field}.${k}`] = m;
      else out[field] = result.value;
      return v;
    },
    /** Refuses fields that aren't in `allowed` (e.g. status or version, which are not set this way). */
    only(allowed) {
      for (const field of Object.keys(input)) if (!allowed.includes(field)) errors[field] = `${field} can't be set here`;
      return v;
    },
    /** The clean values, or throws 422 with every problem. */
    result(message = 'Some fields need fixing.') {
      if (Object.keys(errors).length) throw unprocessable(message, errors);
      return out;
    },
  };
  return v;
}

/** A list item check: a non-empty string of at most `max` characters. */
export const text = (field, max = 500) => (value) =>
  (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : invalid(`${field} must be text of 1–${max} characters`));
