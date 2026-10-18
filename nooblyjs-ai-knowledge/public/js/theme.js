/**
 * Brand theming
 * =============
 * Swaps the accent palette, the topbar wordmark/title and the favicons to match
 * the SPACE the user is in. A space opts into a brand by carrying a `theme` key
 * in `.application/spaces/spaces.json`, in either of two forms.
 *
 * 1. INLINE (preferred) — the brand is DATA, so a new brand needs no code:
 *
 *      "theme": {
 *        "title": "Product Wiki",
 *        "subtitle": "Wiki",
 *        "image": "/images/product-logo.png",
 *        "color": "#0b182e",
 *        "color-highlight": "#edf0f5",
 *        "home": ".product.md"
 *      }
 *
 *    `color` is the PRIMARY (ramp step 600 — buttons, links, active states) and
 *    `color-highlight` the light tint (step 100 — hover fills, soft panels).
 *    The remaining six steps are derived here by scaling lightness in HSL, which
 *    keeps hue and saturation intact so a brand stays recognisably itself at
 *    every step. `title`/`subtitle` drive the topbar text and the browser tab,
 *    `image` the topbar logo and favicon. `home` is NOT read here — it is the
 *    space's landing document, resolved by app.spaceHomeCandidates().
 *
 * 2. NAMED — `"theme": "noobly"` picks a preset out of THEMES below. Kept for
 *    brands that predate the inline form and for the extra polish a preset can
 *    carry (a multi-resolution favicon set). An unknown name falls back to the
 *    default.
 *
 * A space with no `theme` (or an unusable one) renders in the default noobly
 * teal, so switching from a branded space back to an unbranded one reverts. The
 * wiki spaces API returns the whole space record, so nothing extra is needed
 * server-side; `spacesController.selectSpace()` hands the record here via
 * KRTheme.applyForSpace() the moment a space becomes current.
 *
 * Load this as a CLASSIC (synchronous) script in <head>, BEFORE the
 * stylesheets. The accent ramp is written as inline custom properties on
 * <html>, which beat the `:root` block in the app stylesheet no matter what
 * order the CSS loads in, and doing it before first paint avoids a flash of
 * the wrong brand colour. Logo/title/favicon work needs the DOM, so it defers
 * to DOMContentLoaded when the document is still parsing.
 *
 * THE BOOT GUESS. Spaces arrive over the network long after first paint, so at
 * boot we cannot know the real answer yet. We keep a small localStorage map of
 * space name → theme VALUE (the whole inline object, or the preset name),
 * learned every time a space is selected, and the deep-link URL
 * (`/applications/wiki/<Space Name>/…`) tells us which space this load is for —
 * so a return visit paints the right brand immediately. Falls back to the last
 * theme applied on this device (covers `/applications/wiki/` with no space in
 * the URL, where the app auto-selects the space it used last), then to the
 * default. The FIRST ever visit to a branded space still flashes teal for one
 * paint and then corrects itself; every visit after that is clean.
 *
 * @author noobly Team
 * @version 3.0.0
 * @since 2026-07-24
 */
(function () {
    'use strict';

    var MAP_KEY = 'wiki:theme:spaces';   // { "<space name, lowercased>": <theme value> }
    var LAST_KEY = 'wiki:theme:last';    // last theme value actually applied here
    var WIDE_KEY = 'wiki:theme:wordmarks'; // { "<logo src>": true|false }
    var DEFAULT_THEME = 'noobly';
    var DERIVED_STYLE_ID = 'krThemeDerived';
    /** A logo at least this many times wider than tall is a wordmark. */
    var WORDMARK_RATIO = 2;
    /** Titles longer than this get the smaller topbar size so they still fit. */
    var LONG_TITLE_CHARS = 22;

    /**
     * Accent ramps are ordered dark → light. `600` is the primary: it is what
     * buttons, links and active states use, and 800/700 form the topbar
     * gradient, so a theme reads correctly as long as the ramp stays ordered.
     */
    var THEMES = {
        noobly: {
            label: 'noobly',
            accent: {
                900: '#0a3d3d', 800: '#0d4f4f', 700: '#0e6362', 600: '#0f7a78',
                500: '#149e9b', 400: '#2bb8b4', 100: '#d9efee', 50: '#ecf6f5'
            },
            logo: '/images/noobly-logo-colour.png',
            logoAlt: 'noobly Wiki',
            icons: [
                { rel: 'icon', type: 'image/png', href: '/images/noobly-logo-colour.png' }
            ]
        }
    };

    /* ------------------------------------------------------------------ *
     * Colour maths — deriving a full ramp from the two authored colours.
     * ------------------------------------------------------------------ */

    /** `#abc` / `#aabbcc` (with or without the hash) → {r,g,b}, or null. */
    function parseHex(value) {
        var hex = String(value == null ? '' : value).trim().replace(/^#/, '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }

    function clamp(value, min, max) {
        return value < min ? min : (value > max ? max : value);
    }

    function toHex(rgb) {
        var part = function (n) {
            var s = Math.round(clamp(n, 0, 255)).toString(16);
            return s.length === 1 ? '0' + s : s;
        };
        return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
    }

    function rgbToHsl(rgb) {
        var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var l = (max + min) / 2;
        var h = 0, s = 0;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        return { h: h, s: s, l: l };
    }

    function hslToRgb(hsl) {
        var h = hsl.h, s = hsl.s, l = clamp(hsl.l, 0, 1);
        if (s === 0) {
            var v = l * 255;
            return { r: v, g: v, b: v };
        }
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        var channel = function (t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
    }

    /** Same hue/saturation, lightness multiplied — the darker half of the ramp. */
    function scaleLightness(rgb, factor) {
        var hsl = rgbToHsl(rgb);
        hsl.l = clamp(hsl.l * factor, 0, 1);
        return hslToRgb(hsl);
    }

    /** Same hue/saturation, lightness raised by `points` (0–1) — the lighter half. */
    function raiseLightness(rgb, points) {
        var hsl = rgbToHsl(rgb);
        hsl.l = clamp(hsl.l + points, 0, 1);
        return hslToRgb(hsl);
    }

    function mixRgb(a, b, t) {
        return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
    }

    /**
     * The eight-step accent ramp from the two authored colours.
     *
     * 600 is the primary exactly as given and 100 the highlight exactly as
     * given — the two an author can see and sign off. 900/800/700 come from
     * scaling lightness DOWN (a topbar gradient that stays the same colour,
     * just deeper) and 500/400 from raising it, rather than blending toward the
     * highlight: blending desaturates, and a washed-out mid step is exactly
     * where a brand stops looking like itself. 50 is the highlight lifted
     * halfway to white for the faintest surfaces.
     *
     * @param {string} primaryHex   theme `color`
     * @param {string} highlightHex theme `color-highlight` (optional)
     * @return {Object|null} accent map keyed by ramp step, null if unparseable
     */
    function rampFrom(primaryHex, highlightHex) {
        var primary = parseHex(primaryHex);
        if (!primary) return null;

        // No highlight authored → derive a very light tint of the primary so the
        // space still gets a coherent (if unsigned-off) surface colour.
        var highlight = parseHex(highlightHex) || mixRgb(primary, { r: 255, g: 255, b: 255 }, 0.9);

        return {
            900: toHex(scaleLightness(primary, 0.40)),
            800: toHex(scaleLightness(primary, 0.62)),
            700: toHex(scaleLightness(primary, 0.82)),
            600: toHex(primary),
            500: toHex(raiseLightness(primary, 0.09)),
            400: toHex(raiseLightness(primary, 0.19)),
            100: toHex(highlight),
            50: toHex(mixRgb(highlight, { r: 255, g: 255, b: 255 }, 0.55))
        };
    }

    /** `rgba(r, g, b, a)` from a hex string — for the gradients below. */
    function rgba(hex, alpha) {
        var rgb = parseHex(hex) || { r: 0, g: 0, b: 0 };
        return 'rgba(' + Math.round(rgb.r) + ', ' + Math.round(rgb.g) + ', ' + Math.round(rgb.b) + ', ' + alpha + ')';
    }

    /* ------------------------------------------------------------------ *
     * Normalising a `theme` value into one descriptor shape.
     * ------------------------------------------------------------------ */

    /** Safe for use inside a CSS attribute selector and an HTML attribute. */
    function slugify(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
    }

    /**
     * Turn whatever sits under a space's `theme` key into the descriptor the
     * rest of this module works with, or null when it is unusable (unknown
     * preset name, object with no parseable `color`) — the caller then falls
     * back to the default rather than leaving the app half-branded.
     *
     * @param {string|Object} value  the raw `theme` value off the space record
     * @param {string} [spaceName]   used for the CSS key when the theme has no title
     * @return {Object|null}
     */
    function normaliseTheme(value, spaceName) {
        if (!value) return null;

        if (typeof value === 'string') {
            var name = value.trim().toLowerCase();
            if (!THEMES[name]) return null;
            var preset = THEMES[name];
            return {
                key: name,
                custom: false,
                label: preset.label,
                accent: preset.accent,
                logo: preset.logo,
                logoAlt: preset.logoAlt,
                icons: preset.icons
            };
        }

        if (typeof value !== 'object') return null;

        var accent = rampFrom(value.color, value['color-highlight'] || value.colorHighlight);
        if (!accent) return null;   // a theme with no usable colour is not a theme

        var title = typeof value.title === 'string' ? value.title.trim() : '';
        var subtitle = typeof value.subtitle === 'string' ? value.subtitle.trim() : '';
        var image = typeof value.image === 'string' ? value.image.trim() : '';
        var favicon = typeof value.favicon === 'string' ? value.favicon.trim() : image;

        return {
            key: slugify(value.key || title || spaceName) || 'custom',
            custom: true,
            label: title || spaceName || 'Custom',
            title: title,
            subtitle: subtitle,
            accent: accent,
            logo: image,
            logoAlt: title || spaceName || '',
            // A single favicon from the same artwork. A preset can ship a proper
            // multi-resolution set; an inline theme trades that for needing no
            // code to add a brand.
            icons: favicon ? [{ rel: 'icon', href: favicon }] : null,
            // Explicit `true`/`false` overrides the aspect-ratio sniff in applyLogo.
            logoWide: typeof value.wideLogo === 'boolean' ? value.wideLogo : null
        };
    }

    /** Normalise a space name into a stable lookup key. */
    function spaceKey(name) {
        return String(name || '').trim().toLowerCase();
    }

    /**
     * The space name out of `/applications/wiki/<Space Name>/rest/of/path`.
     * Returns '' on the bare app URL, where no space is pinned yet.
     */
    function spaceFromPath() {
        try {
            var BASE = '/applications/wiki/';
            var p = window.location.pathname || '';
            if (p.indexOf(BASE) !== 0) return '';
            var first = p.slice(BASE.length).split('/')[0];
            return first ? decodeURIComponent(first) : '';
        } catch (e) {
            return '';
        }
    }

    /** localStorage is best-effort throughout — private mode must not break theming. */
    function readMap() {
        try {
            var raw = localStorage.getItem(MAP_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Remember the RAW theme value (inline object or preset name) for this
     * space, so the next load of it paints before the spaces API answers. An
     * edited spaces.json therefore takes one visit to show up at boot — the
     * live apply below is immediate either way.
     */
    function remember(spaceName, value) {
        try {
            var serialised = JSON.stringify(value === undefined ? null : value);
            localStorage.setItem(LAST_KEY, serialised);
            var key = spaceKey(spaceName);
            if (!key) return;
            var map = readMap();
            if (JSON.stringify(map[key] === undefined ? null : map[key]) === serialised) return;
            map[key] = value === undefined ? null : value;
            localStorage.setItem(MAP_KEY, JSON.stringify(map));
        } catch (e) { /* private mode */ }
    }

    /**
     * Best guess for this page load, before any space data has arrived: the
     * theme this device last saw for the space named in the URL, else the last
     * theme applied at all, else the default.
     * @return {string|Object|null} a raw theme value
     */
    /**
     * True when the boot theme is an UNCONFIRMED guess — the URL named no
     * space, so we fell back to whichever space was open last. The accent ramp
     * is still worth pre-painting (it is usually right, and the alternative is
     * a flash of default teal), but the IDENTITY is not: the app may auto-select
     * a different space a moment later, and until it does, a confident logo and
     * title claim to be a space we have not actually opened. That is the
     * "header keeps the previous space for a bit" effect. While this is set and
     * unconfirmed, the brand block shows a placeholder instead.
     */
    var bootGuessed = false;
    var brandConfirmed = false;

    function bootTheme() {
        var key = spaceKey(spaceFromPath());
        if (key) {
            var map = readMap();
            // Known URL space with no remembered brand — don't carry the last
            // space's brand into it, that is a visible mis-paint.
            return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : DEFAULT_THEME;
        }
        try {
            var last = localStorage.getItem(LAST_KEY);
            if (last) {
                bootGuessed = true;
                return JSON.parse(last);
            }
        } catch (e) { /* ignore */ }
        return DEFAULT_THEME;
    }

    /* ------------------------------------------------------------------ *
     * Applying a descriptor to the page.
     * ------------------------------------------------------------------ */

    /** Write the accent ramp as inline custom properties on <html>. */
    function applyAccent(theme) {
        var root = document.documentElement;
        var accent = theme.accent || {};
        for (var step in accent) {
            if (Object.prototype.hasOwnProperty.call(accent, step)) {
                root.style.setProperty('--kr-teal-' + step, accent[step]);
            }
        }
    }

    /**
     * The two designed surfaces the accent ramp alone does not reach: landing
     * bands (`.kr-landing`, which carries its own palette and so overrides the
     * ramp) and the presentation backdrop (a fixed gradient). kr-base.css hard-
     * codes these for the PRESET themes; for an inline theme they are generated
     * from its ramp, which is what lets a brand be pure data.
     */
    function applyDerivedCss(theme) {
        var head = document.head || document.getElementsByTagName('head')[0];
        if (!head) return;

        var style = document.getElementById(DERIVED_STYLE_ID);
        if (!theme.custom) {
            if (style) style.parentNode.removeChild(style);
            return;
        }
        if (!style) {
            style = document.createElement('style');
            style.id = DERIVED_STYLE_ID;
            head.appendChild(style);
        }

        var a = theme.accent;
        var scope = 'html[data-theme="' + theme.key + '"]';
        style.textContent = [
            scope + ' .kr-landing {',
            '  --krl-teal: ' + a[600] + ';',
            '  --krl-teal-2: ' + a[500] + ';',
            '  --krl-teal-light: ' + a[400] + ';',
            '  --krl-teal-deep: ' + a[900] + ';',
            '  --krl-teal-soft: ' + a[100] + ';',
            '}',
            scope + ' .kr-present {',
            '  background:',
            '    radial-gradient(1200px 600px at 50% -10%, ' + rgba(a[500], 0.45) + ', transparent 60%),',
            '    linear-gradient(160deg, ' + a[600] + ' 0%, ' + a[800] + ' 55%, ' + a[900] + ' 100%);',
            '}'
        ].join('\n');
    }

    /** Replace every existing icon link with this theme's set. */
    function applyIcons(theme) {
        if (!theme.icons || !theme.icons.length) return;
        var head = document.head || document.getElementsByTagName('head')[0];
        if (!head) return;

        var existing = head.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
        for (var i = 0; i < existing.length; i++) existing[i].parentNode.removeChild(existing[i]);

        theme.icons.forEach(function (icon) {
            var link = document.createElement('link');
            link.setAttribute('rel', icon.rel || 'icon');
            if (icon.type) link.setAttribute('type', icon.type);
            if (icon.sizes) link.setAttribute('sizes', icon.sizes);
            // Cache-bust per theme, otherwise the browser keeps showing the
            // favicon it already has for this origin.
            link.setAttribute('href', icon.href + (icon.href.indexOf('?') === -1 ? '?' : '&') + 't=' + encodeURIComponent(theme.key || ''));
            head.appendChild(link);
        });
    }

    /**
     * The page's unbranded starting point, captured once BEFORE anything is
     * overwritten, so a space with no theme reverts to it rather than keeping
     * the previous space's wordmark.
     */
    var base = null;

    /**
     * The topbar brand text. The stock markup is `<div class="name">Knowledge
     * Repository<small>Wiki</small></div>`; the loose text node is wrapped once
     * so the title can be set without clobbering the <small>.
     * @return {{title: Element, subtitle: Element}|null}
     */
    function brandParts() {
        var name = document.getElementById('brandName') || document.querySelector('.kr-brand .name');
        if (!name) return null;

        var titleEl = name.querySelector('.kr-brand-title');
        if (!titleEl) {
            var text = '';
            var loose = [];
            for (var i = 0; i < name.childNodes.length; i++) {
                var node = name.childNodes[i];
                if (node.nodeType === 3) { text += node.nodeValue; loose.push(node); }
            }
            loose.forEach(function (node) { name.removeChild(node); });
            titleEl = document.createElement('span');
            titleEl.className = 'kr-brand-title';
            titleEl.textContent = text.trim();
            name.insertBefore(titleEl, name.firstChild);
        }

        var subEl = name.querySelector('.kr-brand-subtitle') || name.querySelector('small');
        if (!subEl) {
            subEl = document.createElement('small');
            name.appendChild(subEl);
        }
        subEl.className = 'kr-brand-subtitle';

        return { title: titleEl, subtitle: subEl };
    }

    /**
     * Topbar title/subtitle + the browser tab.
     *
     * The tab ALWAYS gets the theme's title. The topbar text is a different
     * question: a wide wordmark fills the 264px brand column on its own and
     * carries the brand by itself, so the text beside it is suppressed (see
     * `data-brand-wordmark` in kr-base.css) — the title then lives in the tab
     * rather than being crammed in at an unreadable size. A square mark, or no
     * image at all, leaves room for the text and shows it.
     */
    function applyBrandText(theme) {
        var parts = brandParts();
        if (!parts) return;

        var title = theme.title || base.title;
        var subtitle = theme.title ? theme.subtitle : base.subtitle;   // an inline theme owns both

        parts.title.textContent = title;
        parts.title.classList.toggle('is-long', title.length > LONG_TITLE_CHARS);
        parts.subtitle.textContent = subtitle;
        parts.subtitle.style.display = subtitle ? '' : 'none';

        document.title = theme.title || base.docTitle || title;
    }

    /** Remembered aspect verdicts, so a known wordmark applies before paint. */
    function readWideMap() {
        try {
            var raw = localStorage.getItem(WIDE_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function rememberWide(src, wide) {
        try {
            var map = readWideMap();
            if (map[src] === wide) return;
            map[src] = wide;
            localStorage.setItem(WIDE_KEY, JSON.stringify(map));
        } catch (e) { /* private mode */ }
    }

    /** Reflect a wordmark verdict onto the <img> and the brand block. */
    function setWide(img, wide) {
        img.classList.toggle('is-wide', wide);
        if (wide) {
            document.documentElement.setAttribute('data-brand-wordmark', '');
        } else {
            document.documentElement.removeAttribute('data-brand-wordmark');
        }
    }

    /**
     * Point the topbar brand image at this theme's logo, and decide whether it
     * is a WORDMARK — markedly wider than tall. A wordmark gets `.is-wide`,
     * which drops the white square chip the default mark sits on and lets the
     * artwork run to ~160px; sizing stays in CSS so a stylesheet can still win.
     *
     * The measurement needs the image, so the first ever sight of a logo is one
     * frame late. The verdict is cached per src, so every later load applies it
     * up front and the brand block does not visibly re-flow. A theme can skip
     * the sniff entirely with `"wideLogo": true|false`.
     */
    /**
     * Put the topbar brand into (or out of) its loading placeholder.
     *
     * Setting `img.src` does NOT clear the picture the browser is already
     * showing — it keeps painting the OLD logo until the new one has been
     * fetched and decoded. On a space switch that means the previous space's
     * mark sits in the header next to the new space's name, for as long as the
     * image takes. `data-brand-loading` on <html> hides the <img> and puts a
     * neutral shimmer in its place, so the header reads as "loading" instead of
     * as the wrong brand.
     */
    function setBrandLoading(loading) {
        if (loading) {
            document.documentElement.setAttribute('data-brand-loading', '');
        } else {
            document.documentElement.removeAttribute('data-brand-loading');
        }
    }

    function applyLogo(theme) {
        var img = document.getElementById('brandLogo') || document.querySelector('.kr-brand-logo');
        if (!img) return;

        var src = theme.logo || base.logoSrc;
        var previous = img.getAttribute('src');
        img.setAttribute('src', src);
        img.setAttribute('alt', theme.logoAlt || base.logoAlt);

        // Only a CHANGE of logo can strand the old picture on screen; re-applying
        // the same theme must not flash a placeholder.
        if (src && previous && previous !== src) {
            // A cached image is already complete by the time src is assigned, so
            // this never flashes for a logo the browser has seen this session.
            if (img.complete && img.naturalWidth > 0) {
                setBrandLoading(false);
            } else {
                setBrandLoading(true);
                var settle = function () {
                    if (img.getAttribute('src') !== src) return; // superseded
                    setBrandLoading(false);
                };
                // `error` matters as much as `load`: a missing logo must not
                // leave the header shimmering forever.
                img.addEventListener('load', settle, { once: true });
                img.addEventListener('error', settle, { once: true });
            }
        } else if (!src) {
            setBrandLoading(false);
        }

        if (theme.logoWide === true || theme.logoWide === false) {
            setWide(img, theme.logoWide);
            return;
        }
        if (!src) {
            setWide(img, false);
            return;
        }

        var known = readWideMap()[src];
        setWide(img, known === true);
        if (typeof known === 'boolean') return;

        var probe = new Image();
        probe.onload = function () {
            var wide = probe.naturalHeight > 0 &&
                probe.naturalWidth >= probe.naturalHeight * WORDMARK_RATIO;
            rememberWide(src, wide);
            // The user may have switched space while this was loading.
            if (img.getAttribute('src') !== src) return;
            setWide(img, wide);
        };
        probe.src = src;
    }

    function applyDomBits(theme) {
        if (!base) {
            var parts = brandParts();
            var img = document.getElementById('brandLogo') || document.querySelector('.kr-brand-logo');
            base = {
                title: parts ? parts.title.textContent : '',
                subtitle: parts ? parts.subtitle.textContent : '',
                docTitle: document.title,
                logoSrc: img ? img.getAttribute('src') : '',
                logoAlt: img ? img.getAttribute('alt') : ''
            };
        }
        // An unconfirmed boot guess brands the page with a space we may not
        // open. Keep the ramp, placeholder the identity until applyForSpace
        // says which space this actually is.
        if (bootGuessed && !brandConfirmed) {
            document.documentElement.setAttribute('data-brand-pending', '');
        } else {
            document.documentElement.removeAttribute('data-brand-pending');
        }

        applyIcons(theme);
        applyLogo(theme);
        applyBrandText(theme);
    }

    /**
     * Apply a theme value. Anything unusable degrades to the default rather
     * than leaving the app half-branded. Re-applying the same value is a no-op,
     * which matters because selectSpace() runs on every sidebar click.
     *
     * @param {string|Object} value  preset name or inline theme object
     * @param {string} [spaceName]   for the CSS key when the theme has no title
     * @return {string} the theme key actually applied
     */
    function apply(value, spaceName) {
        var theme = normaliseTheme(value, spaceName) || normaliseTheme(DEFAULT_THEME);

        var signature = theme.key + '|' + JSON.stringify(theme.accent) + '|' +
            (theme.title || '') + '|' + (theme.subtitle || '') + '|' + (theme.logo || '');
        if (signature === currentSignature) return theme.key;

        document.documentElement.setAttribute('data-theme', theme.key);
        if (theme.custom) {
            document.documentElement.setAttribute('data-theme-custom', '');
        } else {
            document.documentElement.removeAttribute('data-theme-custom');
        }
        // A page that has adopted the shared noobly theme (styles.css) opts
        // out of per-space COLOUR with <html data-theme-colors="off">; it
        // still gets the space's title, logo and favicon.
        if (document.documentElement.getAttribute('data-theme-colors') !== 'off') {
            applyAccent(theme);
            applyDerivedCss(theme);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { applyDomBits(theme); }, { once: true });
        } else {
            applyDomBits(theme);
        }

        current = theme;
        currentSignature = signature;
        return theme.key;
    }

    var current = null;
    var currentSignature = null;
    apply(bootTheme());

    window.KRTheme = {
        /**
         * Brand the app for a space record straight off the spaces API. The
         * space is the source of truth — this both applies and remembers, so
         * the next load of the same space paints correctly before first paint.
         * @param {{name?: string, theme?: (string|Object)}} space
         * @return {string} the theme key actually applied
         */
        applyForSpace: function (space) {
            // The space is now KNOWN, so the brand stops being a guess. Set
            // before apply() so applyDomBits clears the pending placeholder —
            // and set even when the theme is unchanged (apply() short-circuits
            // on an identical signature, which is exactly the case where the
            // guess turned out right and the placeholder must still come off).
            brandConfirmed = true;
            document.documentElement.removeAttribute('data-brand-pending');

            var applied = apply(space && space.theme, space && space.name);
            if (space && space.name) remember(space.name, space.theme || null);
            return applied;
        },
        apply: apply,
        /** The descriptor in force — accent ramp, title, logo. */
        currentTheme: function () { return current; },
        current: function () { return current ? current.key : null; },
        names: function () { return Object.keys(THEMES); },
        themes: THEMES
    };
})();
