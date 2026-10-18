/* Datasources screen router.
   Adapted from the UI-Dashboard prototype to mount screens into the
   UIService shell instead of a self-rendered <main>.

   A screen is registered as:
     Router.register(id, { html(state), init?(root, state), handle?(action, el, e, state) }, meta)
   where `meta` = { title, sub, crumb: [..] } drives pageHead().

   Screen content is rendered into #mainContent (created by UIService),
   wrapped in a `.kr-ds` root so the design system CSS applies and never
   collides with Bootstrap. Navigation and clicks use `data-action`
   delegation: data-action="nav" data-screen="<id>" routes between screens,
   data-action="modal-close" closes the modal, anything else is handed to
   the active screen's handle(). */
(function () {
  const Screens = window.Screens = window.Screens || {};
  const META = {};
  const state = { screen: null, params: {} };

  function register(id, screen, meta) {
    Screens[id] = screen;
    if (meta) META[id] = meta;
  }

  /* ---------- Render helpers exposed to screens ---------- */
  function pageHead(id, actions = '') {
    const meta = META[id];
    if (!meta) return '';
    const crumb = meta.crumb || [];
    const crumbs = crumb.map((c, i) =>
      `<span class="sep">${icon('chevronRight', 12)}</span>` +
      `<span class="${i === crumb.length - 1 ? 'here' : ''}">${c}</span>`
    ).join('');
    return `
      <div class="page-head">
        <div>
          <div class="crumb">${icon('home', 12)}${crumbs}</div>
          <h1 class="page-title">${meta.title || ''}</h1>
          ${meta.sub ? `<p class="page-sub">${meta.sub}</p>` : ''}
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ''}
      </div>
    `;
  }

  function mountHost() {
    return document.getElementById('mainContent');
  }

  function renderScreen() {
    const host = mountHost();
    if (!host) {
      console.error('[Router] #mainContent not found — is the UIService layout rendered?');
      return;
    }
    const screen = Screens[state.screen];
    if (!screen) {
      host.innerHTML = `<div class="kr-ds"><div class="empty-state">
        <div class="ico">${icon('alertCircle', 22)}</div>
        <div style="font-size:14px;font-weight:600">Unknown screen: ${state.screen}</div>
      </div></div>`;
      return;
    }
    host.innerHTML = `<div class="kr-ds" data-screen="${state.screen}">${screen.html(state)}</div>`;
    try {
      screen.init && screen.init(host.querySelector('.kr-ds'), state);
    } catch (err) {
      console.error(`[Router] init() failed for screen "${state.screen}":`, err);
    }
    if (typeof host.scrollTo === 'function') host.scrollTo(0, 0);
  }

  function navigate(id, params) {
    state.screen = id;
    state.params = params || {};
    renderScreen();
    syncSidebar(id);
    /* A host that owns the address bar and the sidebar (the NooblyJS frame) is told
       which screen is showing. Nothing sets this on the standalone page. */
    if (window.Router && typeof window.Router.onNavigate === 'function') {
      window.Router.onNavigate(id, state.params);
    }
  }

  /* Re-render only the active screen (cheap for in-screen state changes). */
  function rerenderScreen() {
    renderScreen();
  }

  /* Best-effort: mark the matching UIService sidebar entry active. */
  function syncSidebar(id) {
    document.querySelectorAll('.kr-sidebar [data-screen]').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-screen') === id);
    });
  }

  /* ---------- Modal ---------- */
  function modalRoot() {
    let root = document.getElementById('kr-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'kr-modal-root';
      root.className = 'kr-ds';
      document.body.appendChild(root);
    }
    return root;
  }
  function openModal(html) {
    modalRoot().innerHTML = `<div class="modal-backdrop">${html}</div>`;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    const root = document.getElementById('kr-modal-root');
    if (root) root.innerHTML = '';
    document.body.style.overflow = '';
  }

  /* ---------- Delegated event handling ---------- */
  function onClick(e) {
    const backdrop = e.target.closest('.modal-backdrop');
    if (backdrop && !e.target.closest('.modal-card')) {
      closeModal();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'nav') {
      navigate(el.dataset.screen, el.dataset.params ? JSON.parse(el.dataset.params) : undefined);
      return;
    }
    if (action === 'modal-close') {
      closeModal();
      return;
    }
    const screen = Screens[state.screen];
    if (screen && screen.handle) {
      try {
        screen.handle(action, el, e, state);
      } catch (err) {
        console.error(`[Router] handle("${action}") failed on screen "${state.screen}":`, err);
      }
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }

  /* ---------- Boot ---------- */
  let booted = false;
  function start(defaultScreen) {
    if (booted) {
      if (defaultScreen) navigate(defaultScreen);
      return;
    }
    booted = true;
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
    navigate(defaultScreen || state.screen || Object.keys(Screens)[0]);
  }

  window.Router = { register, navigate, rerenderScreen, start, openModal, closeModal, state };

  /* Globals mirrored from the prototype so screen modules port verbatim. */
  window.pageHead = pageHead;
  window.rerenderScreen = rerenderScreen;
  window.navTo = navigate;
  window.openModal = openModal;
  window.closeModal = closeModal;
})();
