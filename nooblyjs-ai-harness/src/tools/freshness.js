// The "read before you write" rule, shared by Write and Edit.
//
// If the model could overwrite a file it never looked at, it would happily
// replace your code with its guess of what the file contains. And if the file
// changed after it was read (you edited it, or a command did), the model's
// picture is out of date. Both cases are refused with a message that tells the
// model exactly what to do: Read the file (again).
import fs from 'node:fs/promises';
import { ToolError } from './tool.js';

export async function assertReadAndUnchanged(ctx, fullPath, shownPath) {
  const readAt = ctx.session.readFiles.get(fullPath);
  if (readAt === undefined) {
    throw new ToolError(`You must Read ${shownPath} before changing it. Use the Read tool first.`);
  }
  const { mtimeMs } = await fs.stat(fullPath);
  if (mtimeMs !== readAt) {
    throw new ToolError(`${shownPath} has changed since you last read it. Read it again before changing it.`);
  }
}

/** After we change a file, record its new modification time, so the next edit is allowed. */
export async function rememberWrite(ctx, fullPath) {
  const { mtimeMs } = await fs.stat(fullPath);
  ctx.session.readFiles.set(fullPath, mtimeMs);
}
