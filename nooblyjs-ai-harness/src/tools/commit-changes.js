// Phase 25: writing a set of file changes, the way every editing tool must:
// checkpoint first (Phase 21), feedback baseline (Phase 24), write or delete,
// remember the new version for read-before-write (Phase 05), then check.
// MultiEdit and ApplyPatch compute ALL changes in memory first, and only then
// call this: if any part of the edit is wrong, no file has been touched.
import fs from 'node:fs/promises';
import path from 'node:path';
import { rememberWrite } from './freshness.js';

/**
 * @param {Array<{ fullPath: string, shown: string, content: string | null }>} changes  content null = delete
 * @returns {Promise<{ notes: string[], problems: number }>}
 */
export async function commitChanges(ctx, changes) {
  const notes = [];
  let problems = 0;
  for (const change of changes) {
    await ctx.session?.checkpoints?.beforeWrite(change.fullPath);
    if (change.content === null) {
      await fs.rm(change.fullPath);
      ctx.session?.readFiles?.delete(change.fullPath);
      continue;
    }
    await ctx.session?.feedback?.before(change.fullPath);
    await fs.mkdir(path.dirname(change.fullPath), { recursive: true });
    await fs.writeFile(change.fullPath, change.content, 'utf8');
    if (ctx.session?.readFiles) await rememberWrite(ctx, change.fullPath);
    const feedback = await ctx.session?.feedback?.after(change.fullPath);
    if (feedback?.note) notes.push(feedback.note);
    problems += feedback?.count ?? 0;
  }
  return { notes, problems };
}
