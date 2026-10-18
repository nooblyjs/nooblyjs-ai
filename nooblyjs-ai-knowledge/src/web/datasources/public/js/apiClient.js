/**
 * API Client Wrapper (Task 7.1.1)
 *
 * Centralized HTTP client for all API requests with:
 * - Base fetch wrapper with auth headers
 * - Error handling and response normalization
 * - Request/response interceptors
 * - Loading state management
 * - Automatic retry for failed requests
 */

class APIClient {
  constructor(options = {}) {
    this.baseURL = options.baseURL || '/api';
    this.timeout = options.timeout || 30000;
    this.defaultHeaders = options.defaultHeaders || {
      'Content-Type': 'application/json'
    };
    this.interceptors = {
      request: [],
      response: [],
      error: []
    };
    this.requestQueue = [];
    this.isOnline = navigator.onLine;

    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  /**
   * Add request interceptor
   */
  addRequestInterceptor(callback) {
    this.interceptors.request.push(callback);
  }

  /**
   * Add response interceptor
   */
  addResponseInterceptor(callback) {
    this.interceptors.response.push(callback);
  }

  /**
   * Add error interceptor
   */
  addErrorInterceptor(callback) {
    this.interceptors.error.push(callback);
  }

  /**
   * Execute request interceptors
   */
  async executeRequestInterceptors(config) {
    for (const interceptor of this.interceptors.request) {
      config = await interceptor(config);
    }
    return config;
  }

  /**
   * Execute response interceptors
   */
  async executeResponseInterceptors(response) {
    for (const interceptor of this.interceptors.response) {
      response = await interceptor(response);
    }
    return response;
  }

  /**
   * Execute error interceptors
   */
  async executeErrorInterceptors(error) {
    for (const interceptor of this.interceptors.error) {
      error = await interceptor(error);
    }
    return error;
  }

  /**
   * Main fetch wrapper with retry logic
   */
  async request(endpoint, options = {}) {
    if (!this.isOnline) {
      throw new Error('You are offline. Please check your internet connection.');
    }

    const config = {
      method: options.method || 'GET',
      url: `${this.baseURL}${endpoint}`,
      headers: { ...this.defaultHeaders, ...options.headers },
      body: options.body,
      timeout: options.timeout || this.timeout,
      retries: options.retries !== undefined ? options.retries : 3
    };

    // Execute request interceptors
    const finalConfig = await this.executeRequestInterceptors(config);

    let lastError;
    let response;

    // Retry logic
    for (let attempt = 0; attempt <= finalConfig.retries; attempt++) {
      try {
        response = await this.fetchWithTimeout(finalConfig);

        // Check for HTTP errors
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.status = response.status;
          error.response = response;

          // Don't retry on 4xx client errors (except 408, 429)
          if (response.status >= 400 && response.status < 500 &&
              response.status !== 408 && response.status !== 429) {
            throw error;
          }

          // Retry on 5xx server errors and specific client errors
          if (attempt < finalConfig.retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          throw error;
        }

        // Parse response
        const data = await this.parseResponse(response);

        const result = {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: data
        };

        // Execute response interceptors
        return await this.executeResponseInterceptors(result);

      } catch (error) {
        lastError = error;

        // Handle network errors - retry with backoff
        if (attempt < finalConfig.retries && this.isNetworkError(error)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Execute error interceptors
        try {
          throw await this.executeErrorInterceptors(error);
        } catch (finalError) {
          throw finalError;
        }
      }
    }

    throw lastError;
  }

  /**
   * Fetch with timeout
   */
  fetchWithTimeout(config) {
    return Promise.race([
      fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body: config.body ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body)) : undefined,
        credentials: 'include' // Include cookies for session authentication
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), config.timeout)
      )
    ]);
  }

  /**
   * Parse response based on content type
   */
  async parseResponse(response) {
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      return response.json();
    } else if (contentType && contentType.includes('text/')) {
      return response.text();
    } else {
      return response.blob();
    }
  }

  /**
   * Check if error is network-related
   */
  isNetworkError(error) {
    return error.message === 'Request timeout' ||
           error.message === 'Failed to fetch' ||
           error instanceof TypeError;
  }

  /**
   * Handle online event
   */
  handleOnline() {
    this.isOnline = true;
    console.log('Connection restored');

    // Retry queued requests
    this.processQueuedRequests();
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    this.isOnline = false;
    console.log('Connection lost');
  }

  /**
   * Process queued requests when back online
   */
  async processQueuedRequests() {
    while (this.requestQueue.length > 0) {
      const { endpoint, options, resolve, reject } = this.requestQueue.shift();
      try {
        const result = await this.request(endpoint, options);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }
  }

  /**
   * GET request
   */
  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch(endpoint, body, options = {}) {
    return this.request(endpoint, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Download file
   */
  async downloadFile(endpoint, filename) {
    const response = await window.apiCall(`${this.baseURL}${endpoint}`, {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}

/**
 * Global API client instance
 */
const apiClient = new APIClient();

/**
 * Setup default interceptors
 */
apiClient.addRequestInterceptor(async (config) => {
  // Add auth token if available
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

apiClient.addErrorInterceptor(async (error) => {
  // Handle 401 Unauthorized - redirect to login.
  // Use the real authservice login page (there is no '/login' route) and pass a
  // returnUrl so the user lands back here after re-authenticating.
  if (error.status === 401) {
    localStorage.removeItem('authToken');
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
  }

  // Re-throw error for caller to handle
  throw error;
});
