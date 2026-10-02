'use strict';

// A runaway client loop on the message endpoint spends real money, so cap it.
// In-process and single-user; nothing more elaborate is warranted.
function tokenBucket({ capacity = 10, refillPerSecond = 0.5 } = {}) {
  let tokens = capacity;
  let last = Date.now();

  return function limiter(req, res, next) {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSecond);
    last = now;

    if (tokens < 1) {
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests in a short period. Wait a moment.' }
      });
    }
    tokens -= 1;
    return next();
  };
}

module.exports = { tokenBucket };
