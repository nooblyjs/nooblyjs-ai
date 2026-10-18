'use strict';

/**
 * Tests for the Entra (Azure AD) profile-photo sync and the shared avatar store
 * it writes through. Graph and the token endpoint are stubbed via global.fetch;
 * the filesystem uses a real temp directory acting as appBaseDir.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs').promises;

const avatarStore = require('../../../src/shared/auth/avatarStore');
const { syncEntraAvatar, _resetTokenCache } = require('../../../src/shared/auth/entraAvatar');

const EMAIL = 'Jane.Doe@Company.com';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

/** A minimal fetch stub: first call = token endpoint, subsequent = Graph photo. */
function makeFetch({ photoStatus = 200, photoBody = PNG_BYTES, contentType = 'image/png', etag } = {}) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/oauth2/v2.0/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'app-token', expires_in: 3600 })
      };
    }
    // Graph photo endpoint
    const headers = new Map([['content-type', contentType]]);
    if (etag) headers.set('etag', etag);
    return {
      ok: photoStatus >= 200 && photoStatus < 300,
      status: photoStatus,
      headers: { get: (k) => headers.get(String(k).toLowerCase()) || null },
      arrayBuffer: async () => photoBody.buffer.slice(photoBody.byteOffset, photoBody.byteOffset + photoBody.byteLength)
    };
  };
  fn.calls = calls;
  return fn;
}

describe('entraAvatar.syncEntraAvatar', () => {
  let appBaseDir;
  const realFetch = global.fetch;
  const silentLog = { info: () => {}, warn: () => {} };

  beforeEach(async () => {
    appBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatartest-'));
    process.env.AZURE_AD_CLIENT_ID = 'client';
    process.env.AZURE_AD_SECRET = 'secret';
    process.env.AZURE_AD_TENANT_ID = 'tenant';
    _resetTokenCache();
  });

  afterEach(async () => {
    global.fetch = realFetch;
    delete process.env.AZURE_AD_CLIENT_ID;
    delete process.env.AZURE_AD_SECRET;
    delete process.env.AZURE_AD_TENANT_ID;
    await fs.rm(appBaseDir, { recursive: true, force: true });
  });

  test('stores the Graph photo into the shared avatar store, marked source=entra', async () => {
    global.fetch = makeFetch({ etag: 'W/"v1"' });

    const result = await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });
    expect(result.updated).toBe(true);

    // Written where uploaded pictures live, under the same email-derived key.
    const stored = await avatarStore.resolveAvatarPath(appBaseDir, EMAIL);
    expect(stored).not.toBeNull();
    expect(path.basename(stored)).toBe(`${avatarStore.keyOf(EMAIL)}.png`);

    const marker = await avatarStore.readMarker(appBaseDir, EMAIL);
    expect(marker.source).toBe('entra');
    expect(marker.etag).toBe('W/"v1"');
  });

  test('prefers azureId (oid) over email for the Graph lookup', async () => {
    const fetchStub = makeFetch();
    global.fetch = fetchStub;

    await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });

    const graphCall = fetchStub.calls.find((c) => c.url.includes('graph.microsoft.com'));
    expect(graphCall.url).toContain('/users/oid-123/photo/$value');
  });

  test('never overwrites a user-uploaded picture', async () => {
    // Simulate an existing uploaded avatar.
    await avatarStore.saveAvatar(appBaseDir, EMAIL, '.jpg', Buffer.from([1, 2, 3]), 'upload');
    global.fetch = makeFetch();

    const result = await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });
    expect(result.skipped).toBe('user-upload');

    // Original upload untouched; no Graph call was even made.
    const stored = await avatarStore.resolveAvatarPath(appBaseDir, EMAIL);
    expect(path.basename(stored)).toBe(`${avatarStore.keyOf(EMAIL)}.jpg`);
  });

  test('does not clobber a pre-existing image that predates the marker', async () => {
    // An image with NO provenance marker (installed before this feature existed).
    await fs.mkdir(avatarStore.imagesDir(appBaseDir), { recursive: true });
    await fs.writeFile(path.join(avatarStore.imagesDir(appBaseDir), `${avatarStore.keyOf(EMAIL)}.png`), Buffer.from([9, 9]));
    global.fetch = makeFetch();

    const result = await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });
    expect(result.skipped).toBe('pre-existing');
  });

  test('treats a 404 (no Graph photo) as a clean skip', async () => {
    global.fetch = makeFetch({ photoStatus: 404 });
    const result = await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });
    expect(result.skipped).toBe('no-photo');
    expect(await avatarStore.resolveAvatarPath(appBaseDir, EMAIL)).toBeNull();
  });

  test('an unchanged photo (304) is not re-written', async () => {
    // Seed an existing entra-sourced avatar with an etag.
    await avatarStore.saveAvatar(appBaseDir, EMAIL, '.png', PNG_BYTES, 'entra', { etag: 'W/"v1"' });
    global.fetch = makeFetch({ photoStatus: 304 });

    const result = await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });
    expect(result.updated).toBe(false);
    expect(result.reason).toBe('unchanged');
  });

  test('skips cleanly when Azure is not configured', async () => {
    delete process.env.AZURE_AD_CLIENT_ID;
    global.fetch = makeFetch();
    const result = await syncEntraAvatar({ appBaseDir, email: EMAIL, azureId: 'oid-123', log: silentLog });
    expect(result.skipped).toBe('not-configured');
  });
});
