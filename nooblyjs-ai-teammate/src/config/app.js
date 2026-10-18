// Fixed settings for Teammates: where it mounts, where its browser files are, and the nooblyjs-core pages it links to.
// The Content-Security-Policy is the host's (one page, one policy). Settings that come from the environment (AI_PROVIDER,
// SESSION_SECRET, LOG_LEVEL, …) are read where they are used; NooblyJS passes the mount path and data folder.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MOUNT_PATH = '/teammates';
export const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

// nooblyjs-core's sign-in pages, linked from the app's own page while it runs in "document" mode.
export const LOGIN_PATH = '/services/authservice/views/login.html';
export const PROFILE_PATH = '/services/authservice/views/profile.html';
export const USERS_PATH = '/services/authservice/';

/** '/teammates', or another single path such as '/teammates-2'. */
export function checkMountPath(mountPath) {
  if (/^(\/[A-Za-z0-9._~-]+)+$/.test(mountPath ?? '')) return mountPath;
  throw new Error(`The Teammates mount path must look like /teammates, not "${mountPath}".`);
}
