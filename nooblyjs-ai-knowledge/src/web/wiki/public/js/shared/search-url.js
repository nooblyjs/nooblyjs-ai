/**
 * @fileoverview Search deep links — the one place that knows how search state is
 * written to, and read back from, a URL query string.
 *
 * A search is a VIEW, and a view that cannot be linked to cannot be shared. The
 * shape:
 *
 *   /applications/wiki/<Space>/?q=oracle&folder1=Design&type=Home&view=grid
 *
 * The PATH keeps its existing meaning — which space you are in — and everything
 * about the search lives in the QUERY. That split is what makes this work with
 * the login round trip for free: both redirect paths already carry the full URL
 * (`pathname + search` client-side in usercontroller, `req.originalUrl` in the
 * server's Entra SSO guard), so a pasted link survives authentication with its
 * query intact. Putting search state in the path instead would have needed the
 * auth flow changed.
 *
 * Parameters
 * ----------
 *   q        the query text. Its presence is what marks a URL as a search.
 *   view     list | grid | feature | cards  (see VIEW_ALIASES — `list` is the
 *            word on the button, `details` is the value the code uses)
 *   folder   folder-scope path for the "search within this folder" chip
 *   space, folder1, folder2, type
 *            facet selections, REPEATED once per selected value:
 *              ?type=Home&type=Design
 *            Repetition rather than a delimiter because facet values are folder
 *            and file names — they can contain commas, and any separator we
 *            picked would eventually appear inside a value.
 *
 * DOM-free on purpose: it takes and returns strings and plain objects, so the
 * round trip is unit-testable without a browser (tests/backend/components/
 * searchUrlState.test.js evaluates this file in a `vm`, the same way
 * navigation-core.js is tested).
 */

/**
 * URL word → internal view mode. The toggle button reads "List" but every
 * consumer stores `details`, so a link written the way a user would say it has
 * to be translated. `details` maps to itself so a URL copied out of an older
 * build still resolves.
 */
export const VIEW_ALIASES = Object.freeze({
    list: 'details',
    details: 'details',
    grid: 'grid',
    feature: 'feature',
    cards: 'cards'
});

/** Internal view mode → the word used in a URL (the inverse, canonicalised). */
export const VIEW_URL_WORD = Object.freeze({
    details: 'list',
    grid: 'grid',
    feature: 'feature',
    cards: 'cards'
});

/**
 * Facet key (as used in searchcontroller's `active` state) → URL parameter.
 * Kept here so the URL contract is declared in one place; searchcontroller
 * imports it rather than repeating the names.
 */
export const FACET_PARAMS = Object.freeze({
    space: 'space',
    folderL1: 'folder1',
    folderL2: 'folder2',
    docType: 'type'
});

/**
 * Normalise a view mode from a URL (or anywhere else) to its internal value.
 * @param {string} word
 * @returns {string|null} null when unrecognised — callers keep their default
 *   rather than rendering an empty list for a typo.
 */
export function normaliseViewMode(word) {
    if (!word) return null;
    return VIEW_ALIASES[String(word).trim().toLowerCase()] || null;
}

/**
 * Read search state out of a query string.
 *
 * @param {string} search - `window.location.search`, with or without the '?'.
 * @returns {{query: string, facets: Object<string,string[]>, view: string|null,
 *            folderPath: string|null}|null}
 *   null when there is no `q` — i.e. this URL is not a search, and the caller
 *   should leave whatever view it was going to show alone.
 */
export function parseSearchUrl(search) {
    let params;
    try {
        params = new URLSearchParams(search || '');
    } catch (_) {
        return null;
    }

    const query = (params.get('q') || '').trim();
    if (!query) return null;

    const facets = {};
    for (const [key, param] of Object.entries(FACET_PARAMS)) {
        // Values are trimmed and de-duplicated: a hand-edited link can repeat one.
        const values = params.getAll(param)
            .map((v) => String(v).trim())
            .filter((v) => v.length > 0);
        facets[key] = [...new Set(values)];
    }

    const folderPath = (params.get('folder') || '').trim();

    return {
        query,
        facets,
        view: normaliseViewMode(params.get('view')),
        folderPath: folderPath || null
    };
}

/**
 * Build the query string for a search state. The inverse of `parseSearchUrl`.
 *
 * Only meaningful state is written — no `view=cards` when the view was never
 * chosen, no empty facet params — so a plain search produces a short, readable
 * link rather than a wall of empty parameters.
 *
 * @param {Object} state
 * @param {string} state.query
 * @param {Object<string,Iterable<string>>} [state.facets] - facet key → selected
 *   values (a Set or an array; the caller's `active` state is Sets).
 * @param {string} [state.view] - internal view mode, written as its URL word.
 * @param {string} [state.folderPath] - active folder scope.
 * @param {string} [existingSearch] - the current query string, so unrelated
 *   parameters already on the URL survive (`?embed=1` from the Teams shell,
 *   `?sharedBy=` from a share link). Search params are replaced wholesale.
 * @returns {string} A query string beginning with '?', or '' when there is no query.
 */
export function buildSearchUrl(state, existingSearch = '') {
    const query = state && typeof state.query === 'string' ? state.query.trim() : '';

    let params;
    try {
        params = new URLSearchParams(existingSearch || '');
    } catch (_) {
        params = new URLSearchParams();
    }

    // Clear every parameter this module owns before rewriting, so deselecting the
    // last value of a facet actually removes it instead of leaving a stale one.
    params.delete('q');
    params.delete('view');
    params.delete('folder');
    for (const param of Object.values(FACET_PARAMS)) params.delete(param);

    if (!query) {
        const rest = params.toString();
        return rest ? `?${rest}` : '';
    }

    params.set('q', query);

    for (const [key, param] of Object.entries(FACET_PARAMS)) {
        const values = state.facets && state.facets[key];
        if (!values) continue;
        for (const value of values) {
            const v = String(value == null ? '' : value).trim();
            if (v) params.append(param, v);
        }
    }

    if (state.folderPath) params.set('folder', String(state.folderPath));

    const word = VIEW_URL_WORD[state.view];
    if (word) params.set('view', word);

    const qs = params.toString();
    return qs ? `?${qs}` : '';
}
