'use strict';

/**
 * Space brand theming — `public/js/theme.js`.
 *
 * A space brands the wiki through a `theme` block in spaces.json:
 *
 *     "theme": { "title": …, "subtitle": …, "image": …,
 *                "color": "#0b182e", "color-highlight": "#edf0f5",
 *                "home": ".retail.md" }
 *
 * The author signs off TWO colours; the other six ramp steps are derived here.
 * That derivation is the part worth testing — it is pure maths with no visible
 * error mode short of "the app looks wrong", and every button, link, topbar
 * gradient and active state in the wiki is painted from its output.
 *
 * theme.js is a classic browser <script> (deliberately: it must run
 * synchronously in <head>, before the stylesheets, or the previous brand's
 * colour flashes), so it is evaluated in a `vm` with the browser globals it
 * touches — the same approach as landingBlocks.test.js.
 *
 * `home` is NOT read by theme.js; the landing page it names is resolved by
 * app.spaceHomeCandidates().
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '../../..');
const THEME_JS = path.join(REPO, 'public/js/theme.js');
const SOURCE = fs.readFileSync(THEME_JS, 'utf8');

const RAMP_STEPS = [900, 800, 700, 600, 500, 400, 100, 50];

/* ------------------------------------------------------------------ *
 * A DOM stub with just the surface theme.js touches.
 * ------------------------------------------------------------------ */

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.textContent = '';
    this.childNodes = [];
    this.attributes = {};
    this.classes = new Set();
    this.listeners = {};
    // `<img>.complete` is false until the file has loaded. theme.js reads it to
    // decide whether swapping the logo needs a placeholder at all, so the stub
    // has to model the pessimistic case — that is the one with behaviour.
    this.complete = false;
    this.naturalWidth = 0;
    this.style = {
      props: {},
      setProperty: (name, value) => { this.style.props[name] = value; }
    };
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      toggle: (c, on) => { if (on) this.classes.add(c); else this.classes.delete(c); },
      contains: (c) => this.classes.has(c)
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return this.attributes[name] !== undefined; }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter((h) => h !== handler);
  }
  /** Fire a listener the way the browser would, for the load/error placeholder. */
  dispatch(type) {
    (this.listeners[type] || []).slice().forEach((h) => h.call(this, { type }));
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore(child) { child.parentNode = this; this.childNodes.unshift(child); return child; }
  removeChild(child) {
    child.parentNode = null;
    this.childNodes = this.childNodes.filter((n) => n !== child);
    return child;
  }
}

/**
 * Build a context with the topbar brand block already in the shape index.html
 * ships (title span + subtitle <small>), so theme.js finds it rather than
 * performing its wrap-the-loose-text-node fallback.
 */
function makeContext({ pathname = '/applications/wiki/', store = {} } = {}) {
  const brandTitle = new FakeElement('span');
  brandTitle.textContent = 'noobly';
  const brandSubtitle = new FakeElement('small');
  brandSubtitle.textContent = 'Wiki';

  const brandName = new FakeElement('div');
  brandName.querySelector = (selector) => {
    if (selector.includes('kr-brand-title')) return brandTitle;
    if (selector.includes('kr-brand-subtitle') || selector === 'small') return brandSubtitle;
    return null;
  };

  const brandLogo = new FakeElement('img');
  brandLogo.setAttribute('src', '/images/noobly-logo-colour.png');
  brandLogo.setAttribute('alt', 'noobly Wiki');

  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const styles = [];

  const byId = { brandName, brandLogo };

  const localStorage = {
    data: Object.assign({}, store),
    getItem(k) { return this.data[k] === undefined ? null : this.data[k]; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  };

  const ctx = {
    console,
    document: {
      readyState: 'complete',
      title: 'noobly Wiki',
      documentElement,
      head,
      // The generated stylesheet is looked up by id on every apply, so it has
      // to be findable once appended — otherwise a stub would silently model
      // "a fresh <style> per space switch" and hide a leak.
      getElementById: (id) => byId[id] || head.childNodes.find((n) => n.id === id) || null,
      querySelector: () => null,
      createElement: (tag) => {
        const el = new FakeElement(tag);
        if (tag === 'style') styles.push(el);
        return el;
      },
      addEventListener: () => {}
    },
    // Loading a probe image never resolves here, so the aspect-ratio sniff
    // stays pending — which is the honest state on a first-ever visit.
    Image: function FakeImage() { this.onload = null; this.naturalWidth = 0; this.naturalHeight = 0; },
    window: { location: { pathname } }
  };
  ctx.window.localStorage = localStorage;
  ctx.localStorage = localStorage;
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'theme.js' });

  return {
    ctx,
    KRTheme: ctx.window.KRTheme,
    localStorage,
    documentElement,
    brandTitle,
    brandSubtitle,
    brandLogo,
    head,
    styleFor: () => {
      // The derived stylesheet is created once and reused; it is only in the
      // head while a custom theme is in force.
      const live = head.childNodes.filter((n) => n.tagName === 'style');
      return live.length ? live[live.length - 1] : null;
    }
  };
}

/** '#rrggbb' → relative luminance-ish lightness, matching the HSL the code uses. */
function lightness(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

function hue(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h / 6) * 360;
}

const RETAIL = {
  name: 'Retail Collaboration Space',
  theme: {
    title: 'Retail Collaboration Wiki',
    subtitle: 'Wiki',
    image: '/images/retail-logo.png',
    color: '#0b182e',
    'color-highlight': '#edf0f5',
    home: '.retail.md'
  }
};

describe('inline theme → accent ramp', () => {
  test('the two authored colours land on their ramp steps unchanged', () => {
    const { KRTheme } = makeContext();
    KRTheme.applyForSpace(RETAIL);
    const accent = KRTheme.currentTheme().accent;

    // 600 is the primary — buttons, links, active states.
    expect(accent[600].toLowerCase()).toBe('#0b182e');
    // 100 is the light tint — hover fills, soft panels.
    expect(accent[100].toLowerCase()).toBe('#edf0f5');
  });

  test('the ramp is ordered dark → light at every step', () => {
    const { KRTheme } = makeContext();
    KRTheme.applyForSpace(RETAIL);
    const accent = KRTheme.currentTheme().accent;

    // The topbar gradient is 800 → 700 and white text sits on it, so an
    // out-of-order ramp is not a subtle problem.
    const lights = RAMP_STEPS.map((step) => lightness(accent[step]));
    for (let i = 1; i < lights.length; i++) {
      expect(lights[i]).toBeGreaterThan(lights[i - 1]);
    }
  });

  test('derived steps keep the brand hue rather than drifting toward grey', () => {
    const { KRTheme } = makeContext();
    KRTheme.applyForSpace(RETAIL);
    const accent = KRTheme.currentTheme().accent;

    // Lightness is scaled in HSL precisely so hue survives; blending toward the
    // highlight instead would desaturate the mid steps and stop the brand
    // looking like itself. The tolerance is a few degrees rather than zero
    // because the darkest steps quantise hard — 900 lands on rgb(4,10,18),
    // where one 8-bit channel step is already a visible slice of the hue wheel.
    const base = hue(accent[600]);
    for (const step of [900, 800, 700, 500, 400]) {
      expect(Math.abs(hue(accent[step]) - base)).toBeLessThan(6);
    }
  });

  test('a theme with no highlight still gets a coherent light end', () => {
    const { KRTheme } = makeContext();
    KRTheme.apply({ title: 'No Highlight', color: '#0e5c5c' }, 'X');
    const accent = KRTheme.currentTheme().accent;

    expect(accent[600].toLowerCase()).toBe('#0e5c5c');
    expect(lightness(accent[100])).toBeGreaterThan(lightness(accent[400]));
    expect(lightness(accent[50])).toBeGreaterThan(lightness(accent[100]));
  });

  test('the ramp is written as inline custom properties on <html>', () => {
    const { KRTheme, documentElement } = makeContext();
    KRTheme.applyForSpace(RETAIL);

    // Inline on <html> beats the `:root` block in kr-base.css AND wiki.css no
    // matter which order the stylesheets load in.
    for (const step of RAMP_STEPS) {
      expect(documentElement.style.props['--kr-teal-' + step]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(documentElement.style.props['--kr-teal-600'].toLowerCase()).toBe('#0b182e');
  });
});

describe('unusable themes fall back rather than half-brand', () => {
  test.each([
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['unknown preset', 'nope'],
    ['object with no colour', { title: 'X', subtitle: 'Y' }],
    ['object with an unparseable colour', { title: 'X', color: 'not-a-colour' }]
  ])('%s → the default brand', (_label, value) => {
    const { KRTheme } = makeContext();
    expect(KRTheme.apply(value, 'Some Space')).toBe('noobly');
  });

  test('a named preset still resolves', () => {
    const { KRTheme } = makeContext();
    expect(KRTheme.apply('noobly', 'X')).toBe('noobly');
    expect(KRTheme.currentTheme().accent[600].toLowerCase()).toBe('#0f7a78');
    expect(KRTheme.currentTheme().custom).toBe(false);
  });

  test('a preset name that no longer exists falls back to the default', () => {
    const { KRTheme } = makeContext();
    // A retired preset (e.g. an old brand removed from THEMES): a space still naming it must render in the
    // default brand, not half-branded.
    expect(KRTheme.apply('retired-brand', 'X')).toBe('noobly');
  });
});

describe('brand text', () => {
  test('title and subtitle come from the theme; the tab follows the title', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);

    expect(t.brandTitle.textContent).toBe('Retail Collaboration Wiki');
    expect(t.brandSubtitle.textContent).toBe('Wiki');
    expect(t.ctx.document.title).toBe('Retail Collaboration Wiki');
    // 29 characters does not fit the 264px brand column at the stock size.
    expect(t.brandTitle.classes.has('is-long')).toBe(true);
  });

  test('a space with no theme reverts to the stock wordmark and text', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);
    t.KRTheme.applyForSpace({ name: 'Unbranded Space' });

    expect(t.KRTheme.current()).toBe('noobly');
    expect(t.brandTitle.textContent).toBe('noobly');
    expect(t.brandSubtitle.textContent).toBe('Wiki');
    expect(t.ctx.document.title).toBe('noobly Wiki');
    expect(t.brandLogo.getAttribute('src')).toBe('/images/noobly-logo-colour.png');
  });

  test('an explicit wideLogo skips the sniff and hides the text beside it', () => {
    const t = makeContext();
    const space = {
      name: 'Wordmark Space',
      theme: Object.assign({}, RETAIL.theme, { wideLogo: true })
    };
    t.KRTheme.applyForSpace(space);

    expect(t.brandLogo.classes.has('is-wide')).toBe(true);
    // kr-base.css hides `.kr-brand .name` off this flag — a wordmark fills the
    // column on its own, and the title lives in the browser tab instead.
    expect(t.documentElement.hasAttribute('data-brand-wordmark')).toBe(true);
  });
});

describe('designed surfaces the ramp alone does not reach', () => {
  test('a custom theme generates its landing/presentation overrides', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);
    const css = t.styleFor().textContent;

    // `.kr-landing` carries its own palette, so the ramp does not reach it —
    // kr-base.css hard-codes this for the presets, and it is generated here for
    // an inline theme. Without it a branded space's landing page stays teal.
    expect(css).toContain('.kr-landing');
    expect(css).toContain('--krl-teal: #0b182e');
    expect(css).toContain('.kr-present');
    // Scoped to this theme's key so it cannot leak into another space.
    expect(css).toContain('html[data-theme="retail-collaboration-wiki"]');
  });

  test('two spaces sharing a palette still get distinct scopes', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace({
      name: 'Fintech Collaboration Space',
      theme: { title: 'Fintech Wiki', color: '#0e5c5c', 'color-highlight': '#daf0ef' }
    });
    const first = t.documentElement.getAttribute('data-theme');

    t.KRTheme.applyForSpace({
      name: 'People Collaboration Space',
      theme: { title: 'People Wiki', color: '#0e5c5c', 'color-highlight': '#daf0ef' }
    });
    const second = t.documentElement.getAttribute('data-theme');

    expect(first).toBe('fintech-wiki');
    expect(second).toBe('people-wiki');
  });

  test('switching to a preset drops the generated stylesheet', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);
    expect(t.styleFor()).not.toBeNull();

    t.KRTheme.apply('noobly', 'X');
    expect(t.styleFor()).toBeNull();
  });
});

describe('the boot guess', () => {
  test('a selected space is remembered whole, and repainted before first paint', () => {
    const first = makeContext();
    first.KRTheme.applyForSpace(RETAIL);

    // A later visit lands directly on the space URL. Spaces arrive over the
    // network long after first paint, so without this the branded space would
    // flash the default teal on every single load.
    const revisit = makeContext({
      pathname: '/applications/wiki/Retail%20Collaboration%20Space/',
      store: first.localStorage.data
    });

    expect(revisit.KRTheme.current()).toBe('retail-collaboration-wiki');
    expect(revisit.KRTheme.currentTheme().accent[600].toLowerCase()).toBe('#0b182e');
    expect(revisit.brandTitle.textContent).toBe('Retail Collaboration Wiki');
  });

  test('a URL space with no remembered brand paints the default, not the last one', () => {
    const first = makeContext();
    first.KRTheme.applyForSpace(RETAIL);

    const other = makeContext({
      pathname: '/applications/wiki/Some%20Other%20Space/',
      store: first.localStorage.data
    });

    // Carrying the previous space's navy into an unknown space is a visible
    // mis-paint, and worse than one frame of the default.
    expect(other.KRTheme.current()).toBe('noobly');
  });

  test('the bare app URL falls back to the last brand used on this device', () => {
    const first = makeContext();
    first.KRTheme.applyForSpace(RETAIL);

    // `/applications/wiki/` names no space; the app auto-selects the one it
    // used last, so that is the best guess available.
    const bare = makeContext({ pathname: '/applications/wiki/', store: first.localStorage.data });
    expect(bare.KRTheme.current()).toBe('retail-collaboration-wiki');
  });
});

/* ------------------------------------------------------------------ *
 * The brand placeholder.
 *
 * Two ways the topbar can claim a space it is not (yet) showing:
 *
 *   1. A LOGO SWAP. Assigning `img.src` does not clear the picture already on
 *      screen — the browser keeps painting the old one until the new file
 *      decodes. On a space switch that puts the PREVIOUS space's mark beside
 *      the NEW space's name for the length of the fetch.
 *   2. AN UNCONFIRMED BOOT GUESS. `/applications/wiki/` names no space, so the
 *      accent ramp is pre-painted from the last space used. Worth doing (the
 *      alternative is a flash of default teal), but the app may auto-select a
 *      different space a moment later, so the identity must not be asserted.
 * ------------------------------------------------------------------ */

describe('brand placeholder', () => {
  const pending = (t) => t.documentElement.hasAttribute('data-brand-pending');
  const loading = (t) => t.documentElement.hasAttribute('data-brand-loading');

  test('swapping to a different logo hides it until the new file loads', () => {
    const t = makeContext();

    t.KRTheme.applyForSpace(RETAIL);

    expect(t.brandLogo.getAttribute('src')).toBe(RETAIL.theme.image);
    expect(loading(t)).toBe(true);

    t.brandLogo.dispatch('load');
    expect(loading(t)).toBe(false);
  });

  test('a logo that fails to load still clears the placeholder', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);
    expect(loading(t)).toBe(true);

    // Otherwise a broken image URL leaves the header shimmering forever.
    t.brandLogo.dispatch('error');
    expect(loading(t)).toBe(false);
  });

  test('a load that resolves after ANOTHER swap does not clear the new one', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);
    const staleLoad = t.brandLogo.listeners.load[0];

    // Second switch while the first image was still in flight.
    t.KRTheme.applyForSpace({ name: 'Other', theme: { title: 'Other', color: '#334455', image: '/images/other.png' } });
    expect(loading(t)).toBe(true);

    staleLoad.call(t.brandLogo, { type: 'load' });
    expect(loading(t)).toBe(true); // still waiting on /images/other.png
  });

  test('re-applying the same space does not flash a placeholder', () => {
    const t = makeContext();
    t.KRTheme.applyForSpace(RETAIL);
    t.brandLogo.dispatch('load');

    t.KRTheme.applyForSpace(RETAIL);

    expect(loading(t)).toBe(false);
  });

  test('an unconfirmed boot guess withholds the identity', () => {
    const first = makeContext();
    first.KRTheme.applyForSpace(RETAIL);

    // Bare URL: the ramp is still painted from the remembered brand...
    const bare = makeContext({ pathname: '/applications/wiki/', store: first.localStorage.data });
    expect(bare.KRTheme.current()).toBe('retail-collaboration-wiki');
    // ...but the header does not assert it, because the app may auto-select
    // somewhere else.
    expect(pending(bare)).toBe(true);
  });

  test('naming the space in the URL is confident, not pending', () => {
    const first = makeContext();
    first.KRTheme.applyForSpace(RETAIL);

    const deep = makeContext({
      pathname: '/applications/wiki/Retail%20Collaboration%20Space/',
      store: first.localStorage.data
    });

    expect(deep.KRTheme.current()).toBe('retail-collaboration-wiki');
    expect(pending(deep)).toBe(false);
  });

  test('selecting a space clears pending EVEN IF the guess was right', () => {
    const first = makeContext();
    first.KRTheme.applyForSpace(RETAIL);

    const bare = makeContext({ pathname: '/applications/wiki/', store: first.localStorage.data });
    expect(pending(bare)).toBe(true);

    // The guess matching means apply() short-circuits on an identical
    // signature and applyDomBits never runs — so applyForSpace has to drop the
    // attribute itself, or the header stays a placeholder forever.
    bare.KRTheme.applyForSpace(RETAIL);
    expect(pending(bare)).toBe(false);
  });
});
