'use strict';

/**
 * The Spaces settings screen must be able to author EVERY field of a
 * spaces.json record.
 *
 * This is a three-layer contract with no runtime error anywhere along it. A
 * field can go missing from the form, or be present in the form but dropped by
 * the route's whitelist, and the UI still saves cleanly and reports success —
 * the value simply never reaches disk. That is precisely what happened to
 * `theme`: SpaceManager accepted it on both create and update, but neither
 * route listed it, so a brand set anywhere but a text editor was silently
 * discarded.
 *
 * The three layers, all asserted here:
 *   1. every field of a real record has an input in the form;
 *   2. the routes accept the fields the form sends;
 *   3. the CSS classes the form is built from actually exist.
 *
 * There is no jsdom in this project's jest environment (see
 * loadingIndicators.test.js), so this asserts the source-level contract rather
 * than rendering it.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');
const SCREEN = path.join(REPO, 'src/web/datasources/public/js/screens/spaces.js');
const ROUTES = path.join(REPO, 'src/datasources/routes/spacesRoutes.js');
const MANAGER = path.join(REPO, 'src/datasources/components/SpaceManager.js');
const CSS = path.join(REPO, 'src/web/datasources/public/css/datasources.css');

const screen = fs.readFileSync(SCREEN, 'utf8');
const routes = fs.readFileSync(ROUTES, 'utf8');
const manager = fs.readFileSync(MANAGER, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

/**
 * Every editable leaf of a spaces.json record, mapped to the `data-field` that
 * authors it. Read off the live records in <APP_BASE_DIR>/spaces/spaces.json and
 * the record documented at the top of SpaceManager.js.
 */
const EDITABLE_FIELDS = {
  'name': 'name',
  'description': 'description',
  'type': 'type',
  'visibility': 'visibility',
  'permissions': 'permissions',
  'allowedUsers': 'allowedUsers',
  'theme.title': 'themeTitle',
  'theme.subtitle': 'themeSubtitle',
  'theme.image': 'themeImage',
  'theme.color': 'themeColor',
  'theme.color-highlight': 'themeColorHighlight',
  'theme.home': 'themeHome',
  'configuration.filing.provider': 'filingProvider',
  'configuration.filing.baseDir': 'filingBaseDir',
  'configuration.filing.maxFileSize': 'filingMaxFileSize',
  'configuration.filing.allowedExtensions': 'filingAllowedExtensions',
  'configuration.allowedPaths': 'allowedPaths',
  'configuration.excludedPaths': 'excludedPaths',
  'metadata.archived': 'archived'
};

/** Fields the SERVER owns. Shown for reference, never submitted. */
const SERVER_OWNED = ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];

describe('Spaces settings form — field coverage', () => {
  test.each(Object.entries(EDITABLE_FIELDS))(
    'authors %s via data-field="%s"',
    (recordPath, dataField) => {
      expect(screen).toContain(`data-field="${dataField}"`);
    }
  );

  test('reads every one of those fields back out of the form', () => {
    // A field can be rendered and never read — the save then silently drops it.
    for (const dataField of Object.values(EDITABLE_FIELDS)) {
      if (dataField === 'archived') continue; // read via get('archived') below
      expect(screen).toMatch(new RegExp(`get\\('${dataField}'\\)`));
    }
    expect(screen).toMatch(/get\('archived'\)/);
  });

  test('shows the server-owned audit fields without submitting them', () => {
    for (const field of SERVER_OWNED) {
      expect(screen).toContain(`s.${field}`);
      expect(screen).not.toContain(`data-field="${field}"`);
    }
  });

  test('supports both theme shapes — object and preset string', () => {
    // SPACES.md: `theme` is an object OR a string naming a preset in theme.js.
    // A form that only knew the object form would rewrite a preset into one.
    expect(screen).toContain('data-field="themeMode"');
    expect(screen).toContain('data-field="themePreset"');
    expect(screen).toMatch(/function themePreset/);
    expect(screen).toMatch(/function themeObject/);
  });

  test('one form definition serves create AND edit', () => {
    // Two hand-maintained forms is how create and edit drift into accepting
    // different fields, which is the state this screen was in.
    expect(screen).toMatch(/function spaceFormHtml/);
    const uses = screen.match(/spaceFormHtml\(/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(3); // definition + create + detail
  });

  test('merges onto the loaded record so unknown keys survive a save', () => {
    // configuration/theme/metadata are replaced WHOLESALE by PUT, so rebuilding
    // them from only the fields this form knows would delete anything else.
    expect(screen).toMatch(/Object\.assign\(\{\},\s*baseCfg/);
    expect(screen).toMatch(/Object\.assign\(\{\},\s*baseFiling/);
    expect(screen).toMatch(/Object\.assign\(\{\},\s*base\.metadata/);
    expect(screen).toMatch(/Object\.assign\(\{\},\s*themeObject\(base\)\)/);
  });

  test('settings render above the file browser', () => {
    const settingsAt = screen.indexOf('— settings');
    const filerAt = screen.indexOf('spacesFilerHost');
    expect(settingsAt).toBeGreaterThan(-1);
    expect(filerAt).toBeGreaterThan(-1);
    expect(settingsAt).toBeLessThan(filerAt);
  });
});

describe('Spaces API — accepts what the form sends', () => {
  test('both create and update validate `theme`', () => {
    const themeValidators = routes.match(/body\('theme'\)/g) || [];
    expect(themeValidators.length).toBe(2); // POST + PUT
  });

  test('create passes theme through to SpaceManager', () => {
    expect(routes).toMatch(/theme:\s*req\.body\.theme/);
  });

  test('update maps theme into the update set', () => {
    expect(routes).toMatch(/req\.body\.theme !== undefined.*updates\.theme/s);
  });

  test('a theme may be an object or a preset string, but not an array', () => {
    expect(routes).toMatch(/function isThemeShape/);
    const fn = routes.slice(routes.indexOf('function isThemeShape'));
    expect(fn).toContain('Array.isArray');
    expect(fn).toMatch(/typeof value === 'string'/);
  });

  test('update uses presence checks so a field can be CLEARED', () => {
    // `if (req.body.allowedUsers)` cannot distinguish "not sent" from "emptied",
    // so clearing a list reported success and left the old value on disk.
    for (const field of ['type', 'visibility', 'permissions', 'allowedUsers', 'configuration', 'metadata']) {
      expect(routes).toContain(`req.body.${field} !== undefined`);
    }
  });

  test('name keeps its truthy guard — an unnamed space is unaddressable', () => {
    // Documents resolve spaces BY NAME, so an empty name is rejected, not applied.
    expect(routes).toMatch(/if \(req\.body\.name\) updates\.name/);
  });

  test('SpaceManager persists theme on create and update', () => {
    expect(manager).toMatch(/theme:\s*spaceData\.theme/);
    expect(manager).toMatch(/allowedUpdates\s*=\s*\[[^\]]*'theme'/s);
  });

  test('clearing a theme removes the key rather than storing null', () => {
    // Otherwise every consumer has to handle a third state meaning "absent".
    expect(manager).toMatch(/'theme' in updates && !space\.theme.*delete space\.theme/s);
  });
});

describe('Spaces settings form — styling contract', () => {
  // The form is built from these; a missing rule renders as unstyled markup
  // rather than throwing, so it goes unnoticed.
  test.each(['form-section', 'grid-cols-3', 'audit-grid', 'field', 'field-label', 'field-help'])(
    '.%s is defined in datasources.css',
    (cls) => {
      expect(css).toMatch(new RegExp(`\\.kr-ds\\s+\\.${cls}[\\s,{:.]`));
    }
  );

  test('every class the screen uses for layout exists', () => {
    for (const cls of ['card', 'card-head', 'card-pad', 'card-title', 'btn', 'input', 'select', 'textarea', 'mono']) {
      expect(css).toMatch(new RegExp(`\\.kr-ds\\s+\\.${cls}[\\s,{:.]`));
    }
  });

  test('grid-cols-3 collapses on narrow viewports', () => {
    const media = css.slice(css.indexOf('@media (max-width: 1100px)'));
    expect(media).toMatch(/\.grid-cols-3\s*\{\s*grid-template-columns:\s*1fr/);
  });
});
