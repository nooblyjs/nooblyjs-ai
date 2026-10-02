// @ts-check
// Phase F03: an issue written as a Markdown file.
//
//   ---
//   title: Add a greeting file
//   labels: [factory, docs]
//   ---
//   Please add GREETING.md that welcomes new contributors.
//
// No frontmatter? The first "# heading" (or the first line) is the title.
import { parseFrontmatter } from '../util/frontmatter.js';

/** @returns {{ title: string, body: string, labels: string[], priority?: string }} */
export function parseIssue(text) {
  const { data, body } = parseFrontmatter(text);
  let title = typeof data.title === 'string' ? data.title.trim() : '';
  let rest = body;
  if (!title) {
    const lines = body.split('\n');
    const first = lines.findIndex((l) => l.trim());
    title = (lines[first] ?? '').replace(/^#+\s*/, '').trim();
    rest = lines.slice(first + 1).join('\n');
  }
  if (!title) throw new Error('The issue has no title: add "title:" frontmatter or a first line.');
  const labels = Array.isArray(data.labels) ? data.labels : data.labels ? [String(data.labels)] : [];
  // Phase F06: "priority: high" in the frontmatter (only present when given).
  return { title, body: rest.trim(), labels, ...(data.priority !== undefined && { priority: String(data.priority) }) };
}
