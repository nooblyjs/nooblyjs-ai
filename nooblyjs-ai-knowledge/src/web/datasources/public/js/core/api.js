/* Datasources API helper.
   Thin wrapper over window.apiClient (defined in apiConfig.js), which
   returns raw fetch Response objects. Normalises the backend envelope
   { success, data } down to the payload and surfaces HTTP errors. */
(function () {
  async function unwrap(response) {
    if (!response) return null;

    // Raw fetch Response
    if (typeof response.json === 'function') {
      let body = null;
      try { body = await response.json(); } catch (e) { body = null; }
      if (!response.ok) {
        const err = new Error((body && body.error) || `HTTP ${response.status}: ${response.statusText}`);
        err.status = response.status;
        err.body = body;
        throw err;
      }
      if (body && typeof body === 'object' && typeof body.data !== 'undefined') return body.data;
      return body;
    }

    // Already-parsed apiClient-class envelope { status, data: { success, data } }
    if (typeof response.data !== 'undefined') {
      const body = response.data;
      if (body && typeof body === 'object' && typeof body.data !== 'undefined') return body.data;
      return body;
    }

    return response;
  }

  function client() {
    if (!window.apiClient) throw new Error('apiClient not loaded — check apiConfig.js load order');
    return window.apiClient;
  }

  const api = {
    async get(path)        { return unwrap(await client().get(path)); },
    async post(path, body) { return unwrap(await client().post(path, body)); },
    async put(path, body)  { return unwrap(await client().put(path, body)); },
    async del(path)        { return unwrap(await client().delete(path)); },
    unwrap,
  };

  window.DS = window.DS || {};
  window.DS.api = api;
})();
