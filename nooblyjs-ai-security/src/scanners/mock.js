// The mock scanner (root design.md §9: "the seed's findings, e.g. an unapproved chart library"). It reads the files it
// is given with a few plain rules, so the seed story and the tests have something to find; it is not a security tool
// and every result says it came from the mock. Phase 21: DAST and the image scan look at an environment, not files: a
// web app's preview answers without a Content-Security-Policy header (the mock calls nothing; it is the seed story's
// finding), and the mock provisioner builds no image, so there is nothing to scan.
//
// A finding: { kind, rule, severity, title, file, line, fingerprint, detail, fix? }. The fingerprint names the problem,
// not where it was seen, so the same problem in a later scan is the same finding.

const SECRET_RULES = [
  { rule: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/, title: 'An AWS access key is in the code' },
  { rule: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, title: 'A private key is in the code' },
  { rule: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, title: 'A Slack token is in the code' },
];
const SAST_RULES = [
  { rule: 'eval', re: /\beval\s*\(/, severity: 'high', title: 'eval() runs text as code' },
  { rule: 'new-function', re: /\bnew Function\s*\(/, severity: 'high', title: 'new Function() runs text as code' },
];
const CODE = /\.(c|m)?(j|t)sx?$/;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The package.json dependencies (runtime and development), as { name, version }. */
export function dependenciesOf(files) {
  const pkg = files.find((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
  if (!pkg) return [];
  try {
    const json = JSON.parse(pkg.text);
    return Object.entries({ ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) }).map(([name, version]) => ({ name, version: String(version), file: pkg.path }));
  } catch {
    return [];
  }
}

export function createMockScanner() {
  const byKind = {
    secrets(target) {
      const out = [];
      for (const f of target.files) for (const r of SECRET_RULES) {
        const m = r.re.exec(f.text);
        if (m) out.push({ rule: r.rule, severity: 'critical', title: r.title, file: f.path, line: lineOf(f.text, m.index), fingerprint: `secrets:${target.repo}:${r.rule}:${f.path}`, detail: `${r.title} (${f.path}:${lineOf(f.text, m.index)}). Rotate it, then remove it.` });
      }
      return out;
    },
    sast(target) {
      const out = [];
      for (const f of target.files.filter((x) => CODE.test(x.path))) for (const r of SAST_RULES) {
        const m = r.re.exec(f.text);
        if (m) out.push({ rule: r.rule, severity: r.severity, title: `${r.title} in ${f.path}`, file: f.path, line: lineOf(f.text, m.index), fingerprint: `sast:${target.repo}:${r.rule}:${f.path}`, detail: `${r.title} (${f.path}:${lineOf(f.text, m.index)}).` });
      }
      return out;
    },
    sca(target, policies) {
      const approved = new Set(policies.sca?.approved ?? []);
      return dependenciesOf(target.files).filter((d) => !approved.has(d.name)).map((d) => ({
        rule: 'unapproved-package', severity: policies.sca?.unapprovedSeverity ?? 'medium',
        title: `${d.name} is not an approved package`, file: d.file, line: null, fingerprint: `sca:${target.repo}:${d.name}`,
        detail: `${target.repo} depends on ${d.name} ${d.version}, which is not on Security's approved list. Use an approved package, or ask for ${d.name} to be approved.`,
        fix: { title: `Remove ${d.name}`, brief: `${d.name} is not an approved package. Do what it was added for without it (or with an approved package), and take it out of package.json.` },
      }));
    },
    licence(target, policies) {
      const denied = new Set(policies.licence?.denied ?? []);
      const known = policies.licence?.known ?? {};
      return dependenciesOf(target.files).filter((d) => denied.has(known[d.name])).map((d) => ({
        rule: 'denied-licence', severity: 'high', title: `${d.name} is licensed ${known[d.name]}, which is not allowed`, file: d.file, line: null,
        fingerprint: `licence:${target.repo}:${d.name}`, detail: `${d.name} ${d.version} is under ${known[d.name]}; licences not allowed: ${[...denied].join(', ')}.`,
        fix: { title: `Remove ${d.name}`, brief: `${d.name} is licensed ${known[d.name]}, which is not allowed. Replace it.` },
      }));
    },
    iac(target) {
      const out = [];
      for (const f of target.files.filter((x) => /\.(tf|ya?ml)$/.test(x.path))) {
        const i = f.text.indexOf('0.0.0.0/0');
        if (i >= 0) out.push({ rule: 'open-to-internet', severity: 'high', title: `${f.path} opens a port to the whole internet`, file: f.path, line: lineOf(f.text, i), fingerprint: `iac:${target.repo}:open-to-internet:${f.path}`, detail: `0.0.0.0/0 in ${f.path}:${lineOf(f.text, i)}. Allow only the addresses that need it.` });
      }
      return out;
    },
    image: () => [],
    dast(target) {
      if (!target.environment || !/web|storefront|console/i.test(String(target.repo ?? ''))) return [];
      return [{
        rule: 'csp-missing', severity: 'medium', title: `${target.repo} answers without a Content-Security-Policy header`, file: null, line: null,
        fingerprint: `dast:${target.repo}:csp-missing`,
        detail: `The dynamic scan of ${target.environment}${target.url ? ` (${target.url})` : ''} found pages served without a Content-Security-Policy header, so an injected script would run. Send one that allows only the app's own scripts.`,
        fix: { title: 'Send a Content-Security-Policy header', brief: 'Pages are served without a Content-Security-Policy header. Send one that allows only the app\'s own scripts and styles, with a test that checks it.' },
      }];
    },
  };
  return {
    name: 'mock',
    real: false,
    text: 'Mock scanner: plain rules over the changed files, for the sample story. It is not a real scan, and no result is a security assurance.',
    /** @returns {Array<object>} the findings, each with its kind */
    scan(kind, target, policies = {}) {
      const run = byKind[kind];
      if (!run) throw new Error(`The scanner has no kind "${kind}".`);
      return run(target, policies).map((f) => ({ kind, ...f }));
    },
    /** The SBOM of the change: the package.json dependencies with what is known of their licence (CycloneDX's fields, simplified). */
    sbom(target, policies = {}) {
      const known = policies.licence?.known ?? {};
      return { format: 'CycloneDX (simplified)', components: dependenciesOf(target.files).map((d) => ({ name: d.name, version: d.version, licence: known[d.name] ?? 'unknown' })) };
    },
  };
}
