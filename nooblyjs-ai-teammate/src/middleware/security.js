// Security headers for everything Teammates serves. The Content-Security-Policy is the host's: the frame and every
// app's module share one page, so they share one policy (noobly app.js).

export function securityHeaders(req, res, next) {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
}
