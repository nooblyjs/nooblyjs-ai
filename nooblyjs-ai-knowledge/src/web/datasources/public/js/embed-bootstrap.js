/**
 * embed-bootstrap.js — makes the (unchanged) web datasources app run inside a
 * host shell such as the Microsoft Teams tab, which loads it in a cross-site
 * iframe where the SameSite=lax session cookie does NOT flow. Instead of
 * cookies, the host mints a bearer token (trusted login → /api/auth/identity)
 * and hands it to this page; we attach it to every same-origin API call so the
 * app authenticates exactly as it would with a cookie.
 *
 * This is the ENTIRE client-side cost of embedding: one fetch/XHR interceptor +
 * a postMessage handshake + a theme link. The datasources app is untouched.
 *
 * Loaded as the FIRST <script> in index.html (classic, synchronous) so the
 * fetch patch is installed before apiConfig.js / app.js run their auth check —
 * which, on a 401, hard-redirects to the (un-frameable) authservice login page.
 * Self-gates on `?embed=1`: a normal web visit is a complete no-op.
 *
 * Handshake (host ⇄ iframe), both directions postMessage:
 *   iframe → host : { type: 'kr-embed-ready' }            (pinged until answered)
 *   host   → iframe: { type: 'kr-embed-auth', token, theme }
 *   iframe → host : { type: 'kr-embed-auth-expired' }     (on a 401; host re-mints)
 *
 * Mirror of src/web/wiki/public/js/embed-bootstrap.js (the wiki was
 * embedded first; keep the two in sync). The only datasources-specific bits are
 * the API path matcher (/api + /services, root-level) and the theme link href.
 *
 * @since 2026-06-10 (thin-shell / iframe parity for datasources)
 */
(function () {
  'use strict';

  let params = new URLSearchParams(window.location.search);
  let STORE_KEY = 'kr-embed';
  let THEME_KEY = 'kr-embed-theme';

  // Embed mode must be STICKY for the life of this browsing context. The app
  // may rewrite the URL during navigation (dropping ?embed=1), so a later full
  // reload could land on a param-less URL and revert to the plain web theme. We
  // persist embed mode in sessionStorage (scoped to THIS frame/tab, so normal
  // web visits elsewhere are unaffected) AND keep the query param alive across
  // history updates.
  let sticky = false;
  try { sticky = sessionStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* storage blocked */ }
  if (params.get('embed') !== '1' && !sticky) return; // normal web load → no-op
  try { sessionStorage.setItem(STORE_KEY, '1'); } catch (e) { /* ignore */ }

  // ---- theme + chrome: apply immediately so there's no flash -----------------
  let theme = params.get('theme') || '';
  if (!theme) { try { theme = sessionStorage.getItem(THEME_KEY) || ''; } catch (e) { /* ignore */ } }
  if (theme) { try { sessionStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ } }

  // Keep ?embed=1 (+ theme) on the URL across SPA pushState/replaceState so a
  // manual reload re-enters embed mode from the query immediately.
  patchHistory();

  document.documentElement.classList.add('kr-embed');
  applyTheme(theme);

  function withEmbedParams(url) {
    try {
      let u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) return url; // leave cross-origin alone
      u.searchParams.set('embed', '1');
      if (theme) u.searchParams.set('theme', theme);
      return u.pathname + u.search + u.hash;
    } catch (e) { return url; }
  }
  function patchHistory() {
    ['pushState', 'replaceState'].forEach(function (m) {
      let orig = history[m];
      if (typeof orig !== 'function' || orig.__krWrapped) return;
      let wrapped = function (state, title, url) {
        if (url != null) url = withEmbedParams(url);
        return orig.call(this, state, title, url);
      };
      wrapped.__krWrapped = true;
      history[m] = wrapped;
    });
  }

  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-kr-embed-theme', t);
    if (t === 'teams' && !document.getElementById('kr-teams-theme')) {
      let l = document.createElement('link');
      l.id = 'kr-teams-theme';
      l.rel = 'stylesheet';
      l.href = '/applications/datasources/css/teams-theme.css';
      // Append to <head> now; it loads alongside the app's own stylesheets.
      (document.head || document.documentElement).appendChild(l);
    }
  }

  // ---- token plumbing -------------------------------------------------------
  // tokenValue holds the latest bearer token (updated on refresh). tokenReady
  // resolves the first time a token (or the timeout) settles, so API calls made
  // before the host answers simply wait rather than firing unauthenticated.
  let tokenValue = null;
  let tokenSettled = false;
  let resolveToken;
  let tokenReady = new Promise(function (res) { resolveToken = res; });

  function setToken(t) {
    tokenValue = t || null;
    if (!tokenSettled) { tokenSettled = true; resolveToken(tokenValue); }
  }

  function awaitToken() {
    if (tokenSettled) return Promise.resolve(tokenValue);
    // Never hang forever: if the host never answers, proceed after 8s (the call
    // will 401, which is a clearer failure than a frozen page).
    return Promise.race([
      tokenReady,
      new Promise(function (res) { setTimeout(function () { res(tokenValue); }, 8000); })
    ]);
  }

  // A ?token= on the iframe URL is honoured as a fallback (handy for testing the
  // embedded page directly, without a host).
  if (params.get('token')) setToken(params.get('token'));

  // ---- host handshake -------------------------------------------------------
  function postToHost(msg) {
    try { window.parent && window.parent.postMessage(msg, '*'); } catch (e) { /* parent gone */ }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return; // only trust our host frame
    let d = e.data || {};
    if (d.type === 'kr-embed-auth' && typeof d.token === 'string') {
      setToken(d.token);
      if (d.theme) applyTheme(d.theme);
    }
  });

  // Announce readiness until the host answers with a token (covers either side
  // winning the load race).
  let pings = 0;
  postToHost({ type: 'kr-embed-ready' });
  let pinger = setInterval(function () {
    if (tokenSettled || pings++ > 40) { clearInterval(pinger); return; }
    postToHost({ type: 'kr-embed-ready' });
  }, 200);

  let lastExpiryNotice = 0;
  function notifyAuthExpired() {
    let now = Date.now();
    if (now - lastExpiryNotice < 3000) return; // debounce a burst of 401s
    lastExpiryNotice = now;
    postToHost({ type: 'kr-embed-auth-expired' });
  }

  // ---- fetch interceptor ----------------------------------------------------
  // Attach the bearer token to same-origin API calls. CDN/cross-origin requests
  // pass straight through (and are never delayed waiting for the token). The
  // datasources app talks to the root /api surface (workflows, spaces, auth,
  // agents, settings) and the shared /services surface (filing, uiservice).
  let sameOrigin = window.location.origin;
  function isApiUrl(raw) {
    try {
      let u = new URL(raw, window.location.href);
      if (u.origin !== sameOrigin) return false;
      return /^\/(api|services)\//.test(u.pathname);
    } catch (e) { return false; }
  }

  let origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      let url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!isApiUrl(url)) return origFetch(input, init);

      return awaitToken().then(function (token) {
        let nextInput = input;
        let nextInit = init;
        if (token) {
          if (typeof input === 'string' || input instanceof URL) {
            nextInit = Object.assign({}, init);
            let h = new Headers((init && init.headers) || {});
            if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + token);
            nextInit.headers = h;
          } else {
            // Request object: clone it with the header merged in.
            let rh = new Headers(input.headers);
            if (init && init.headers) new Headers(init.headers).forEach(function (v, k) { rh.set(k, v); });
            if (!rh.has('Authorization')) rh.set('Authorization', 'Bearer ' + token);
            nextInput = new Request(input, Object.assign({}, init, { headers: rh }));
            nextInit = undefined;
          }
        }
        return origFetch(nextInput, nextInit).then(function (resp) {
          if (resp && resp.status === 401) notifyAuthExpired();
          return resp;
        });
      });
    };
  }

  // ---- XMLHttpRequest interceptor -------------------------------------------
  // Some paths (file uploads, third-party widgets) use XHR rather than fetch, so
  // the fetch shim above doesn't cover them. Attach the bearer token to
  // same-origin API XHRs too. send() is deferred until the token has settled.
  let XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    let origOpen = XHR.prototype.open;
    let origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__krApiUrl = isApiUrl(url || '');
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      let self = this;
      let args = arguments;
      if (!self.__krApiUrl) return origSend.apply(self, args);
      awaitToken().then(function (token) {
        try { if (token) self.setRequestHeader('Authorization', 'Bearer ' + token); } catch (e) { /* header set too late */ }
        origSend.apply(self, args);
      });
    };
  }

  // ---- token on <img>/<embed>/<iframe> src ----------------------------------
  // Tags that can't send an Authorization header authenticate via ?token=. The
  // backend bridges ?token= → Bearer for /services/filing/api/* (filing previews
  // are the datasources surface that serves authenticated binaries). We rewrite
  // matching srcs once the token is known and on any later DOM mutation.
  awaitToken().then(function (token) {
    if (!token) return;
    let TOKENABLE = '/services/filing/api/';
    function tokenize(el, attr) {
      let v = el.getAttribute(attr);
      if (!v) return;
      try {
        let u = new URL(v, window.location.href);
        if (u.origin !== sameOrigin || u.pathname.indexOf(TOKENABLE) !== 0) return;
        if (u.searchParams.has('token')) return;
        u.searchParams.set('token', token);
        el.setAttribute(attr, u.pathname + u.search);
      } catch (e) { /* ignore */ }
    }
    function sweep(root) {
      let nodes = (root.querySelectorAll ? root.querySelectorAll('img[src],embed[src],iframe[src],source[src]') : []);
      for (let i = 0; i < nodes.length; i++) tokenize(nodes[i], 'src');
    }
    sweep(document);
    try {
      new MutationObserver(function (muts) {
        for (let i = 0; i < muts.length; i++) {
          for (let j = 0; j < muts[i].addedNodes.length; j++) {
            let n = muts[i].addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (/^(IMG|EMBED|IFRAME|SOURCE)$/.test(n.tagName)) tokenize(n, 'src');
            else sweep(n);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* observer unsupported */ }
  });

  console.info('[embed-bootstrap] Datasources running in embedded mode (theme=' + (theme || 'default') + ').');
})();
