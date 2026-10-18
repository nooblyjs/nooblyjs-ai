/**
 * @fileoverview Self-signed TLS certificate generator for local HTTPS.
 *
 * Generates a key/certificate pair under certs/ (repo root) so the app can run
 * over HTTPS in development. The certificate is valid for `localhost`,
 * `127.0.0.1` and `::1`.
 *
 * Usage:
 *   node scripts/generate-certs.js          # generate if missing
 *   node scripts/generate-certs.js --force  # overwrite existing certs
 *
 * NOTE: Self-signed certificates are for development only. Browsers will show
 * a security warning — accept it manually, or import certs/server.crt into the
 * OS/browser trust store. For production, use a CA-issued certificate and point
 * HTTPS_KEY_PATH / HTTPS_CERT_PATH at it.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const selfsigned = require('selfsigned');

const certsDir = path.join(__dirname, '..', 'certs');
const keyPath = path.join(certsDir, 'server.key');
const certPath = path.join(certsDir, 'server.crt');

const force = process.argv.includes('--force');
const VALID_DAYS = 825; // max lifetime accepted by modern browsers

async function main() {
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && !force) {
    console.log('Certificates already exist:');
    console.log(`  ${keyPath}`);
    console.log(`  ${certPath}`);
    console.log('Run with --force to regenerate.');
    return;
  }

  const attrs = [{ name: 'commonName', value: 'localhost' }];

  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setDate(notAfterDate.getDate() + VALID_DAYS);

  // selfsigned v5 exposes an async generator backed by the WebCrypto API.
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true
      },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS
          { type: 7, ip: '127.0.0.1' },    // IPv4
          { type: 7, ip: '::1' }           // IPv6
        ]
      }
    ]
  });

  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert);

  console.log(`Generated self-signed certificate (valid ${VALID_DAYS} days):`);
  console.log(`  Key:  ${keyPath}`);
  console.log(`  Cert: ${certPath}`);
  console.log('');
  console.log('Enable HTTPS by setting HTTPS_ENABLED=true in your .env file.');
}

main().catch((err) => {
  console.error('Failed to generate certificates:', err);
  process.exit(1);
});
