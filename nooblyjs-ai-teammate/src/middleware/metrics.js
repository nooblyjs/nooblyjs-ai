// API timings go to the measuring service, and to the log file at debug level. Query strings are never logged.

export function requestMetrics({ metrics, log, base }) {
  return (req, res, next) => {
    const path = req.path;
    if (path === '/events') return next();
    const started = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - started;
      metrics.record('http.request_ms', ms);
      if (res.statusCode >= 500) metrics.record('http.server_error');
      log.debug(`[http] ${req.method} ${base}${path} ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}
