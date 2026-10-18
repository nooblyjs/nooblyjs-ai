/* Real-time bridge — wraps the Socket.IO client.
   The datasources backend emits workflow lifecycle events via Socket.IO
   (see CLAUDE.md: global.io.emit('workflow:start' | 'workflow:complete', …)).

   Screens subscribe with a key so re-subscribing on re-render replaces the
   previous handler rather than stacking:
     DS.realtime.on('dashboard', 'workflow:complete', handler)
   Handlers should still guard on the active screen — stale subscriptions
   are harmless but should not act when their screen is not visible. */
(function () {
  const RELAY = [
    'workflow:start', 'workflow:complete', 'workflow:error',
    'execution:start', 'execution:complete', 'execution:update',
  ];

  const listeners = {};   // event -> { key: handler }
  let socket = null;
  let connected = false;

  function dispatch(event, payload) {
    const map = listeners[event];
    if (!map) return;
    Object.keys(map).forEach((key) => {
      try { map[key](payload, event); }
      catch (err) { console.error(`[realtime] handler "${key}" for ${event} failed:`, err); }
    });
  }

  function connect() {
    if (socket) return;
    if (typeof window.io === 'undefined') {
      console.warn('[realtime] Socket.IO client not loaded — live updates disabled');
      return;
    }
    try {
      socket = window.io(window.API_BASE_URL || undefined, {
        withCredentials: true,
        // Poll first (survives HTTP proxies), then upgrade to websocket.
        transports: ['polling', 'websocket'],
      });
      socket.on('connect', () => { connected = true; });
      socket.on('disconnect', () => { connected = false; });
      socket.on('connect_error', (e) => { connected = false; console.warn('[realtime] connect_error:', e && e.message); });
      RELAY.forEach((evt) => socket.on(evt, (payload) => dispatch(evt, payload)));
    } catch (err) {
      console.warn('[realtime] failed to connect:', err);
    }
  }

  function on(key, event, handler) {
    connect();
    (listeners[event] = listeners[event] || {})[key] = handler;
  }

  function off(key, event) {
    if (event) {
      if (listeners[event]) delete listeners[event][key];
    } else {
      Object.keys(listeners).forEach((e) => { delete listeners[e][key]; });
    }
  }

  window.DS = window.DS || {};
  window.DS.realtime = { on, off, connect, isConnected: () => connected };
})();
