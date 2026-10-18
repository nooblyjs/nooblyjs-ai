/* Repositories screens — /api/repositories.
   `repositories`  : card list of the git-backed filers registered on startup.
   `repository`    : per-filer analytics (branch, ahead/behind, working tree,
                     pending commits, sync settings) sourced from the core
                     filing/git provider (getGitStatus / getSettings), plus a
                     sync button that runs the repository's CONFIGURED
                     synchronisation on demand (POST …/sync), a Compact button
                     that drops history from this host's clone (POST …/compact)
                     and a Reset button that discards local state and matches the
                     remote (POST …/reset).

   The sync button's label and behaviour come from the server's `syncActions`
   (derived from synchronization.commit / .fetch), never from a local guess — the
   backend refuses any direction the repository is not configured for, so a button
   offering something else would just produce a 400. Because the button lives in
   pageHead(), which html() renders synchronously BEFORE the fetch resolves, it
   starts disabled and is painted by paintSyncButton() once analytics arrive. The
   same applies to Compact and Reset. */
(function () {
  const { escapeHtml, toast } = window.DS.util;
  const api = window.DS.api;

  const local = { repos: [], analytics: null };

  /* ---------- formatting ---------- */
  function fmtSeconds(sec) {
    const n = Number(sec);
    if (!n || n <= 0) return '—';
    if (n % 3600 === 0) return `${n / 3600} h`;
    if (n % 60 === 0) return `${n / 60} min`;
    return `${n} s`;
  }
  function fmtMs(ms) {
    const n = Number(ms);
    if (!n || n <= 0) return '—';
    return fmtSeconds(Math.round(n / 1000));
  }
  function fmtBytes(b) {
    const n = Number(b);
    if (!n || n <= 0) return '—';
    if (n < 1048576) return `${Math.round(n / 1024)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  }
  function fmtAge(ms) {
    const n = Number(ms);
    if (!n || n <= 0) return 'a moment';
    const sec = Math.round(n / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr}h`;
    return `${Math.round(hr / 24)} days`;
  }
  function onOff(v) {
    return v
      ? `<span style="color:var(--success-700)">On</span>`
      : `<span style="color:var(--ink-400,#94a3b8)">Off</span>`;
  }
  function syncBadges(sync) {
    sync = sync || {};
    const on = (label, ic, active) => active
      ? `<span class="badge success">${icon(ic, 10)} ${label}</span>`
      : `<span class="badge neutral">${icon(ic, 10)} ${label} off</span>`;
    return `${on('Fetch', 'download', sync.fetch)} ${on('Commit', 'upload', sync.commit)}`;
  }

  /* ---------- health ----------
     A repository can be REGISTERED and still be completely broken. Registration is
     synchronous and reads the config alone; the clone runs detached afterwards so
     the server can bind its port. That is why "Active + auto-fetch On + interval
     1 h" used to be shown for a repository that had never once synced — all three
     come from repositories.json, not from anything that ran.

     So health is judged by what HAPPENED (`setup`, recorded by repositoryManager)
     and by what is on disk NOW (`localFolderExists` / `cloned`). The disk check is
     not redundant: after repositories.json is corrected but before the backend is
     restarted, `setup` still describes the old, wrong path. */
  function healthOf(r) {
    const status = (r && r.setup && r.setup.status) || null;
    const failed = status === 'failed' || status === 'skipped';
    // Recorded failure, but localFolder now names a real clone: the config has
    // been corrected since boot and only a restart is outstanding. Reporting that
    // as a live fault makes a completed fix look like it did nothing.
    if (failed && r.localFolderExists === true && r.cloned === true) {
      return { tone: 'warn', ico: 'alertCircle', label: 'Restart pending' };
    }
    if (status === 'failed') return { tone: 'danger', ico: 'alertTriangle', label: 'Setup failed' };
    if (status === 'skipped') return { tone: 'danger', ico: 'alertTriangle', label: 'Not cloned' };
    if (r && r.localFolder && !r.localFolderExists) return { tone: 'danger', ico: 'alertTriangle', label: 'Folder missing' };
    if (r && r.localFolder && !r.cloned) return { tone: 'warn', ico: 'alertCircle', label: 'No clone yet' };
    if (status === 'pending') return { tone: 'neutral', ico: 'clock', label: 'Cloning…' };
    if (r && r.registered) return { tone: 'success', ico: 'checkCircle', label: 'Active' };
    return { tone: 'neutral', ico: 'alertCircle', label: 'Inactive' };
  }

  /* ---------- stat tile ---------- */
  function tile(value, label, ico, accent, sub) {
    return `<div class="card"><div class="card-pad" style="padding:15px 17px">
      <div style="display:flex;align-items:center;gap:6px;color:var(--ink-500);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">
        ${ico ? icon(ico, 13) : ''} ${label}
      </div>
      <div style="font-size:25px;font-weight:700;color:${accent || 'var(--ink-900)'};margin-top:6px;line-height:1.1">${value}</div>
      ${sub ? `<div style="font-size:11.5px;color:var(--ink-500);margin-top:4px">${sub}</div>` : ''}
    </div></div>`;
  }

  /* ================= list screen ================= */
  function listBody() {
    const list = local.repos;
    if (!list.length) {
      return `<div class="card"><div class="empty-state">
        <div class="ico">${icon('git', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No repositories</div>
        <div style="font-size:12.5px;margin:4px 0 4px">Add entries to <span class="mono">.application/spaces/repositories.json</span> and restart the backend.</div>
      </div></div>`;
    }
    return `<div class="grid-3">
      ${list.map((r) => {
        const params = escapeHtml(JSON.stringify({ instance: r.instanceName, name: r.name }));
        const health = healthOf(r);
        const folderBroken = !!(r.localFolder && !r.localFolderExists);
        return `<div class="card"><div class="card-pad">
          <div class="row between" style="align-items:flex-start">
            <div style="width:38px;height:38px;border-radius:9px;background:var(--gold-50);color:var(--gold-700);display:flex;align-items:center;justify-content:center">${icon('git', 18)}</div>
            <span class="badge ${health.tone}">${icon(health.ico, 10)} ${health.label}</span>
          </div>
          <div style="font-weight:600;font-size:14px;color:var(--ink-900);margin-top:10px">${escapeHtml(r.name)}</div>
          <div class="mono" style="font-size:11px;color:var(--ink-500);margin-top:3px;word-break:break-all">${escapeHtml(r.repository || '')}</div>
          <div style="font-size:11.5px;color:${folderBroken ? 'var(--danger-700)' : 'var(--ink-500)'};margin-top:6px;display:flex;align-items:center;gap:5px"
               ${folderBroken ? 'title="This folder does not exist on this host — check localFolder in repositories.json."' : ''}>
            ${icon('folder', 12)} <span style="word-break:break-all">${escapeHtml(r.localFolder || '')}</span>
          </div>
          <div class="row" style="gap:6px;margin-top:9px">
            <span class="tag">${icon('branch', 10)} ${escapeHtml(r.branch || 'main')}</span>
            ${syncBadges(r.synchronization)}
          </div>
          <button class="btn btn-sm" style="width:100%;justify-content:center;margin-top:12px"
                  data-action="nav" data-screen="repository" data-params="${params}">
            ${icon('activity', 13)} View analytics
          </button>
        </div></div>`;
      }).join('')}
    </div>`;
  }

  function listHtml() {
    const actions = `<button class="btn btn-sm" data-action="refresh">${icon('refresh', 13)} Refresh</button>`;
    return `${pageHead('repositories', actions)}<div data-region="body"></div>`;
  }

  function listInit(root) {
    window.DS.util.loadRegion(root, async () => {
      local.repos = await api.get('/api/repositories') || [];
      return true;
    }, () => listBody());
  }

  function listHandle(action) {
    if (action === 'retry' || action === 'refresh') return rerenderScreen();
  }

  /* ================= analytics screen ================= */
  function analyticsBody(d) {
    const cfg = d.config || {};
    const git = d.git || {};
    const settings = d.settings || {};
    const changed = Array.isArray(git.files) ? git.files : [];

    const errorBanner = d.error
      ? `<div class="card" style="border-color:var(--danger-300,#fca5a5);background:var(--danger-50,#fef2f2);margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
          <span style="color:var(--danger-700)">${icon('alertTriangle', 16)}</span>
          <div><div style="font-weight:600;font-size:13px;color:var(--danger-700)">Git status unavailable</div>
          <div style="font-size:12px;color:var(--ink-600,#475569);margin-top:2px">${escapeHtml(d.error)}</div></div>
        </div></div>`
      : '';

    /* A leftover .git/index.lock blocks every sync, and the auto-commit timer
       fails against it silently — so it is called out here rather than left to be
       discovered by clicking. A FRESH lock is normal (a sync is running right
       now); only a stale one is a fault. */
    const lock = d.lock || null;
    const lockBanner = (lock && lock.present)
      ? (lock.stale
        ? `<div class="card" style="border-color:var(--danger-300,#fca5a5);background:var(--danger-50,#fef2f2);margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
            <span style="color:var(--danger-700)">${icon('lock', 16)}</span>
            <div><div style="font-weight:600;font-size:13px;color:var(--danger-700)">Git lock left behind — synchronisation is blocked</div>
            <div style="font-size:12px;color:var(--ink-600,#475569);margin-top:2px">
              <span class="mono">${escapeHtml(lock.path)}</span> has not been written for ${fmtAge(lock.ageMs)}, so no git process is using it — it is the leftover of one that was killed, usually a restart during an auto-commit. Every automatic sync has been failing against it since. Syncing now will clear it and continue.
            </div></div>
          </div></div>`
        : `<div class="card" style="margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
            <span style="color:var(--ink-500)">${icon('lock', 16)}</span>
            <div style="font-size:12.5px;color:var(--ink-600,#475569)">A git operation is running in this repository right now (lock held for ${fmtAge(lock.ageMs)}). Syncing will wait for it.</div>
          </div></div>`)
      : '';

    /* ---------- case collisions ----------
       Two tracked paths differing only in case are two files on the Linux host
       that wrote them and one file on this one. git checks out both blobs to that
       single path, the last write wins, and the loser is reported modified — after
       every checkout, every reset, every clean, forever. Sync then tries to commit
       the difference back each hour.

       This is the explanation for the only genuinely confusing state on this
       screen: "Reset to remote" finishing successfully and leaving 22 local
       changes exactly where they were. Nothing local can repair it — no filesystem
       here can hold both files — so the banner's job is to name the pairs and point
       at the only fix there is. */
    const collisions = d.caseCollisions || null;
    const collisionBanner = (collisions && collisions.stuck)
      ? `<div class="card" style="border-color:var(--warn-300,#fcd34d);background:var(--warn-50,#fffbeb);margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
          <span style="color:#92400E">${icon('alertTriangle', 16)}</span>
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13px;color:#92400E">
              ${collisions.stuck} file${collisions.stuck === 1 ? '' : 's'} cannot be made clean on this host
            </div>
            <div style="font-size:12px;color:var(--ink-600,#475569);margin-top:3px">
              These tracked paths differ from another tracked path <strong>only in case</strong>. Windows
              cannot hold both, so git writes both versions to the same file, the last one wins, and the
              other is reported modified — after every reset, checkout and clean. <strong>Reset cannot fix
              this</strong>, and each sync tries to commit the difference back.
            </div>
            <div style="margin-top:7px;max-height:190px;overflow:auto">
              ${collisions.groups.map((group) => `<div class="mono" style="font-size:11.5px;color:var(--ink-800);word-break:break-all;padding:3px 0;border-bottom:1px solid var(--line-100,#eef2f7)">
                ${group.map((p) => escapeHtml(p)).join('<br>')}
              </div>`).join('')}
            </div>
            <div style="font-size:12px;color:var(--ink-600,#475569);margin-top:7px">
              Fix it at the source: drop one variant from the repository (on a case-sensitive host, or
              <span class="mono">git rm --cached</span> the unwanted one and push) and stop whatever
              generates these documents from emitting two names that differ only in case.
            </div>
          </div>
        </div></div>`
      : '';

    const inactive = !d.registered
      ? `<div class="card" style="margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
          <span style="color:var(--ink-500)">${icon('info', 16)}</span>
          <div style="font-size:12.5px;color:var(--ink-600,#475569)">This repository is not currently registered as a live filer. Check <span class="mono">synchronization.enabled</span> in repositories.json and restart the backend.</div>
        </div></div>`
      : '';

    /* ---------- setup banner ----------
       The boot-time clone runs detached from startup so a slow one cannot hold the
       port, which leaves its failure with nowhere to be returned to — it was
       log-only. That is how two repositories whose localFolder pointed one
       directory above their real clones sat unsynced for three weeks while this
       screen showed them Active with auto-fetch On: every value on it came from
       the config rather than from anything that had run.

       The resolved path is spelled out because that is the actual diagnosis in
       nearly every case — seeing the folder it tried is what makes a wrong
       localFolder obvious at a glance. */
    const setup = d.setup || null;
    const folderMissing = cfg.localFolderExists === false;
    const setupFailed = !!setup && (setup.status === 'failed' || setup.status === 'skipped');
    /* A recorded failure the CONFIG has since outgrown: localFolder now names a
       real clone, so the stored outcome describes a path that is no longer
       configured. repositories.json is read once at boot, so this state is normal
       between correcting it and restarting — and it must not be reported as a
       live fault, or the fix looks like it did not work. */
    const healed = setupFailed && cfg.localFolderExists === true && cfg.cloned === true;

    const folderLine = cfg.localFolder
      ? `<div style="margin-top:7px;font-size:12px">
           <span style="color:var(--ink-500)">Local folder</span>
           <div class="mono" style="word-break:break-all;color:var(--ink-800);margin-top:2px">${escapeHtml(cfg.localFolder)}</div>
           <div style="color:var(--ink-500);margin-top:2px">
             ${folderMissing
               ? 'This folder does not exist on this host.'
               : (cfg.cloned === false ? 'This folder exists but holds no <span class="mono">.git</span> — it is not a clone.' : 'Folder present, clone detected.')}
           </div>
           <div style="color:var(--ink-500);margin-top:4px">A relative <span class="mono">localFolder</span> is resolved against <span class="mono">APP_BASE_DIR</span>. Correct it in <span class="mono">repositories.json</span> and restart the backend.</div>
         </div>`
      : '';

    let setupBanner = '';
    if ((setupFailed && !healed) || folderMissing) {
      const title = (setup && setup.status === 'skipped')
        ? 'Clone skipped — this repository has never synchronised'
        : 'Repository setup failed — this repository has never synchronised';
      setupBanner = `<div class="card" style="border-color:var(--danger-300,#fca5a5);background:var(--danger-50,#fef2f2);margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
          <span style="color:var(--danger-700)">${icon('alertTriangle', 16)}</span>
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13px;color:var(--danger-700)">${title}</div>
            ${setup && setup.error
              ? `<div style="font-size:12px;color:var(--ink-600,#475569);margin-top:3px">${escapeHtml(setup.error)}</div>`
              : ''}
            ${folderLine}
          </div>
        </div></div>`;
    } else if (healed) {
      setupBanner = `<div class="card" style="border-color:var(--warn-300,#fcd34d);background:var(--warn-50,#fffbeb);margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
          <span style="color:#92400E">${icon('alertCircle', 16)}</span>
          <div style="font-size:12.5px;color:var(--ink-600,#475569)">
            <span style="font-weight:600;color:#92400E">Restart pending.</span>
            Setup failed at boot, but <span class="mono">localFolder</span> now points at a real clone — repositories.json has been corrected since. It is read once at startup, so restart the backend to pick this up.
          </div>
        </div></div>`;
    } else if (setup && setup.status === 'pending') {
      setupBanner = `<div class="card" style="margin-bottom:14px"><div class="card-pad" style="display:flex;gap:9px;align-items:flex-start">
          <span style="color:var(--ink-500)">${icon('clock', 16)}</span>
          <div style="font-size:12.5px;color:var(--ink-600,#475569)">The initial clone for this repository is still running. Analytics will fill in once it finishes.</div>
        </div></div>`;
    }

    const tiles = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:16px">
      ${tile(onOff(cfg.synchronization && cfg.synchronization.fetch), 'Auto-fetch', 'download')}
      ${tile(onOff(cfg.synchronization && cfg.synchronization.commit), 'Auto-commit', 'upload')}
      ${tile(fmtSeconds(cfg.synchronization && cfg.synchronization.interval), 'Sync interval', 'clock')}
      ${tile(escapeHtml(d.branch || git.current || '—'), 'Branch', 'branch')}
      ${tile(git.ahead != null ? git.ahead : '—', 'Ahead', 'arrowUp', (git.ahead > 0) ? 'var(--gold-700)' : 'var(--ink-900)')}
      ${tile(git.behind != null ? git.behind : '—', 'Behind', 'arrowDown', (git.behind > 0) ? 'var(--danger-700)' : 'var(--ink-900)')}
      ${tile(changed.length, 'Local changes', 'pencil', changed.length ? 'var(--gold-700)' : 'var(--ink-900)')}
      ${tile(d.pendingCommits != null ? d.pendingCommits : 0, 'Pending commits', 'clock')}
      ${tile(
        fmtBytes(d.store && d.store.totalBytes),
        'Clone size',
        'database',
        null,
        d.shallow === true ? 'Shallow — history dropped' : (d.shallow === false ? 'Full history' : '')
      )}
    </div>`;

    const settingsRow = (label, value) =>
      `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line-100,#eef2f7)"><span style="font-size:12.5px;color:var(--ink-500)">${label}</span><span style="font-size:12.5px;color:var(--ink-900);font-weight:500">${value}</span></div>`;

    const settingsCard = `<div class="card"><div class="card-head"><div class="card-title">${icon('sliders', 15)} Synchronisation settings</div></div>
      <div class="card-pad" style="padding-top:6px">
        ${settingsRow('Auto-fetch', onOff(settings.autoFetch))}
        ${settingsRow('Fetch interval', fmtMs(settings.fetchInterval))}
        ${settingsRow('Auto-commit', onOff(settings.autoCommit))}
        ${settingsRow('Commit interval', fmtMs(settings.commitInterval))}
        ${settingsRow('Commit message', escapeHtml(settings.commitMessage || '—'))}
        ${settingsRow('Conflict threshold', settings.conflictThreshold != null ? settings.conflictThreshold : '—')}
      </div></div>`;

    const workingTree = changed.length
      ? `<div class="card"><div class="card-head"><div class="card-title">${icon('fileText', 15)} Working tree (${changed.length})</div></div>
          <div class="card-pad" style="padding-top:6px;max-height:340px;overflow:auto">
            ${changed.map((f) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line-100,#eef2f7)">
              <span class="mono" style="font-size:12px;color:var(--ink-800);word-break:break-all">${escapeHtml(f.path || '')}</span>
              <span class="tag" title="index / working tree">${escapeHtml(((f.index || ' ') + (f.working_dir || ' ')).trim() || '·')}</span>
            </div>`).join('')}
          </div></div>`
      : `<div class="card"><div class="card-pad" style="display:flex;align-items:center;gap:9px;color:var(--success-700)">
          ${icon('checkCircle', 16)} <span style="font-size:13px;font-weight:500">Working tree clean — no local changes</span>
        </div></div>`;

    const header = `<div class="card" style="margin-bottom:14px"><div class="card-pad">
      <div style="display:flex;align-items:center;gap:11px">
        <div style="width:42px;height:42px;border-radius:10px;background:var(--gold-50);color:var(--gold-700);display:flex;align-items:center;justify-content:center">${icon('git', 20)}</div>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:15px;color:var(--ink-900)">${escapeHtml(cfg.name || d.instanceName)}</div>
          <div class="mono" style="font-size:11.5px;color:var(--ink-500);word-break:break-all">${escapeHtml(cfg.repository || '')}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--ink-500);margin-top:9px;display:flex;align-items:center;gap:6px">${icon('folder', 13)} <span style="word-break:break-all">${escapeHtml(cfg.localFolder || '')}</span></div>
    </div></div>`;

    return `
      <button class="btn btn-ghost btn-sm" data-action="nav" data-screen="repositories" style="margin-bottom:14px">
        ${icon('chevronLeft', 13)} Back to repositories
      </button>
      ${header}
      ${setupBanner}
      ${inactive}
      ${collisionBanner}
      ${lockBanner}
      ${errorBanner}
      ${tiles}
      <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:14px;align-items:start">
        ${settingsCard}
        ${workingTree}
      </div>`;
  }

  /* ---------- sync button ----------
     Keyed by syncActions.join(',') — the server emits them in execution order
     (commit before fetch), so these keys are stable. */
  const SYNC_PLANS = {
    'commit,fetch': { label: 'Sync now', ico: 'zap', hint: 'Commit and push local changes, then fetch from the remote' },
    'commit':       { label: 'Commit & push', ico: 'upload', hint: 'Stage, commit and push local changes to the remote' },
    'fetch':        { label: 'Fetch now', ico: 'download', hint: 'Fetch from the remote and pull when behind' },
  };

  function paintSyncButton(root, d) {
    const btn = root.querySelector('[data-action="sync"]');
    if (!btn) return;
    const plan = SYNC_PLANS[(d && Array.isArray(d.syncActions) ? d.syncActions : []).join(',')];
    const registered = !!(d && d.registered);
    const permitted = !!(d && d.canSync);
    // Sync and compaction share one exclusion lock server-side, so offering sync
    // during a compaction would only produce a 409.
    const compacting = !!(d && d.compact && d.compact.running);

    if (!plan || !registered || !permitted || compacting) {
      btn.disabled = true;
      btn.title = !registered
        ? 'This repository is not registered as a live filer — restart the backend.'
        : !plan
          ? 'Synchronisation is not configured for this repository (synchronization.fetch / .commit are both off).'
          : !permitted
            ? 'Administrator access is required to synchronise a repository.'
            : 'A compaction is running — sync again when it finishes.';
      btn.innerHTML = `${icon('zap', 13)} Sync now`;
      return;
    }
    btn.disabled = false;
    btn.title = plan.hint;
    btn.innerHTML = `${icon(plan.ico, 13)} ${plan.label}`;
  }

  /* What the sync actually did — reported per action, so "nothing to commit" and
     "committed 2 files" are distinguishable rather than both reading "Synced". */
  function syncSummary(r) {
    if (!r) return 'Synchronisation finished.';
    const parts = [];
    const c = r.commit;
    if (c) {
      if (c.committed) parts.push(`committed ${c.files} file${c.files === 1 ? '' : 's'} and pushed`);
      else if (c.pushed) parts.push(`pushed ${c.ahead} pending commit${c.ahead === 1 ? '' : 's'}`);
      else parts.push('nothing to commit');
    }
    const f = r.fetch;
    if (f) parts.push(f.pulled ? 'pulled remote changes' : 'already up to date with the remote');
    if (!parts.length) return 'Synchronisation finished.';
    return parts.join('; ').replace(/^./, (ch) => ch.toUpperCase()) + '.';
  }

  async function runSync(root, state) {
    const instance = ((state && state.params) || {}).instance;
    const btn = root.querySelector('[data-action="sync"]');
    if (!instance || !btn || btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Syncing…`;
    // All three operations take the same server-side lock; disable the others too
    // rather than let them click through into a 409. rerenderScreen() restores them.
    ['compact', 'reset'].forEach((a) => {
      const other = root.querySelector(`[data-action="${a}"]`);
      if (other) other.disabled = true;
    });
    try {
      const result = await api.post(`/api/repositories/${encodeURIComponent(instance)}/sync`, {});
      toast(syncSummary(result), 'success');
    } catch (err) {
      toast((err && err.message) || 'Synchronisation failed', 'danger');
    } finally {
      // Repaint from the server either way: a failed push can still have left a
      // new local commit, so the tiles are stale whichever way this went.
      rerenderScreen();
    }
  }

  /* ---------- compaction ----------
     Drops history from THIS host's clone (shallow fetch + reflog expire + gc).
     The remote is untouched, so this needs no coordination and no confirmation
     beyond the click — unlike a history rewrite, it is reversible with
     `git fetch --unshallow`. It does take minutes, so the POST answers 202 and
     the job is polled. */
  const COMPACT_POLL_MS = 2500;
  let compactPoll = null;

  function stopCompactPoll() {
    if (compactPoll) { clearInterval(compactPoll); compactPoll = null; }
  }

  function paintCompactButton(root, d) {
    const btn = root.querySelector('[data-action="compact"]');
    if (!btn) return;
    const running = !!(d && d.compact && d.compact.running);
    const permitted = !!(d && d.canSync);
    const registered = !!(d && d.registered);

    if (running) {
      btn.disabled = true;
      btn.title = 'Compaction in progress.';
      btn.innerHTML = `<span class="spinner"></span> Compacting…`;
      return;
    }
    btn.disabled = !permitted || !registered;
    btn.title = !registered
      ? 'This repository is not registered as a live filer — restart the backend.'
      : !permitted
        ? 'Administrator access is required to compact a repository.'
        : 'Drop history from this host\'s clone. The remote is not changed.';
    btn.innerHTML = `${icon('database', 13)} Compact`;
  }

  function compactSummary(job) {
    if (!job) return 'Compaction finished.';
    if (job.error) return job.error;
    const r = job.result;
    if (!r) return 'Compaction finished.';
    if (r.reclaimedBytes <= 0) {
      return r.wasShallow
        ? 'Already compact — nothing left to reclaim.'
        : 'Compaction finished; nothing was reclaimable.';
    }
    return `Reclaimed ${fmtBytes(r.reclaimedBytes)} — ${fmtBytes(r.before.totalBytes)} → `
      + `${fmtBytes(r.after.totalBytes)}, ${r.commitsBefore} → ${r.commitsAfter} commits.`;
  }

  /* Poll the job until it finishes, then repaint the screen from the server. */
  function watchCompact(root, state) {
    const instance = ((state && state.params) || {}).instance;
    if (!instance) return;
    stopCompactPoll();
    compactPoll = setInterval(async () => {
      // The screen may have been navigated away from mid-run.
      if (!document.body.contains(root)) { stopCompactPoll(); return; }
      let job;
      try {
        job = await api.get(`/api/repositories/${encodeURIComponent(instance)}/compact`);
      } catch (_) {
        return; // transient; keep polling
      }
      if (job && job.running) return;
      stopCompactPoll();
      toast(compactSummary(job), job && job.error ? 'danger' : 'success');
      rerenderScreen();
    }, COMPACT_POLL_MS);
  }

  async function runCompact(root, state) {
    const instance = ((state && state.params) || {}).instance;
    const btn = root.querySelector('[data-action="compact"]');
    if (!instance || !btn || btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Compacting…`;
    ['sync', 'reset'].forEach((a) => {
      const other = root.querySelector(`[data-action="${a}"]`);
      if (other) other.disabled = true;
    });
    try {
      await api.post(`/api/repositories/${encodeURIComponent(instance)}/compact`, {});
      toast('Compaction started — this can take a few minutes on a large repository.', 'info');
      watchCompact(root, state);
    } catch (err) {
      toast((err && err.message) || 'Could not start compaction', 'danger');
      rerenderScreen();
    }
  }

  /* ---------- reset to remote ----------
     fetch → reset --hard origin/<branch> → clean -fd. Unlike Sync (which merges)
     and Compact (which only drops history), this DESTROYS local content: every
     uncommitted change, every unpushed commit, every untracked file. The remote is
     untouched, so nothing is at risk beyond this host — which is the whole reason
     it can be a button — but nothing here is undoable from the UI either, so the
     click is confirmed against the numbers the screen is already showing rather
     than against a generic "are you sure". */
  function paintResetButton(root, d) {
    const btn = root.querySelector('[data-action="reset"]');
    if (!btn) return;
    const registered = !!(d && d.registered);
    const permitted = !!(d && d.canReset);
    // Reset, sync and compaction share one server-side exclusion lock.
    const compacting = !!(d && d.compact && d.compact.running);

    btn.disabled = !registered || !permitted || compacting;
    btn.title = !registered
      ? 'This repository is not registered as a live filer — restart the backend.'
      : !permitted
        ? 'Administrator access is required to reset a repository.'
        : compacting
          ? 'A compaction is running — reset again when it finishes.'
          : `Discard all local changes and commits and match ${d.branch || 'the remote branch'}. `
            + 'The remote is not changed.';
    btn.innerHTML = `${icon('history', 13)} Reset to remote`;
  }

  /* Spell out what this specific clone is about to lose, from the analytics
     already on screen. "Are you sure?" with no numbers is what gets clicked
     through; "3 unpushed commits" is what stops the wrong person. */
  function resetConfirmed(d, fallbackName) {
    const cfg = (d && d.config) || {};
    const git = (d && d.git) || {};
    const name = cfg.name || (d && d.instanceName) || fallbackName || 'this repository';
    const branch = (d && d.branch) || cfg.branch || 'main';
    const ahead = Number(git.ahead) || 0;
    const changed = Array.isArray(git.files) ? git.files.length : 0;

    const losses = [
      ahead ? `• ${ahead} local commit${ahead === 1 ? '' : 's'} that ${ahead === 1 ? 'is' : 'are'} not on the remote` : null,
      changed ? `• ${changed} changed file${changed === 1 ? '' : 's'} in the working tree` : null,
      '• every untracked file and folder (git clean -fd)'
    ].filter(Boolean).join('\n');

    if (!confirm(
      `Reset "${name}" to origin/${branch}?\n\n`
      + `This host's clone will be made identical to the remote. Discarded:\n${losses}\n\n`
      + 'Files ignored by .gitignore are kept, and the remote is NOT changed.'
    )) return false;

    // A second ask ONLY when unpushed commits exist — that is the one loss the
    // remote cannot give back, and the one case where the honest answer may be
    // "sync first" instead.
    if (ahead > 0 && !confirm(
      `"${name}" has ${ahead} commit${ahead === 1 ? '' : 's'} that ${ahead === 1 ? 'has' : 'have'} never `
      + 'been pushed. Resetting deletes them.\n\nSync first to keep them. Continue with the reset anyway?'
    )) return false;

    return true;
  }

  /* What the reset actually did, so an unnecessary one is visible as such. */
  function resetSummary(r) {
    if (!r) return 'Reset finished.';
    if (!r.moved && !r.discardedCommitCount && !r.discardedFiles && !r.removedCount) {
      return `Already identical to ${r.target} — nothing to discard.`;
    }
    const parts = [];
    if (r.discardedCommitCount) {
      parts.push(`dropped ${r.discardedCommitCount} local commit${r.discardedCommitCount === 1 ? '' : 's'}`);
    }
    // Only count files that actually ENDED UP reverted. A case collision leaves
    // the same file modified after the reset wrote it, and claiming it was
    // reverted is precisely the false success this summary exists to avoid.
    const reverted = Math.max(0, (r.discardedFiles || 0) - (r.residualDirty || 0));
    if (reverted) {
      parts.push(`reverted ${reverted} changed file${reverted === 1 ? '' : 's'}`);
    }
    if (r.removedCount) {
      parts.push(`removed ${r.removedCount} untracked entr${r.removedCount === 1 ? 'y' : 'ies'}`);
    }
    const head = r.after && r.after.head ? ` Now at ${String(r.after.head).slice(0, 8)}.` : '';
    const drift = r.branchMismatch
      ? ` Note: this clone is checked out on "${r.checkedOutBranch}", not "${r.branch}".`
      : '';
    /* The reset ran, and files are STILL modified. Saying only "reset done" here
       is what makes a correct reset look broken — the residue has its own cause
       and its own fix, both of which are in the banner the repaint puts up. */
    const stuck = (r.caseCollisions && r.caseCollisions.stuck)
      ? ` ${r.residualDirty} file(s) are still modified: ${r.caseCollisions.stuck} path(s) differ only in `
        + 'case, which this filesystem cannot represent — see the warning on the page.'
      : (r.residualDirty
        ? ` ${r.residualDirty} file(s) were modified again immediately — something is writing to this clone.`
        : '');
    return `Reset to ${r.target}${parts.length ? ` — ${parts.join(', ')}` : ''}.${head}${drift}${stuck}`;
  }

  async function runReset(root, state) {
    const params = (state && state.params) || {};
    const instance = params.instance;
    const btn = root.querySelector('[data-action="reset"]');
    if (!instance || !btn || btn.disabled) return;
    // `local.analytics` is module-level and outlives a navigation, so it is used
    // for the confirm text ONLY when it describes this repository — quoting
    // another one's commit count in a destructive prompt is worse than quoting
    // none.
    const loaded = (local.analytics && local.analytics.instanceName === instance)
      ? local.analytics
      : null;
    if (!resetConfirmed(loaded, params.name)) return;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Resetting…`;
    // One server-side lock covers all three; disable the rivals rather than let
    // them click through into a 409. rerenderScreen() restores them.
    ['sync', 'compact'].forEach((a) => {
      const other = root.querySelector(`[data-action="${a}"]`);
      if (other) other.disabled = true;
    });
    try {
      const result = await api.post(`/api/repositories/${encodeURIComponent(instance)}/reset`, { confirm: true });
      toast(resetSummary(result), 'success');
    } catch (err) {
      toast((err && err.message) || 'Reset failed', 'danger');
    } finally {
      // Repaint from the server either way — a reset that failed part-way through
      // still moved the tree, so every tile on this screen is now a guess.
      rerenderScreen();
    }
  }

  function analyticsHtml() {
    const actions =
      `<button class="btn btn-primary btn-sm" data-action="sync" disabled>${icon('zap', 13)} Sync now</button>
       <button class="btn btn-sm" data-action="compact" disabled>${icon('database', 13)} Compact</button>
       <button class="btn btn-danger btn-sm" data-action="reset" disabled>${icon('history', 13)} Reset to remote</button>
       <button class="btn btn-sm" data-action="refresh">${icon('refresh', 13)} Refresh</button>`;
    return `${pageHead('repository', actions)}<div data-region="body"></div>`;
  }

  function analyticsInit(root, state) {
    const params = (state && state.params) || {};
    const instance = params.instance;
    if (!instance) {
      root.querySelector('[data-region="body"]').innerHTML =
        `<div class="card"><div class="empty-state"><div class="ico">${icon('alertCircle', 22)}</div>
        <div style="font-size:14px;font-weight:600">No repository selected</div>
        <button class="btn btn-sm" data-action="nav" data-screen="repositories" style="margin-top:12px">Back to repositories</button></div></div>`;
      return;
    }
    // A rerender replaces the DOM this screen's poller was watching.
    stopCompactPoll();
    // Reflect the selected repo name in the page title crumb.
    window.DS.util.loadRegion(root, async () => {
      local.analytics = await api.get(`/api/repositories/${encodeURIComponent(instance)}`);
      return local.analytics;
    }, (d) => analyticsBody(d || {}), {
      onRendered: (d) => {
        paintSyncButton(root, d);
        paintCompactButton(root, d);
        paintResetButton(root, d);
        // A compaction started before this page was opened (or by someone else)
        // is still worth following to its result.
        if (d && d.compact && d.compact.running) watchCompact(root, state);
      }
    });
  }

  function analyticsHandle(action, el, e, state) {
    if (action === 'retry' || action === 'refresh') return rerenderScreen();
    const root = el.closest('.kr-ds');
    if (!root) return;
    if (action === 'sync') return runSync(root, state);
    if (action === 'compact') return runCompact(root, state);
    if (action === 'reset') return runReset(root, state);
  }

  /* ---------- register ---------- */
  window.Router.register('repositories', { html: listHtml, init: listInit, handle: listHandle }, {
    title: 'Repositories',
    sub: 'Git-backed filers synchronised by the platform.',
    crumb: ['Knowledge', 'Repositories'],
  });

  window.Router.register('repository', { html: analyticsHtml, init: analyticsInit, handle: analyticsHandle }, {
    title: 'Repository analytics',
    sub: 'Live sync status for this filer.',
    crumb: ['Knowledge', 'Repositories', 'Analytics'],
  });
})();
