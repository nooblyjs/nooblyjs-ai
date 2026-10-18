/**
 * Sync daemon — folder selection, path derivation and folder scoping.
 *
 * The daemon (applications/daemon/wiki) mirrors a chosen set of wiki FOLDERS
 * into local directories. Three pure pieces decide whether that is correct, and
 * all three fail silently when they are wrong — a mis-scoped unit writes files
 * into the wrong folder, a colliding path makes two selections fight over one
 * directory, and a bad diff re-mirrors or deletes the wrong thing. None of that
 * raises an error at the time; it just produces a wrong mirror.
 *
 * These modules are deliberately dependency-free (node builtins only) so they
 * can be exercised here without the daemon's own node_modules — the HTTP client
 * and file watcher live behind other files on purpose.
 */

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const DAEMON_LIB = path.join(
  __dirname, '..', '..', '..', 'applications', 'daemon', 'wiki', 'lib'
);

const {
  ConfigStore,
  normaliseServerUrl,
  normaliseBaseFolder,
  normaliseFolderPath,
  isPathInside,
  isFilesystemRoot,
  folderId,
  folderKey,
  maskToken,
} = require(path.join(DAEMON_LIB, 'config-store'));
const StateManager = require(path.join(DAEMON_LIB, 'state-manager'));
const { sanitizeFolderName, localPathForFolder } = require(path.join(DAEMON_LIB, 'local-paths'));
const FileSync = require(path.join(DAEMON_LIB, 'file-sync'));
const { collapseHitsToFolders } = require(path.join(DAEMON_LIB, 'folder-search'));
const { isUntrustedIssuerError, trustStoreWith } = require(path.join(DAEMON_LIB, 'tls-trust'));

/** A FileSync with no I/O wired up — only the path arithmetic is under test. */
function scopedSync(remoteRoot) {
  return new FileSync(null, null, '/local/root', '7', 'space-7', [], { remoteRoot });
}

describe('daemon: server URL normalisation', () => {
  test('strips trailing slashes so one server has one stored form', () => {
    expect(normaliseServerUrl('https://kr.example.com/')).toBe('https://kr.example.com');
    expect(normaliseServerUrl('https://kr.example.com///')).toBe('https://kr.example.com');
    expect(normaliseServerUrl('  https://kr.example.com  ')).toBe('https://kr.example.com');
  });

  test('keeps a path prefix — the wiki may be mounted under one', () => {
    expect(normaliseServerUrl('https://host/knowledge/')).toBe('https://host/knowledge');
  });

  test('rejects anything that is not http(s), rather than storing it', () => {
    expect(normaliseServerUrl('')).toBeNull();
    expect(normaliseServerUrl('kr.example.com')).toBeNull();
    expect(normaliseServerUrl('ftp://kr.example.com')).toBeNull();
    expect(normaliseServerUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('daemon: folder path normalisation', () => {
  test('reduces every spelling of one folder to a single key', () => {
    const forms = ['a/b', '/a/b', './a/b', 'a\\b', 'a//b', 'a/b/'];
    for (const form of forms) expect(normaliseFolderPath(form)).toBe('a/b');
  });

  test('the space root is the empty string, not null or "/"', () => {
    expect(normaliseFolderPath('')).toBe('');
    expect(normaliseFolderPath('/')).toBe('');
    expect(normaliseFolderPath(null)).toBe('');
    expect(normaliseFolderPath(undefined)).toBe('');
  });

  test('folder identity is space + path, and is stable across spellings', () => {
    expect(folderId(12, 'Sales/Reports')).toBe(folderId('12', '/Sales/Reports/'));
    expect(folderId(12, 'Sales')).not.toBe(folderId(13, 'Sales'));
  });

  test('state-file keys are short, filesystem-safe and collision-free', () => {
    const a = folderKey(folderId(12, 'Commercial Services/Technology'));
    const b = folderKey(folderId(12, 'Commercial Services/Technolog'));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('daemon: local path derivation', () => {
  test('mirrors the remote path instead of flattening it', () => {
    const p = localPathForFolder('/watch', 'Engineering Space', 'Commercial Services/Technology');
    expect(p).toBe(path.join('/watch', 'Engineering Space', 'Commercial Services', 'Technology'));
  });

  test('same leaf name under different parents does NOT collide', () => {
    const sales = localPathForFolder('/watch', 'Ent', 'Sales/Reports');
    const finance = localPathForFolder('/watch', 'Ent', 'Finance/Reports');
    expect(sales).not.toBe(finance);
  });

  test('a whole-space selection is just the space folder', () => {
    expect(localPathForFolder('/watch', 'Ent', '')).toBe(path.join('/watch', 'Ent'));
  });

  test('sanitises each segment separately, keeping the nesting', () => {
    const p = localPathForFolder('/watch', 'A:B', 'x?y/z*w');
    expect(p).toBe(path.join('/watch', 'A_B', 'x_y', 'z_w'));
  });

  test('avoids Windows reserved device names', () => {
    expect(sanitizeFolderName('con')).toBe('_con');
    expect(sanitizeFolderName('LPT1')).toBe('_LPT1');
    expect(sanitizeFolderName('console')).toBe('console'); // only exact matches
  });

  test('strips trailing dots and spaces, which Windows silently drops', () => {
    expect(sanitizeFolderName('Reports.')).toBe('Reports');
    expect(sanitizeFolderName('Reports ')).toBe('Reports');
  });

  test('a name that sanitises to nothing still yields a usable folder', () => {
    // Illegal characters become "_", so "///" is a legitimate "___" — the
    // fallback is only for input that reduces to an empty string, which is
    // exactly what a name of dots and spaces does once the trailing run is
    // stripped (Windows drops those silently, so they cannot be kept).
    expect(sanitizeFolderName('///')).toBe('___');
    expect(sanitizeFolderName('. ')).toBe('folder');
    expect(sanitizeFolderName('')).toBe('folder');
  });
});

describe('daemon: folder scoping (which unit owns a path)', () => {
  test('a space-root unit owns everything', () => {
    const unit = scopedSync('');
    expect(unit.owns('anything/at/all.md')).toBe(true);
    expect(unit.toLocalRelative('a/b.md')).toBe('a/b.md');
    expect(unit.toRemotePath('a/b.md')).toBe('a/b.md');
  });

  test('a scoped unit strips and restores its own prefix', () => {
    const unit = scopedSync('Commercial Services/Technology');
    expect(unit.toLocalRelative('Commercial Services/Technology/roadmap.md')).toBe('roadmap.md');
    expect(unit.toRemotePath('roadmap.md')).toBe('Commercial Services/Technology/roadmap.md');
  });

  test('the round trip is lossless for nested files', () => {
    const unit = scopedSync('a/b');
    const remote = 'a/b/c/d/e.md';
    expect(unit.toRemotePath(unit.toLocalRelative(remote))).toBe(remote);
  });

  test('a sibling folder is NOT owned — this is what keeps units apart', () => {
    const unit = scopedSync('Sales');
    expect(unit.owns('Finance/report.md')).toBe(false);
    expect(unit.toLocalRelative('Finance/report.md')).toBeNull();
  });

  test('prefix matching is on whole segments: "Sales" must not claim "SalesOps"', () => {
    const unit = scopedSync('Sales');
    expect(unit.owns('SalesOps/report.md')).toBe(false);
    expect(unit.owns('Sales/report.md')).toBe(true);
  });

  test('the unit root itself resolves to the local root, not to null', () => {
    const unit = scopedSync('Sales');
    expect(unit.toLocalRelative('Sales')).toBe('');
    expect(unit.owns('Sales')).toBe(true);
  });

  test('separator and prefix spellings do not defeat ownership', () => {
    const unit = scopedSync('/Sales/Reports/');
    expect(unit.remoteRoot).toBe('Sales/Reports');
    expect(unit.owns('Sales\\Reports\\q3.md')).toBe(true);
    expect(unit.owns('./Sales/Reports/q3.md')).toBe(true);
  });

  test('suspend() latches, so teardown can never push a delete upstream', () => {
    const unit = scopedSync('Sales');
    expect(unit.suspended).toBe(false);
    unit.suspend();
    expect(unit.suspended).toBe(true);
  });
});

describe('daemon: token masking', () => {
  test('shows enough to recognise a token, never enough to use it', () => {
    const token = 'dtk_abcdefghijklmnopqrstuvwxyz';
    const masked = maskToken(token);
    expect(masked).toContain('dtk_');
    expect(masked).not.toContain('ijklmnop');
    expect(masked.length).toBeLessThan(token.length);
  });

  test('a short value is not echoed back in full', () => {
    expect(maskToken('short')).toBe('sho…');
    expect(maskToken('')).toBeNull();
    expect(maskToken(null)).toBeNull();
  });
});

describe('daemon: ConfigStore', () => {
  let dir;
  let file;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-cfg-'));
    file = path.join(dir, '.daemon-config.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const quietLog = { info() {}, warn() {}, error() {} };
  const store = () => new ConfigStore(file, { log: quietLog });

  test('a missing file is a normal first run, not an error', async () => {
    const s = store();
    await s.load();
    expect(s.isComplete()).toBe(false);
    expect(s.folders).toEqual([]);
  });

  test('is incomplete until BOTH server and token are present', async () => {
    const s = store();
    await s.load();
    await expect(s.setConnection('https://kr.example.com', '')).rejects.toThrow(/token/i);
    await expect(s.setConnection('not-a-url', 'dtk_x')).rejects.toThrow(/valid http/i);
    expect(s.isComplete()).toBe(false);

    await s.setConnection('https://kr.example.com/', 'dtk_x');
    expect(s.isComplete()).toBe(true);
    expect(s.serverUrl).toBe('https://kr.example.com');
  });

  test('round-trips through disk', async () => {
    const a = store();
    await a.load();
    await a.setConnection('https://kr.example.com', 'dtk_secret');
    await a.setFolders([{ spaceId: 12, spaceName: 'Ent', remotePath: 'Sales' }]);

    const b = store();
    await b.load();
    expect(b.serverUrl).toBe('https://kr.example.com');
    expect(b.token).toBe('dtk_secret');
    expect(b.folders).toHaveLength(1);
    expect(b.folders[0].remotePath).toBe('Sales');
  });

  test('setFolders reports what changed, so only the delta is acted on', async () => {
    const s = store();
    await s.load();
    await s.setFolders([
      { spaceId: 12, spaceName: 'Ent', remotePath: 'Sales' },
      { spaceId: 12, spaceName: 'Ent', remotePath: 'Finance' },
    ]);

    const result = await s.setFolders([
      { spaceId: 12, spaceName: 'Ent', remotePath: 'Sales' },     // unchanged
      { spaceId: 12, spaceName: 'Ent', remotePath: 'Marketing' }, // added
    ]);

    expect(result.added.map(f => f.remotePath)).toEqual(['Marketing']);
    expect(result.removed.map(f => f.remotePath)).toEqual(['Finance']);
  });

  test('an unchanged folder keeps its original addedAt — it is not re-added', async () => {
    const s = store();
    await s.load();
    await s.setFolders([{ spaceId: 12, spaceName: 'Ent', remotePath: 'Sales' }]);
    const first = s.folders[0].addedAt;

    const result = await s.setFolders([
      { spaceId: 12, spaceName: 'Ent', remotePath: '/Sales/' },  // same folder, different spelling
    ]);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(s.folders[0].addedAt).toBe(first);
  });

  test('the same folder listed twice collapses to one entry', async () => {
    const s = store();
    await s.load();
    const result = await s.setFolders([
      { spaceId: 12, spaceName: 'Ent', remotePath: 'Sales' },
      { spaceId: 12, spaceName: 'Ent', remotePath: 'Sales/' },
    ]);
    expect(result.folders).toHaveLength(1);
  });

  test('the space root is a selectable folder, not a missing value', async () => {
    const s = store();
    await s.load();
    await s.setFolders([{ spaceId: 12, spaceName: 'Ent', remotePath: '' }]);
    expect(s.folders).toHaveLength(1);
    expect(s.folders[0].remotePath).toBe('');
  });

  test('a corrupt config is preserved, not silently overwritten', async () => {
    await fs.writeFile(file, '{ this is not json', 'utf8');
    const s = store();
    await s.load();

    expect(s.isComplete()).toBe(false);
    const salvaged = (await fs.readdir(dir)).filter(n => n.includes('.corrupt-'));
    expect(salvaged).toHaveLength(1);
  });

  test('a hand-edited file with junk entries loads without throwing', async () => {
    await fs.writeFile(file, JSON.stringify({
      serverUrl: 'https://kr.example.com',
      token: 'dtk_x',
      folders: [
        null,
        'nonsense',
        { spaceName: 'no id' },                                  // no spaceId — dropped
        { spaceId: 12, remotePath: 'Sales' },                    // no name — defaulted
      ],
    }), 'utf8');

    const s = store();
    await s.load();
    expect(s.folders).toHaveLength(1);
    expect(s.folders[0].spaceName).toBe('Space 12');
  });

  test('redacted() never returns a usable token', async () => {
    const s = store();
    await s.load();
    await s.setConnection('https://kr.example.com', 'dtk_supersecretvalue');

    const view = s.redacted();
    expect(JSON.stringify(view)).not.toContain('supersecretvalue');
    expect(view.hasToken).toBe(true);
    expect(view.tokenHint).toBeTruthy();
  });

  test('clearToken is sign-out, not reset: the selection survives', async () => {
    const s = store();
    await s.load();
    await s.setConnection('https://kr.example.com', 'dtk_x');
    await s.setFolders([{ spaceId: 12, spaceName: 'Ent', remotePath: 'Sales' }]);

    await s.clearToken();
    expect(s.isComplete()).toBe(false);
    expect(s.serverUrl).toBe('https://kr.example.com');
    expect(s.folders).toHaveLength(1);
  });
});

describe('daemon: folder search — the space is part of the selection', () => {
  const hit = (path, title) => ({ path, title });

  test('the folder is bound to the space that was SEARCHED, not the hit stamp', () => {
    // The index stamps a document with whichever space indexed the shared
    // content root last, so a hit found while searching space 12 can arrive
    // wearing space 99's name. Trusting the stamp would bind the sync unit to a
    // lens that may not expose the folder at all.
    const out = collapseHitsToFolders([{
      target: { id: '12', name: 'Engineering Space' },
      hits: [{ path: 'Sales/q3.md', title: 'q3', spaceId: 99, spaceName: 'Retail Space' }],
    }]);

    expect(out).toHaveLength(1);
    expect(out[0].spaceId).toBe('12');
    expect(out[0].spaceName).toBe('Engineering Space');
  });

  test('the same folder path in two spaces stays two selections', () => {
    const out = collapseHitsToFolders([
      { target: { id: '12', name: 'Engineering' }, hits: [hit('Reports/a.md', 'a')] },
      { target: { id: '13', name: 'Fintech' }, hits: [hit('Reports/b.md', 'b')] },
    ]);

    expect(out).toHaveLength(2);
    expect(out.map(f => f.id).sort()).toEqual(['12::Reports', '13::Reports']);
  });

  test('hits collapse onto their parent folder and count', () => {
    const out = collapseHitsToFolders([{
      target: { id: '12', name: 'Ent' },
      hits: [hit('Sales/a.md', 'a'), hit('Sales/b.md', 'b'), hit('Sales/c.md', 'c')],
    }]);

    expect(out).toHaveLength(1);
    expect(out[0].remotePath).toBe('Sales');
    expect(out[0].matches).toBe(3);
  });

  test('a root-level document resolves to the space root, not to nothing', () => {
    const out = collapseHitsToFolders([{
      target: { id: '12', name: 'Ent' },
      hits: [hit('home.md', 'home')],
    }]);

    expect(out).toHaveLength(1);
    expect(out[0].remotePath).toBe('');
  });

  test('samples are capped so one busy folder cannot flood the row', () => {
    const out = collapseHitsToFolders([{
      target: { id: '12', name: 'Ent' },
      hits: ['a', 'b', 'c', 'd', 'e'].map(n => hit(`Sales/${n}.md`, n)),
    }]);

    expect(out[0].matches).toBe(5);
    expect(out[0].samples).toHaveLength(3);
  });

  test('strongest match first, then a stable space/path order', () => {
    const out = collapseHitsToFolders([
      { target: { id: '12', name: 'Zeta' }, hits: [hit('One/a.md', 'a')] },
      { target: { id: '13', name: 'Alpha' }, hits: [hit('Two/b.md', 'b')] },
      { target: { id: '14', name: 'Mid' }, hits: [hit('Three/c.md', 'c'), hit('Three/d.md', 'd')] },
    ]);

    expect(out[0].spaceName).toBe('Mid');      // 2 matches wins
    expect(out[1].spaceName).toBe('Alpha');    // tie broken by space name
    expect(out[2].spaceName).toBe('Zeta');
  });

  test('a space that returned nothing contributes nothing, and does not throw', () => {
    const out = collapseHitsToFolders([
      { target: { id: '12', name: 'Ent' }, hits: [] },
      { target: { id: '13', name: 'Other' }, hits: null },
      null,
      { target: { id: '14', name: 'Third' }, hits: [hit('X/a.md', 'a')] },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].spaceId).toBe('14');
  });

  test('path spellings normalise before the parent is taken', () => {
    const out = collapseHitsToFolders([{
      target: { id: '12', name: 'Ent' },
      hits: [hit('/Sales/q3.md', 'a'), hit('Sales\\q4.md', 'b'), hit('./Sales/q5.md', 'c')],
    }]);

    expect(out).toHaveLength(1);
    expect(out[0].remotePath).toBe('Sales');
    expect(out[0].matches).toBe(3);
  });

  test('empty input is an empty list', () => {
    expect(collapseHitsToFolders([])).toEqual([]);
    expect(collapseHitsToFolders(null)).toEqual([]);
  });
});

describe('daemon: untrusted-certificate detection', () => {
  const withCode = (code) => Object.assign(new Error('tls'), { code });

  test('recognises the untrusted-issuer family', () => {
    for (const code of [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ]) {
      expect(isUntrustedIssuerError(withCode(code))).toBe(true);
    }
  });

  test('does NOT offer to pin an expired certificate', () => {
    // Pinning changes nothing — Node still rejects on dates — so offering it
    // would be a button that cannot work.
    expect(isUntrustedIssuerError(withCode('CERT_HAS_EXPIRED'))).toBe(false);
  });

  test('does NOT offer to pin a hostname mismatch', () => {
    // The certificate belongs to a different server. This is the one case where
    // the warning may be describing an actual attack, so it is never a
    // one-click accept.
    expect(isUntrustedIssuerError(withCode('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe(false);
  });

  test('ignores unrelated failures', () => {
    expect(isUntrustedIssuerError(withCode('ECONNREFUSED'))).toBe(false);
    expect(isUntrustedIssuerError(withCode('ENOTFOUND'))).toBe(false);
    expect(isUntrustedIssuerError(null)).toBe(false);
    expect(isUntrustedIssuerError(new Error('plain'))).toBe(false);
  });

  test('sees through the wrapping the api client applies', () => {
    // getSpaces() rethrows a readable message with the original as `cause`;
    // without that the detection here would never fire in production.
    const inner = withCode('DEPTH_ZERO_SELF_SIGNED_CERT');
    const wrapped = new Error('Failed to list spaces (no response): ...', { cause: inner });
    expect(isUntrustedIssuerError(wrapped.cause || wrapped)).toBe(true);
  });

  test('sees through an AggregateError, whose own code is what matters', () => {
    // Node collects one failure per resolved address; the useful code sits on
    // the aggregate or on its entries, never in `.message`.
    const agg = new AggregateError(
      [withCode('DEPTH_ZERO_SELF_SIGNED_CERT')], 'Error');
    expect(isUntrustedIssuerError(agg)).toBe(true);
  });
});

describe('daemon: pinned trust store', () => {
  const FAKE_PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

  test('no pins means no override — Node keeps its own defaults', () => {
    // Returning an array here would REPLACE the system trust store with an
    // empty one and break every ordinary HTTPS connection.
    expect(trustStoreWith([])).toBeNull();
    expect(trustStoreWith(null)).toBeNull();
  });

  test('a pin is ADDED to the existing trust store, not substituted for it', () => {
    const store = trustStoreWith([FAKE_PEM]);
    expect(Array.isArray(store)).toBe(true);
    expect(store).toContain(FAKE_PEM);
    // The real bug this guards: pinning one dev certificate must not stop the
    // daemon trusting the public web.
    expect(store.length).toBeGreaterThan(1);
  });
});

describe('daemon: ConfigStore certificate pinning', () => {
  let dir;
  let file;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-cert-'));
    file = path.join(dir, '.daemon-config.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const quietLog = { info() {}, warn() {}, error() {} };
  const store = () => new ConfigStore(file, { log: quietLog });
  const cert = (fingerprint) => ({
    fingerprint,
    subject: 'CN=localhost',
    issuer: 'CN=localhost',
    validTo: 'Oct  2 11:59:43 2028 GMT',
    pem: '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n',
  });

  test('pins survive a restart, PEM included', async () => {
    const a = store();
    await a.load();
    await a.trustCertificate(cert('AA:BB'));

    const b = store();
    await b.load();
    expect(b.trustedCertificates).toHaveLength(1);
    expect(b.trustedPems()[0]).toContain('BEGIN CERTIFICATE');
  });

  test('re-accepting the same certificate does not duplicate it', async () => {
    const s = store();
    await s.load();
    await s.trustCertificate(cert('AA:BB'));
    await s.trustCertificate(cert('AA:BB'));
    expect(s.trustedCertificates).toHaveLength(1);
  });

  test('a DIFFERENT certificate is a separate decision, not a silent replace', async () => {
    // A regenerated dev certificate has a new fingerprint and must be accepted
    // again — that re-prompt is the entire value of pinning.
    const s = store();
    await s.load();
    await s.trustCertificate(cert('AA:BB'));
    await s.trustCertificate(cert('CC:DD'));
    expect(s.trustedCertificates.map(c => c.fingerprint)).toEqual(['AA:BB', 'CC:DD']);
  });

  test('a pin can be removed', async () => {
    const s = store();
    await s.load();
    await s.trustCertificate(cert('AA:BB'));
    expect(await s.untrustCertificate('AA:BB')).toBe(1);
    expect(s.trustedCertificates).toHaveLength(0);
    expect(await s.untrustCertificate('NOPE')).toBe(0);
  });

  test('rejects a certificate with no fingerprint', async () => {
    const s = store();
    await s.load();
    await expect(s.trustCertificate({ pem: 'x' })).rejects.toThrow(/fingerprint/i);
    await expect(s.trustCertificate(null)).rejects.toThrow();
  });

  test('junk entries on disk are dropped rather than crashing the load', async () => {
    await fs.writeFile(file, JSON.stringify({
      serverUrl: 'https://kr.example.com',
      token: 'dtk_x',
      trustedCertificates: [
        null,
        { subject: 'no pem or fingerprint' },
        { fingerprint: 'AA', pem: 'body' },
        { fingerprint: 'AA', pem: 'duplicate' },
      ],
    }), 'utf8');

    const s = store();
    await s.load();
    expect(s.trustedCertificates).toHaveLength(1);
    expect(s.trustedCertificates[0].fingerprint).toBe('AA');
  });

  test('redacted() exposes the pins for display but not their PEM bodies', async () => {
    const s = store();
    await s.load();
    await s.trustCertificate(cert('AA:BB'));

    const view = s.redacted();
    expect(view.trustedCertificates).toHaveLength(1);
    expect(view.trustedCertificates[0].fingerprint).toBe('AA:BB');
    expect(view.trustedCertificates[0].pem).toBeUndefined();
  });
});

describe('daemon: local base folder', () => {
  test('expands what a person actually types, and resolves it', () => {
    expect(normaliseBaseFolder('  ~/Knowledge  ')).toBe(path.join(os.homedir(), 'Knowledge'));
    expect(normaliseBaseFolder('"' + path.join(os.tmpdir(), 'KR') + '"'))
      .toBe(path.join(os.tmpdir(), 'KR'));
    // A trailing separator is the same folder, not a different one.
    expect(normaliseBaseFolder(path.join(os.tmpdir(), 'KR') + path.sep))
      .toBe(path.join(os.tmpdir(), 'KR'));
  });

  test('expands %VAR% because the value never passes through a shell', () => {
    process.env.DAEMON_TEST_BASE = path.join(os.tmpdir(), 'from-env');
    try {
      expect(normaliseBaseFolder('%DAEMON_TEST_BASE%')).toBe(path.join(os.tmpdir(), 'from-env'));
    } finally {
      delete process.env.DAEMON_TEST_BASE;
    }
  });

  test('an empty folder is null, never the working directory', () => {
    // A daemon launched from a shortcut has no meaningful cwd, so resolving ''
    // would scatter a mirror wherever the shell happened to be.
    expect(normaliseBaseFolder('')).toBeNull();
    expect(normaliseBaseFolder('   ')).toBeNull();
    expect(normaliseBaseFolder(null)).toBeNull();
    expect(normaliseBaseFolder('""')).toBeNull();
  });

  test('a drive/filesystem root is recognisable, so it can be refused', () => {
    // Removing a selection prunes empty parents upward; from a root that is a
    // walk up the whole disk.
    expect(isFilesystemRoot(path.parse(process.cwd()).root)).toBe(true);
    expect(isFilesystemRoot(path.join(path.parse(process.cwd()).root, 'anything'))).toBe(false);
  });

  test('containment is path arithmetic, not a string prefix', () => {
    const base = path.join(os.tmpdir(), 'kr-base');
    expect(isPathInside(path.join(base, 'inner'), base)).toBe(true);
    expect(isPathInside(base, base)).toBe(true);
    // The trap: "kr-base2" starts with "kr-base" and is a different directory.
    expect(isPathInside(base + '2', base)).toBe(false);
  });
});

describe('daemon: ConfigStore base folder', () => {
  let dir;
  let file;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-base-'));
    file = path.join(dir, '.daemon-config.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const quietLog = { info() {}, warn() {}, error() {} };
  const DEFAULTS = { defaultBaseFolder: '/documents/noobly Wiki', legacyBaseFolder: '/old/watch' };
  const store = () => new ConfigStore(file, { log: quietLog, ...DEFAULTS });

  test('a FIRST run gets the new default', async () => {
    const s = store();
    await s.load();
    expect(s.baseFolder).toBe(path.resolve('/documents/noobly Wiki'));
    expect(s.baseFolderChosen).toBe(false);
  });

  test('an EXISTING config without one keeps the pre-upgrade location', async () => {
    // The whole point: upgrading must not abandon a mirror and re-download it
    // somewhere else. An older config has no baseFolder at all.
    await fs.writeFile(file, JSON.stringify({ serverUrl: 'https://kr.example.com', token: 'dtk_x' }), 'utf8');
    const s = store();
    await s.load();
    expect(s.baseFolder).toBe(path.resolve('/old/watch'));
    expect(s.baseFolderChosen).toBe(false);
  });

  test('a CORRUPT config is still an existing install, so it keeps the old location', async () => {
    await fs.writeFile(file, 'not json at all', 'utf8');
    const s = store();
    await s.load();
    expect(s.baseFolder).toBe(path.resolve('/old/watch'));
  });

  test('a stored folder wins over both defaults and survives a reload', async () => {
    const chosen = path.join(dir, 'mirror');
    const s = store();
    await s.load();
    await s.setBaseFolder(chosen);
    expect(s.baseFolderChosen).toBe(true);

    const reloaded = store();
    await reloaded.load();
    expect(reloaded.baseFolder).toBe(chosen);
    expect(reloaded.baseFolderChosen).toBe(true);
  });

  test('the default is NOT written to disk on read', async () => {
    // An unsaved default stays derived, so it keeps tracking the environment
    // until the operator actually chooses somewhere.
    const s = store();
    await s.load();
    expect(s.baseFolder).toBeTruthy();
    await expect(fs.access(file)).rejects.toThrow();
  });

  test('an empty folder is refused rather than stored', async () => {
    const s = store();
    await s.load();
    await expect(s.setBaseFolder('   ')).rejects.toThrow(/required/i);
  });

  test('redacted() carries the folder for the setup form', async () => {
    const s = store();
    await s.load();
    const view = s.redacted();
    expect(view.baseFolder).toBe(path.resolve('/documents/noobly Wiki'));
    expect(view.defaultBaseFolder).toBe(path.resolve('/documents/noobly Wiki'));
    expect(view.baseFolderChosen).toBe(false);
  });
});

describe('daemon: StateManager.rebase (moving a mirror)', () => {
  let dir;
  let stateFile;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-state-'));
    stateFile = path.join(dir, '.daemon-state-test.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const quietLog = { info() {}, warn() {}, error() {} };

  /** Track one file without hashing it off disk. */
  const track = (sm, local, remote) => sm.trackFile(local, remote, 'hash-' + remote);

  test('every tracked local path follows the move, both ways round', async () => {
    const from = path.join(dir, 'old', 'Engineering Space');
    const to = path.join(dir, 'new', 'Engineering Space');

    const sm = new StateManager(stateFile, { log: quietLog });
    await sm.load();
    await track(sm, path.join(from, 'a.md'), 'a.md');
    await track(sm, path.join(from, 'deep', 'b.md'), 'deep/b.md');

    expect(await sm.rebase(from, to)).toBe(2);

    // Tracking is keyed by absolute local path, so a move that did not rebase
    // would make every document look untracked and re-download the folder.
    expect(sm.isFileTracked(path.join(to, 'a.md'))).toBe(true);
    expect(sm.isFileTracked(path.join(from, 'a.md'))).toBe(false);
    expect(sm.getFilePath('deep/b.md')).toBe(sm.normalizeLocalPath(path.join(to, 'deep', 'b.md')));
    expect(sm.getRemotePath(path.join(to, 'deep', 'b.md'))).toBe('deep/b.md');
  });

  test('a sibling whose name merely starts the same is left alone', async () => {
    const from = path.join(dir, 'Reports');
    const sibling = path.join(dir, 'Reports Archive');

    const sm = new StateManager(stateFile, { log: quietLog });
    await sm.load();
    await track(sm, path.join(from, 'a.md'), 'a.md');
    await track(sm, path.join(sibling, 'b.md'), 'archive/b.md');

    expect(await sm.rebase(from, path.join(dir, 'moved'))).toBe(1);
    expect(sm.isFileTracked(path.join(sibling, 'b.md'))).toBe(true);
  });

  test('rebasing onto the same directory changes nothing', async () => {
    const from = path.join(dir, 'same');
    const sm = new StateManager(stateFile, { log: quietLog });
    await sm.load();
    await track(sm, path.join(from, 'a.md'), 'a.md');
    expect(await sm.rebase(from, from)).toBe(0);
    expect(sm.isFileTracked(path.join(from, 'a.md'))).toBe(true);
  });

  test('the rebase is persisted, since the move is not repeatable', async () => {
    const from = path.join(dir, 'old');
    const to = path.join(dir, 'new');
    const sm = new StateManager(stateFile, { log: quietLog });
    await sm.load();
    await track(sm, path.join(from, 'a.md'), 'a.md');
    await sm.rebase(from, to);

    const reloaded = new StateManager(stateFile, { log: quietLog });
    await reloaded.load();
    expect(reloaded.isFileTracked(path.join(to, 'a.md'))).toBe(true);
  });
});
