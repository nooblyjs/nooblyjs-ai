// Infrastructure code from a design (product.md §3.3). It is composed only from blueprints: every block is a module
// whose source is a blueprint and version. The text is what a pull request would carry; nothing here runs it.

function moduleBlock({ name, blueprint, version, args = {} }) {
  const entries = [['source', `"blueprints/${blueprint}/v${version}"`], ...Object.entries(args)];
  const width = Math.max(...entries.map(([key]) => key.length));
  return [`module "${name}" {`, ...entries.map(([key, value]) => `  ${key.padEnd(width)} = ${value}`), '}'].join('\n');
}

/** { path, text, pullRequest, repo } for one kind of environment. */
export function codeFor(design, kind) {
  const modules = (design.resources ?? []).filter((r) => r.module).map((r) => moduleBlock(r.module));
  return {
    path: `infra/${design.product}/${kind}`,
    text: modules.join('\n\n'),
    repo: design.code?.repo ?? null,
    pullRequest: design.code?.pullRequests?.[kind] ?? null,
  };
}
