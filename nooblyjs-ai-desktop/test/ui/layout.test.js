'use strict';

// Browser layout checks: every page at phone, tablet and desktop widths.
// Run with `npm run test:ui` (needs `npx playwright install chromium` once).
// Screenshots land in .temp/screenshots/ for a visual once-over.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { useTempDataDir, cleanup } = require('../helpers');

const dir = useTempDataDir();
const { chromium } = require('playwright');
const registry = require('../../src/providers/registry');
const { makeMockProvider } = require('../../scripts/mockProvider');
const { bootstrap } = require('../../src/storage/bootstrap');
const { createApp } = require('../../src/app');

registry.register(makeMockProvider({ delayMs: 0 }));

const SHOTS = path.join(__dirname, '../../.temp/screenshots');
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'desktop', width: 1280, height: 900 }
];

let server;
let base;
let browser;
let project;

async function json(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

test.before(async () => {
  await bootstrap();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });

  // A long name is the worst case for the editable title.
  ({ project } = await json('POST', '/api/projects', {
    name: 'Creating AI Teammates',
    description: 'A concept of AI teammates with personality, memory and knowledge.'
  }));
  const { chat } = await json('POST', `/api/projects/${project.id}/chats`, {});
  await json('POST', `/api/projects/${project.id}/documents/documents`, {
    parent: '',
    name: 'Overview',
    content: '# Overview\n\nHello.'
  });
  project.chatId = chat.id;
});

test.after(async () => {
  await browser?.close();
  server?.close();
  cleanup(dir);
});

/** Elements whose boxes overlap each other, among the visible matches. */
async function overlaps(page, selector) {
  return page.$$eval(selector, (els) => {
    const boxes = els
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r;
        const b = boxes[j].r;
        if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) {
          const name = (el) => el.dataset && Object.keys(el.dataset)[0] || el.className || el.tagName;
          hits.push(`${name(boxes[i].el)} × ${name(boxes[j].el)}`);
        }
      }
    }
    return hits;
  });
}

async function checkPage(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `${label}: page scrolls sideways by ${overflow}px`);

  const escaped = await page.$$eval('button, select, input, textarea, .btn', (els) =>
    els
      .filter((el) => el.offsetParent !== null && !el.closest('.modal'))
      .flatMap((el) => {
        const r = el.getBoundingClientRect();
        const card = el.closest('.card')?.getBoundingClientRect();
        const bounds = card || { left: 0, right: window.innerWidth };
        if (r.width === 0 || (r.left >= bounds.left - 1 && r.right <= bounds.right + 1)) return [];
        const what = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName;
        return [`${what} (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(bounds.left)}–${Math.round(bounds.right)})`];
      })
  );
  assert.deepEqual(escaped, [], `${label}: controls stick out of their card or the screen`);

  const head = await overlaps(page, '.page-head-main, .page-head .btn, .page-head input');
  assert.deepEqual(head, [], `${label}: page header elements overlap`);

  // A select is cut off when its chosen option's text is wider than the room
  // left between its padding (the right padding holds the chevron).
  const cutSelects = await page.$$eval('select', (els) => {
    const ctx = document.createElement('canvas').getContext('2d');
    return els
      .filter((el) => el.offsetParent !== null && !el.closest('.modal'))
      .flatMap((el) => {
        const style = getComputedStyle(el);
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = el.selectedOptions[0]?.textContent.trim() || '';
        const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const need = ctx.measureText(text).width;
        return need > room + 1 ? [`"${text}" needs ${Math.ceil(need)}px, has ${Math.floor(room)}px`] : [];
      });
  });
  assert.deepEqual(cutSelects, [], `${label}: select text is cut off`);

  // Placeholders should be readable in full before anything is typed.
  const cutPlaceholders = await page.$$eval('textarea[placeholder]', (els) =>
    els
      .filter((el) => el.offsetParent !== null && !el.value && !el.closest('.modal'))
      .flatMap((el) => {
        el.value = el.placeholder;
        const need = el.scrollHeight;
        el.value = '';
        return need > el.clientHeight + 1 ? [`"${el.placeholder}" needs ${need}px, has ${el.clientHeight}px`] : [];
      })
  );
  assert.deepEqual(cutPlaceholders, [], `${label}: placeholder text is cut off`);
}

const PAGES = [
  { name: 'projects', url: () => '/' },
  { name: 'project', url: () => `/projects/${project.id}` },
  { name: 'project-chat', url: () => `/projects/${project.id}?chat=${project.chatId}`, wait: '.chat-item.is-open [data-composer]' },
  { name: 'documents', url: () => `/projects/${project.id}/documents` },
  { name: 'settings', url: () => '/settings' }
];

for (const vp of VIEWPORTS) {
  for (const pg of PAGES) {
    test(`${pg.name} lays out cleanly on ${vp.name} (${vp.width}px)`, async () => {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      try {
        await page.goto(base + pg.url(), { waitUntil: 'networkidle' });
        if (pg.wait) await page.waitForSelector(pg.wait);
        await page.screenshot({ path: path.join(SHOTS, `${pg.name}-${vp.name}.png`), fullPage: true });
        await checkPage(page, `${pg.name} @ ${vp.width}px`);
        assert.deepEqual(errors, [], 'no script errors');
      } finally {
        await page.close();
      }
    });
  }

  test(`the project title stays readable on ${vp.name} (${vp.width}px)`, async () => {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    try {
      await page.goto(`${base}/projects/${project.id}`);
      const { visible, full } = await page.$eval('[data-project-name]', (el) => ({
        visible: el.clientWidth,
        full: el.scrollWidth
      }));
      // "Creating AI Teammates" should fit, not collapse to "C…".
      assert.ok(full <= visible + 1, `title is clipped: needs ${full}px, has ${visible}px`);
    } finally {
      await page.close();
    }
  });
}
