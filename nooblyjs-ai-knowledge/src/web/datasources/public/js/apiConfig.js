/**
 * API Configuration Helper
 * Provides centralized API base URL management and fetch helper functions
 *
 * Usage:
 *   apiCall('/api/workflows/dashboard')
 *   → fetches from: {API_BASE_URL}/api/workflows/dashboard
 *
 *   // For localhost:9101, this becomes:
 *   → http://localhost:9101/api/workflows/dashboard
 */

(function() {
  // Debug mode — enable with a ?debug query parameter.
  window.API_DEBUG = window.API_DEBUG || window.location.search.includes('debug');

  // Derive the API base URL from the current origin at runtime.
  window.API_BASE_URL = window.API_BASE_URL || (function() {
    // If running on localhost development, target the unified backend on 9101.
    // Preserve the page's protocol — hardcoding http:// here breaks an HTTPS page
    // by issuing blocked mixed-content / cross-origin calls, which drops the
    // session cookie and produces an auth redirect loop.
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      // When already served from the backend (same port), just use the origin so
      // any port/protocol is honoured; otherwise (e.g. Vite dev server) point at 9101.
      if (window.location.port === '9101') {
        return window.location.origin;
      }
      return `${window.location.protocol}//${window.location.hostname}:9101`;
    }
    // For production, use the current origin
    return window.location.origin;
  })();

  /**
   * Resolves an API path to a full URL using the API base URL
   *
   * @param {string} path - The API path (e.g., '/api/workflows/dashboard')
   * @returns {string} The full URL (e.g., {baseurl}/api/workflows/dashboard)
   */
  window.resolveApiPath = function(path) {
    if (!path) return path;

    // If it's already a full URL, return as-is
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // Combine base URL with path
    const base = window.API_BASE_URL.endsWith('/')
      ? window.API_BASE_URL.slice(0, -1)
      : window.API_BASE_URL;

    let cleanPath = path.startsWith('/') ? path : '/' + path;

    return base + cleanPath;
  };

  /**
   * Helper function for making API calls with proper error handling
   * Replaces standard fetch for API endpoints
   * Uses the configured API_BASE_URL to ensure calls go to the correct server
   *
   * @param {string} path - API endpoint path (e.g., '/api/workflows/dashboard')
   * @param {Object} options - Fetch options (method, headers, body, etc.)
   * @returns {Promise<Response>} Fetch response promise
   *
   * Example:
   *   // Input: '/api/workflows/dashboard'
   *   // Actual URL: http://localhost:9101/api/workflows/dashboard
   *   apiCall('/api/workflows/dashboard')
   *     .then(res => res.json())
   *     .then(data => console.log(data))
   */
  window.apiCall = function(path, options = {}) {
    const fullUrl = window.resolveApiPath(path);

    // Log in debug mode
    if (window.API_DEBUG) {
      console.debug(`[API Call] ${options.method || 'GET'} ${fullUrl}`, options);
    }

    return fetch(fullUrl, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    }).catch(error => {
      console.error(`[API Error] Failed to call ${fullUrl}:`, error);
      throw error;
    });
  };

  /**
   * Helper for common API patterns
   */
  window.apiClient = {
    /**
     * GET request
     */
    get: (path, options = {}) => {
      return window.apiCall(path, { ...options, method: 'GET' });
    },

    /**
     * POST request
     */
    post: (path, body = null, options = {}) => {
      const fetchOptions = { ...options, method: 'POST' };
      if (body) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      return window.apiCall(path, fetchOptions);
    },

    /**
     * PUT request
     */
    put: (path, body = null, options = {}) => {
      const fetchOptions = { ...options, method: 'PUT' };
      if (body) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      return window.apiCall(path, fetchOptions);
    },

    /**
     * DELETE request
     */
    delete: (path, options = {}) => {
      return window.apiCall(path, { ...options, method: 'DELETE' });
    }
  };

  // Log configuration on load (helps with debugging)
  if (window.location.search.includes('debug') || window.API_DEBUG) {
    console.info('[API Config] Initialized with base URL:', window.API_BASE_URL);
  }
})();
