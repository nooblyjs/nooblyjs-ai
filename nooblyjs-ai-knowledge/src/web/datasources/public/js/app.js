/* Datasources app bootstrap (UI upgrade cutover).
   Initialises the UIService shell, gates access with auth + RBAC, builds the
   sidebar, then hands all screen rendering to the Router (js/core/router.js).
   Individual screens live in js/screens/*. */
(function () {
  // Roles allowed into the datasources app. A global 'admin' is a superuser and
  // is accepted alongside the dedicated role — kept in sync with the server-side
  // roleValidationMiddleware so the client and server agree (mismatch loops).
  const ALLOWED_ROLES = ['Datasources Administrator', 'admin'];

  // screen id · sidebar label · Bootstrap icon · section
  // The Spaces section has no nav item of its own — the section heading is the
  // entry point (see makeSpacesHeadingClickable) and the managed spaces are
  // listed beneath it (see loadSidebarSpaces).
  const NAV = [
    { screen: 'dashboard',  text: 'Dashboard',         icon: 'bi-speedometer2',   section: 'main' },
    { screen: 'workflows',  text: 'Workflows',         icon: 'bi-signpost-split', section: 'workflow' },
    { screen: 'schedules',  text: 'Schedules',         icon: 'bi-calendar-check', section: 'workflow' },
    { screen: 'executions', text: 'Execution History', icon: 'bi-clock-history',  section: 'workflow' },
    { screen: 'sources',    text: 'Sources',           icon: 'bi-download',       section: 'main' },
    { screen: 'needs-review', text: 'Needs review',    icon: 'bi-flag',           section: 'main' },
    { screen: 'agents',     text: 'Agents',            icon: 'bi-stars',          section: 'ai' },
    { screen: 'prompts',    text: 'Prompts',           icon: 'bi-journal-text',   section: 'ai' },
    { screen: 'user-activity', text: 'User Activity',  icon: 'bi-people',         section: 'system' },
    { screen: 'settings',   text: 'Settings',          icon: 'bi-gear',           section: 'system' },
  ];
  const SECTIONS = [
    { id: 'main',         title: '' },
    { id: 'workflow',     title: 'Workflow' },
    { id: 'spaces',       title: 'Spaces' },
    { id: 'repositories', title: 'Repositories' },  // grows to fill — see growRepositoriesSection()
    { id: 'ai',           title: 'AI' },
    { id: 'system',       title: 'System' },         // pinned to the bottom
  ];

  let ui;

  function buildSidebar() {
    return {
      sections: SECTIONS.map((sec) => ({
        id: sec.id,
        title: sec.title,
        collapsible: false,
        items: NAV.filter((n) => n.section === sec.id).map((n) => ({
          text: n.text,
          icon: n.icon,
          href: '#',
          // Items flagged `disabled` render but never navigate.
          onClick: n.disabled
            ? (e) => { e.preventDefault(); }
            : (e) => { e.preventDefault(); window.Router.navigate(n.screen); },
        })),
      })),
    };
  }

  /* UIService renders sidebar links in section/item order but adds no screen
     marker — tag each so Router.syncSidebar() can highlight the active one. */
  function tagSidebar() {
    const links = document.querySelectorAll('.kr-sidebar .kr-nav-item');
    const flat = SECTIONS.reduce((acc, s) => acc.concat(NAV.filter((n) => n.section === s.id)), []);
    links.forEach((link, i) => { if (flat[i]) link.setAttribute('data-screen', flat[i].screen); });
  }

  /* Make the Repositories section grow to fill the sidebar — this keeps Spaces
     and Repositories together at the top and pushes AI + System down so System
     sits locked at the bottom. Repositories content scrolls internally when
     there are many repositories. */
  function growRepositoriesSection() {
    const content = document.getElementById('repositories-content');
    if (!content) return;
    content.classList.add('kr-section-grow-content');
    if (content.parentElement) content.parentElement.classList.add('kr-section-grow');
  }

  /* The Spaces section has no nav item — make its section heading the entry
     point, so clicking "SPACES" opens the spaces list (what the old Spaces
     folder item did). */
  function makeSpacesHeadingClickable() {
    const content = document.getElementById('spaces-content');
    if (!content || !content.parentElement) return;
    const head = content.parentElement.querySelector('.kr-side-head');
    if (!head) return;
    head.style.cursor = 'pointer';
    head.setAttribute('role', 'button');
    head.title = 'View all spaces';
    head.setAttribute('data-screen', 'spaces');   // let Router.syncSidebar highlight it
    head.addEventListener('click', (e) => {
      e.preventDefault();
      window.Router.navigate('spaces');
    });
  }

  /* The Repositories section heading opens the repositories list screen,
     mirroring the Spaces heading. */
  function makeRepositoriesHeadingClickable() {
    const content = document.getElementById('repositories-content');
    if (!content || !content.parentElement) return;
    const head = content.parentElement.querySelector('.kr-side-head');
    if (!head) return;
    head.style.cursor = 'pointer';
    head.setAttribute('role', 'button');
    head.title = 'View all repositories';
    head.setAttribute('data-screen', 'repositories');
    head.addEventListener('click', (e) => {
      e.preventDefault();
      window.Router.navigate('repositories');
    });
  }

  /* Fetch the git-backed repositories and list them under the Repositories nav.
     Clicking a repository opens its analytics screen. */
  async function loadSidebarRepositories() {
    const content = document.getElementById('repositories-content');
    if (!content) return;
    let repos = [];
    try {
      repos = await window.DS.api.get('/api/repositories') || [];
    } catch (err) {
      console.warn('Could not load repositories for sidebar:', err && err.message);
      return;
    }
    repos.forEach((r) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'kr-nav-item kr-nav-subitem';
      a.title = r.name || 'Repository';
      const ic = document.createElement('i');
      ic.className = r.registered ? 'bi bi-git' : 'bi bi-folder';
      const label = document.createElement('span');
      label.textContent = ' ' + (r.name || 'Repository');
      a.appendChild(ic);
      a.appendChild(label);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.Router.navigate('repository', { instance: r.instanceName, name: r.name || 'Repository' });
      });
      content.appendChild(a);
    });
  }

  /* Grey out any nav item flagged `disabled` so it reads as deliberately
     unavailable rather than broken. No item is disabled today. */
  function disableNavItems() {
    NAV.filter((n) => n.disabled).forEach((n) => {
      const link = document.querySelector(`.kr-sidebar [data-screen="${n.screen}"]`);
      if (!link) return;
      link.classList.add('kr-nav-disabled');
      link.style.opacity = '0.45';
      link.style.pointerEvents = 'none';
      link.style.cursor = 'default';
      link.setAttribute('aria-disabled', 'true');
      link.title = 'Coming soon';
    });
  }

  /* Fetch managed spaces and list them as sub-items under the Spaces nav.
     Clicking a space opens its file browser. */
  async function loadSidebarSpaces() {
    const content = document.getElementById('spaces-content');
    if (!content) return;
    let spaces = [];
    try {
      spaces = await window.DS.api.get('/api/spaces') || [];
    } catch (err) {
      console.warn('Could not load spaces for sidebar:', err && err.message);
      return;
    }
    spaces.forEach((sp) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'kr-nav-item kr-nav-subitem';
      a.title = sp.name || 'Space';
      const ic = document.createElement('i');
      ic.className = 'bi bi-folder';
      const label = document.createElement('span');
      label.textContent = ' ' + (sp.name || 'Space');
      a.appendChild(ic);
      a.appendChild(label);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.Router.navigate('spaces', { browse: sp.id, spaceName: sp.name || 'Space' });
      });
      content.appendChild(a);
    });
  }

  /* User pill (email + avatar initial) and a logout icon — matches the
     wiki topbar treatment. */
  function addUserControls(user) {
    const navDiv = document.querySelector('.navbar-nav');
    if (!navDiv) return;

    const email = user.email || user.username || user.name || 'User';
    const initial = (email.trim().charAt(0) || 'U').toUpperCase();

    const pill = document.createElement('div');
    pill.className = 'kr-user-pill';
    const emailSpan = document.createElement('span');
    emailSpan.className = 'kr-user-email';
    emailSpan.textContent = email;
    emailSpan.title = email;
    const avatar = document.createElement('span');
    avatar.className = 'kr-user-avatar';
    avatar.textContent = initial;

    // Uploaded profile picture (set in the wiki profile) covers the initial
    // when one exists; a failed load (404 = none uploaded) removes the img and
    // the initial shows through. Served app-wide by the wiki avatar route.
    if (user.email) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = `/applications/wiki/avatars/${encodeURIComponent(user.email)}`;
      img.addEventListener('error', () => img.remove());
      avatar.appendChild(img);
    }

    pill.appendChild(emailSpan);
    pill.appendChild(avatar);

    const logout = document.createElement('a');
    logout.href = '#';
    logout.className = 'kr-logout-btn';
    logout.title = 'Sign out';
    logout.setAttribute('aria-label', 'Sign out');
    logout.innerHTML = '<i class="bi bi-box-arrow-right"></i>';
    logout.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/services/authservice/logout';
    });

    navDiv.appendChild(pill);
    navDiv.appendChild(logout);
  }

  function redirectToLogin() {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
  }

  /* Authenticate, enforce the Datasources Administrator role, then render. */
  async function bootstrap() {
    let user = null;
    try {
      const res = await window.apiCall('/api/auth/check');
      const data = await res.json();
      if (data && data.authenticated && data.user) user = data.user;
    } catch (err) {
      console.warn('Auth check failed:', err && err.message);
    }

    if (!user) { redirectToLogin(); return; }

    const roles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    if (!roles.some(role => ALLOWED_ROLES.includes(role))) {
      console.warn(`Access denied — one of [${ALLOWED_ROLES.join(', ')}] required.`);
      window.location.href = '/services/authservice/invalid.html';
      return;
    }

    console.log(`AUTH OK — ${user.email || user.username || 'user'} (${roles.join(', ')})`);

    try {
      ui.createLayout({
        header: {
          brandText: 'noobly Wiki',
          brandSubtext: 'Datasources',
          brandIcon: '/images/noobly-logo-colour.png',
          showSearch: false,
          showCreateBtn: false,
          showAIChat: false,
          showUserProfile: false,
        },
        sidebar: buildSidebar(),
      });
    } catch (err) {
      console.error('Failed to create UIService layout:', err);
      return;
    }

    addUserControls(user);
    tagSidebar();
    growRepositoriesSection();
    makeSpacesHeadingClickable();
    makeRepositoriesHeadingClickable();
    disableNavItems();
    window.Router.start('dashboard');
    loadSidebarSpaces();
    loadSidebarRepositories();
  }

  function initializeApp() {
    if (typeof UIService === 'undefined') {
      console.warn('UIService not ready, waiting for UIServiceLoaded…');
      return;
    }
    ui = new UIService({ containerId: 'App' });
    window.ui = ui;   // legacy step editors look for window.ui.showToast
    bootstrap();
  }

  // UIService loads asynchronously — initialise now if ready, else wait.
  if (typeof UIService !== 'undefined') {
    initializeApp();
  } else {
    document.addEventListener('UIServiceLoaded', initializeApp);
  }
})();
