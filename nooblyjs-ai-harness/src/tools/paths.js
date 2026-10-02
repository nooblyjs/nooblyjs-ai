// Keep file tools inside the project directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from './tool.js';

/** True if `target` is `root` or somewhere inside it. Both must be real (symlink-free) paths. */
export function isInside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Turn a path from the model into a real absolute path of an EXISTING file,
 * and refuse it if it points outside the project. `realpath` follows symlinks,
 * so a link inside the project that points to /etc is caught too.
 */
export async function resolveInsideProject(filePath, cwd, extraRoots = []) {
  const root = await fs.realpath(cwd);
  let real;
  try {
    real = await fs.realpath(path.resolve(cwd, filePath));
  } catch (error) {
    if (error.code === 'ENOENT') throw new ToolError(`File not found: ${filePath}. Check the path (it is relative to ${cwd}).`);
    throw error;
  }
  if (!isInside(real, root) && !(await insideAny(real, extraRoots))) {
    throw new ToolError(`${filePath} is outside the project directory (${root}), so it can't be accessed.`);
  }
  return real;
}

/** Is `real` inside one of these extra folders (e.g. a skill or memory folder in ~/.noobly)? */
async function insideAny(real, roots) {
  for (const root of roots) {
    // A folder that doesn't exist yet (the first memory) is compared as written.
    const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
    if (isInside(real, realRoot)) return true;
  }
  return false;
}

/**
 * Like resolveInsideProject, but the file does not have to exist yet (for Write).
 * We check the nearest folder that DOES exist, so a symlinked folder can't
 * smuggle a new file outside the project either.
 */
export async function resolveForWrite(filePath, cwd, extraRoots = []) {
  const root = await fs.realpath(cwd);
  const target = path.resolve(cwd, filePath);

  let existing = target;
  const missing = [];
  while (true) {
    try {
      existing = await fs.realpath(existing);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(existing));
      existing = path.dirname(existing);
    }
  }

  const real = path.join(existing, ...missing);
  if ((!isInside(real, root) || real === root) && !(await insideAny(real, extraRoots))) {
    throw new ToolError(`${filePath} is outside the project directory (${root}), so it can't be written.`);
  }
  return real;
}
