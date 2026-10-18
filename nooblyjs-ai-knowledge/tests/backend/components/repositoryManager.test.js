/**
 * @fileoverview Repository bootstrap — path resolution and setup reporting.
 *
 * The contract under test:
 *   1. A relative `localFolder` resolves against APP_BASE_DIR, never against
 *      process.cwd(). A bare `path.resolve(localFolder)` made the SAME
 *      repositories.json describe different folders depending on how the process
 *      was launched — the second-implicit-root trap CLAUDE.md documents for the
 *      settings service.
 *   2. ONE resolver, shared. The manager decides where to clone and the analytics
 *      screen reports where the clone is; two separate `path.resolve` calls is how
 *      a screen comes to describe a folder the manager is not using.
 *   3. A boot-time clone failure is RECORDED, not merely logged. It runs detached
 *      from startup so it has nowhere to be returned to, and silence here is
 *      indistinguishable from success: the screen reads Active / auto-fetch On /
 *      interval 1 h straight from the config, whether or not anything ran.
 *   4. Credentials never reach that record. A failing `git clone` echoes the URL
 *      it was given, and this string is served to a browser.
 *
 * (1) is the one that actually bit: two entries pointed one directory above their
 * real clones and sat unsynced for three weeks, reported healthy throughout.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveLocalFolder,
  readRepositoryConfigs,
  recordSetup,
  getSetupState,
  instanceNameFor,
  redactUrl,
  SetupStatus,
} = require('../../../src/shared/repositories/repositoryManager');

/** A throwaway APP_BASE_DIR holding spaces/repositories.json. */
function makeAppBase(repos) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-mgr-'));
  fs.mkdirSync(path.join(base, 'spaces'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'spaces', 'repositories.json'),
    JSON.stringify(repos, null, 2),
    'utf8'
  );
  return base;
}

/** A directory that looks like a clone. */
function makeClone(parent, name) {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

describe('resolveLocalFolder', () => {
  const APP_BASE = path.join(path.sep === '\\' ? 'C:\\base' : '/base', 'app', '.application');

  it('resolves a relative folder against APP_BASE_DIR, not process.cwd()', () => {
    expect(resolveLocalFolder('../work-content/repo', APP_BASE))
      .toBe(path.resolve(APP_BASE, '../work-content/repo'));
  });

  it('does NOT resolve against the working directory', () => {
    // The regression itself. These only coincide when the process happens to be
    // started from APP_BASE_DIR, which is exactly what made the old bug invisible
    // on a developer machine and load-bearing everywhere else.
    expect(resolveLocalFolder('../work-content/repo', APP_BASE))
      .not.toBe(path.resolve('../work-content/repo'));
  });

  it('distinguishes the two paths that were confused in production', () => {
    // `../repo` and `../work-content/repo` must not collapse onto each other —
    // the live outage was four entries carrying the second and two the first.
    const wrong = resolveLocalFolder('../knowledge-repo', APP_BASE);
    const right = resolveLocalFolder('../work-content/knowledge-repo', APP_BASE);
    expect(wrong).not.toBe(right);
    expect(right.endsWith(path.join('work-content', 'knowledge-repo'))).toBe(true);
  });

  it('leaves an absolute folder alone — the recommended form for a prod host', () => {
    const absolute = path.resolve(path.sep === '\\' ? 'D:\\clones\\repo' : '/clones/repo');
    expect(resolveLocalFolder(absolute, APP_BASE)).toBe(absolute);
  });

  it('expands {PLACEHOLDER} tokens from the environment', () => {
    process.env.REPO_MGR_TEST_ROOT = 'expanded-root';
    try {
      expect(resolveLocalFolder('../{REPO_MGR_TEST_ROOT}/repo', APP_BASE))
        .toBe(path.resolve(APP_BASE, '../expanded-root/repo'));
    } finally {
      delete process.env.REPO_MGR_TEST_ROOT;
    }
  });

  it('returns null for an empty folder rather than silently resolving to the base', () => {
    // path.resolve(base, '') is `base` — a repository would clone over
    // APP_BASE_DIR itself. The caller skips the entry on null.
    expect(resolveLocalFolder('', APP_BASE)).toBeNull();
    expect(resolveLocalFolder(undefined, APP_BASE)).toBeNull();
  });
});

describe('readRepositoryConfigs', () => {
  const created = [];
  afterAll(() => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports what is on disk, so a mis-pointed localFolder is visible', async () => {
    const base = makeAppBase([
      { id: 1, name: 'Present', repository: 'https://x@example.com/a.git', localFolder: '../content/present' },
      { id: 2, name: 'Missing', repository: 'https://x@example.com/b.git', localFolder: '../present' },
      { id: 3, name: 'Not A Clone', repository: 'https://x@example.com/c.git', localFolder: '../content/bare' },
    ]);
    created.push(base);
    const content = path.join(base, '..', 'content');
    makeClone(content, 'present');
    fs.mkdirSync(path.join(content, 'bare'), { recursive: true });

    const configs = await readRepositoryConfigs(base);
    const byName = Object.fromEntries(configs.map((c) => [c.name, c]));

    expect(byName.Present.localFolderExists).toBe(true);
    expect(byName.Present.cloned).toBe(true);

    // The live failure shape: resolved one directory too high, so nothing there.
    expect(byName.Missing.localFolderExists).toBe(false);
    expect(byName.Missing.cloned).toBe(false);

    // Exists but is not a clone — a different fault with a different fix, and the
    // one the manager deliberately refuses to clone into.
    expect(byName['Not A Clone'].localFolderExists).toBe(true);
    expect(byName['Not A Clone'].cloned).toBe(false);
  });

  it('resolves localFolder with the same resolver the manager clones with', async () => {
    const base = makeAppBase([
      { id: 1, name: 'R', repository: 'https://x@example.com/a.git', localFolder: '../content/r' },
    ]);
    created.push(base);
    const [config] = await readRepositoryConfigs(base);
    expect(config.localFolder).toBe(resolveLocalFolder('../content/r', base));
  });

  it('never sends credentials to the browser', async () => {
    const base = makeAppBase([
      { id: 1, name: 'R', repository: 'https://user:s3cr3t-token@bitbucket.org/org/repo.git', localFolder: '../r' },
    ]);
    created.push(base);
    const [config] = await readRepositoryConfigs(base);
    expect(config.repository).not.toContain('s3cr3t-token');
    expect(config.repository).toContain('***@');
  });

  it('attaches the recorded setup outcome for each instance', async () => {
    const repo = { id: 9, name: 'Setup Reported', repository: 'https://x@example.com/a.git', localFolder: '../r' };
    const base = makeAppBase([repo]);
    created.push(base);

    recordSetup(instanceNameFor(repo), {
      status: SetupStatus.FAILED,
      error: 'Failed to clone repository: fatal: repository not found',
    });

    const [config] = await readRepositoryConfigs(base);
    expect(config.setup.status).toBe('failed');
    expect(config.setup.error).toContain('repository not found');
    expect(config.setup.at).toBeTruthy();
  });

  it('returns an empty list when repositories.json is absent', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-mgr-empty-'));
    created.push(base);
    await expect(readRepositoryConfigs(base)).resolves.toEqual([]);
  });
});

/**
 * The reporting is a three-layer contract with no runtime error anywhere along
 * it — exactly the shape spaceSettingsForm.test.js guards for spaces. Rename a
 * field on either side and the screen keeps rendering, simply never showing the
 * fault again. There is no jsdom in this project's jest environment, so this
 * asserts the source-level contract rather than rendering it.
 */
describe('Repositories screen — setup reporting contract', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const screen = fs.readFileSync(
    path.join(REPO, 'src/web/datasources/public/js/screens/repository.js'), 'utf8');
  const routes = fs.readFileSync(
    path.join(REPO, 'src/datasources/routes/repositoriesRoutes.js'), 'utf8');
  const css = fs.readFileSync(
    path.join(REPO, 'src/web/datasources/public/css/datasources.css'), 'utf8');

  it.each(['setup', 'localFolderExists', 'cloned'])('the screen reads `%s`', (field) => {
    expect(screen).toContain(field);
  });

  it('the analytics route serves the recorded setup outcome', () => {
    expect(routes).toMatch(/setup:\s*config\s*\?\s*config\.setup/);
  });

  it('renders the setup banner ahead of the status/lock banners', () => {
    // Order matters: "never cloned" explains "git status unavailable", so a
    // banner placed after it just describes a symptom of the one above.
    const body = screen.slice(screen.indexOf('${header}'));
    expect(body.indexOf('${setupBanner}')).toBeGreaterThan(-1);
    expect(body.indexOf('${setupBanner}')).toBeLessThan(body.indexOf('${errorBanner}'));
  });

  it.each(['danger', 'warn', 'success', 'neutral'])(
    'badge tone `%s` exists in the stylesheet', (tone) => {
      // The app does not load Bootstrap's CSS (see CLAUDE.md), so an invented
      // utility class is inert — a broken repository would render unstyled.
      expect(css).toMatch(new RegExp(`\\.badge\\.${tone}\\b`));
    });
});

describe('setup state', () => {
  it('starts unknown for an instance that never registered', () => {
    expect(getSetupState('repo-never-seen')).toBeNull();
  });

  it('merges successive records and keeps the latest status', () => {
    recordSetup('repo-merge', { status: SetupStatus.PENDING, name: 'M', localPath: '/tmp/m' });
    recordSetup('repo-merge', { status: SetupStatus.READY, error: null });
    const state = getSetupState('repo-merge');
    expect(state.status).toBe('ready');
    // localPath survives the second write — it is what the banner names.
    expect(state.localPath).toBe('/tmp/m');
  });

  it('redacts a clone error before it can be stored and served', () => {
    // The manager redacts at the call site; this pins the behaviour the banner
    // depends on, since a failing `git clone` echoes the URL it was handed.
    const raw = "fatal: could not read from 'https://user:s3cr3t@bitbucket.org/org/repo.git'";
    expect(redactUrl(raw)).not.toContain('s3cr3t');
    expect(redactUrl(raw)).toContain('***@');
  });
});
