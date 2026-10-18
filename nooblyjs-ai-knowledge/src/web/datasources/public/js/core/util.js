/* Shared helpers for datasources screens — formatting, toasts,
   and the async-screen pattern (sync html() + async init()). */
(function () {
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDuration(ms) {
    if (ms === null || ms === undefined || ms === '') return '—';
    const n = Number(ms);
    if (isNaN(n) || n <= 0) return '—';
    if (n < 1000) return n + 'ms';
    if (n < 60000) return (n / 1000).toFixed(2) + 's';
    const m = Math.floor(n / 60000);
    const s = Math.round((n % 60000) / 1000);
    return `${m}m ${s}s`;
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const diff = Date.now() - d.getTime();
    const sec = Math.round(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    return fmtDate(iso);
  }

  /* ---------- Cron ---------- */

  /* describeCron() turns a 5-field cron expression into a short English phrase
     ("Daily at 02:00", "Weekdays at 08:00", "Every 15 minutes"). It answers
     null for anything that does not parse, which is how callers tell a typo
     from an exotic-but-valid expression — every expression that parses gets a
     phrase, even if a mechanical one. Kept here rather than in a screen because
     the phrase is used both to NAME a schedule and to preview one before it is
     created. Deliberately dependency-free: no cron library is loaded by this
     app, and this is presentation only — the scheduler is what actually
     decides when a workflow runs. */

  const CRON_DAY_LONG  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const CRON_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const CRON_DAY_ALIAS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const CRON_MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const CRON_MONTH_ALIAS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* One cron field -> { any, step, values } or null when it does not parse.
     `any` is true only for a bare star — a slash-step field is NOT "every",
     and conflating the two is what makes a 5-minute schedule read as "every
     minute". `values` is null when the field is open (any or a bare step). */
  function cronField(raw, min, max, alias) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    if (text === '*' || text === '?') return { any: true, step: 1, values: null };

    const toNum = (tok) => {
      const key = String(tok).trim().toLowerCase();
      if (alias && Object.prototype.hasOwnProperty.call(alias, key)) return alias[key];
      if (!/^\d+$/.test(key)) return null;
      const n = parseInt(key, 10);
      return n >= min && n <= max ? n : null;
    };

    let body = text;
    let step = 1;
    const slash = text.indexOf('/');
    if (slash !== -1) {
      body = text.slice(0, slash);
      const tail = text.slice(slash + 1);
      if (!/^\d+$/.test(tail)) return null;
      step = parseInt(tail, 10);
      if (step < 1) return null;
    }
    if (body === '*' || body === '?' || body === '') return { any: step === 1, step, values: null };

    const values = [];
    for (const part of body.split(',')) {
      const chunk = part.trim();
      const dash = chunk.indexOf('-', 1);
      if (dash > 0) {
        const from = toNum(chunk.slice(0, dash));
        const to = toNum(chunk.slice(dash + 1));
        if (from === null || to === null || to < from) return null;
        for (let v = from; v <= to; v += step) values.push(v);
      } else {
        const v = toNum(chunk);
        if (v === null) return null;
        values.push(v);
      }
    }
    if (!values.length) return null;
    return { any: false, step, values: values.sort((a, b) => a - b).filter((v, i, a) => i === 0 || v !== a[i - 1]) };
  }

  function cronPad(n) { return String(n).padStart(2, '0'); }

  /* Cap a list so a phrase built for a schedule NAME stays a name. */
  function cronList(items, cap = 3) {
    return items.length > cap ? items.slice(0, cap).join(', ') + '…' : items.join(', ');
  }

  function describeCron(expr) {
    const parts = String(expr == null ? '' : expr).trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const minute = cronField(parts[0], 0, 59);
    const hour = cronField(parts[1], 0, 23);
    const dom = cronField(parts[2], 1, 31);
    const month = cronField(parts[3], 1, 12, CRON_MONTH_ALIAS);
    const dow = cronField(parts[4], 0, 7, CRON_DAY_ALIAS);
    if (!minute || !hour || !dom || !month || !dow) return null;

    // Cron accepts both 0 and 7 for Sunday; collapse so day-set matching works.
    if (dow.values) {
      dow.values = dow.values.map(v => (v === 7 ? 0 : v))
        .sort((a, b) => a - b).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    }

    /* Which days -- '' when the schedule runs every day. dom and dow are OR'd
       by cron when both are restricted, so say "or" rather than implying both
       must hold. */
    const dayBits = [];
    if (dow.values) {
      const set = dow.values.join(',');
      if (set === '1,2,3,4,5') dayBits.push('weekdays');
      else if (set === '0,6') dayBits.push('weekends');
      else if (dow.values.length === 1) dayBits.push(CRON_DAY_LONG[dow.values[0]] + 's');
      else dayBits.push(cronList(dow.values.map(v => CRON_DAY_SHORT[v]), 4));
    } else if (!dow.any) {
      dayBits.push('every ' + dow.step + ' days');
    }
    if (dom.values) {
      dayBits.push(dom.values.length === 1
        ? 'day ' + dom.values[0] + ' of the month'
        : 'days ' + cronList(dom.values.map(String), 4) + ' of the month');
    } else if (!dom.any) {
      dayBits.push('every ' + dom.step + ' days');
    }
    const days = dayBits.join(' or ');

    let months = '';
    if (month.values) {
      months = month.values.length === 1
        ? ' in ' + CRON_MONTH_LONG[month.values[0] - 1]
        : ' in ' + cronList(month.values.map(v => CRON_MONTH_LONG[v - 1].slice(0, 3)), 4);
    } else if (!month.any) {
      months = ' every ' + month.step + ' months';
    }

    /* Which hours, for the sub-hourly phrasings that need to qualify them. */
    const hourPhrase = () => {
      if (hour.any) return '';
      if (!hour.values) return 'every ' + hour.step + ' hours';
      const v = hour.values;
      const contiguous = v.length > 1 && v[v.length - 1] - v[0] === v.length - 1;
      if (contiguous) return cronPad(v[0]) + ':00–' + cronPad(v[v.length - 1]) + ':59';
      return (v.length === 1 ? 'hour ' : 'hours ') + cronList(v.map(cronPad), 4);
    };

    const suffix = (days ? ' on ' + days : '') + months;
    const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Sub-hourly: the minute field is open, so the run frequency leads.
    if (!minute.values) {
      const head = minute.any ? 'every minute' : 'every ' + minute.step + ' minutes';
      const hours = hourPhrase();
      return capitalise(head + (hours ? ' during ' + hours : '') + suffix);
    }

    // A fixed minute, every hour.
    if (hour.any) {
      if (minute.values.length === 1 && minute.values[0] === 0) return capitalise('hourly' + suffix);
      return capitalise('hourly at ' + cronList(minute.values.map(v => ':' + cronPad(v))) + suffix);
    }

    // A fixed minute, every Nth hour.
    if (!hour.values) {
      const at = (minute.values.length === 1 && minute.values[0] === 0)
        ? '' : ' at ' + cronList(minute.values.map(v => ':' + cronPad(v)));
      return capitalise('every ' + hour.step + ' hours' + at + suffix);
    }

    // Fixed times of day -- the common case, and the one that reads best with
    // the day scope in front: "Weekdays at 08:00".
    const times = [];
    for (const h of hour.values) {
      for (const m of minute.values) times.push(cronPad(h) + ':' + cronPad(m));
    }
    return capitalise((days || 'daily') + ' at ' + cronList(times.sort()) + months);
  }

  /* describeCron() reads anything a cron field can hold, because it also has to
     phrase expressions ALREADY on disk. What this app's scheduler will actually
     accept is narrower: both workflowBridge.validateCronExpression and core's
     scheduling/providers/cronExpression.js parse NUMERIC fields only - no
     MON-FRI or JAN names - and day-of-week is 0-6, so Sunday is 0 and a 7 is
     out of range. An expression that reads perfectly well can therefore still
     be refused at creation, so say which before the request goes out.
     Answers null when the expression is acceptable, else the reason. */
  function cronRejection(expr) {
    if (!describeCron(expr)) return 'Not a valid cron expression';
    const text = String(expr).trim();
    if (/[A-Za-z]/.test(text)) return 'This scheduler needs numbers, not names — MON-FRI is 1-5';
    if (/(^|[^\d])7([^\d]|$)/.test(text.split(/\s+/)[4])) return 'Sunday is 0 here, not 7';
    return null;
  }

  /* Lightweight toast — uses the #toast-container already in index.html. */
  function toast(message, type = 'info') {
    let host = document.getElementById('toast-container');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-container';
      host.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      host.style.zIndex = '2100';
      document.body.appendChild(host);
    }
    const colors = {
      success: '#047857', danger: '#B91C1C', error: '#B91C1C',
      warn: '#92400E', info: '#1E293B',
    };
    const el = document.createElement('div');
    el.style.cssText = `margin-top:8px;min-width:240px;max-width:380px;background:${colors[type] || colors.info};
      color:#fff;border-radius:10px;padding:11px 14px;font-size:13px;font-family:var(--font-sans,sans-serif);
      box-shadow:0 16px 32px -12px rgba(15,23,42,.4);opacity:0;transition:opacity .15s`;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, 3600);
  }

  /* Async-screen pattern: render a spinner into [data-region="body"],
     run loader(), then hand the result to render() for the body HTML.
     On failure shows an inline error with a Retry button. */
  function loadRegion(root, loader, render, opts = {}) {
    const region = root.querySelector('[data-region="body"]');
    if (!region) return;
    region.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:48px;justify-content:center;color:var(--ink-500)">
      <span class="spinner"></span> Loading…</div>`;
    Promise.resolve()
      .then(loader)
      .then((data) => { region.innerHTML = render(data); opts.onRendered && opts.onRendered(data, region); })
      .catch((err) => {
        console.error('[screen] load failed:', err);
        region.innerHTML = `<div class="empty-state">
          <div class="ico">${icon('alertTriangle', 22)}</div>
          <div style="font-size:14px;font-weight:600;color:var(--ink-800)">Couldn't load this screen</div>
          <div style="font-size:12.5px;margin:4px 0 14px">${escapeHtml(err && err.message || 'Request failed')}</div>
          <button class="btn btn-sm" data-action="retry">${icon('refresh', 13)} Retry</button>
        </div>`;
      });
  }

  window.DS = window.DS || {};
  window.DS.util = { escapeHtml, fmtDate, fmtDateTime, fmtDuration, timeAgo, describeCron, cronRejection, toast, loadRegion };
})();
