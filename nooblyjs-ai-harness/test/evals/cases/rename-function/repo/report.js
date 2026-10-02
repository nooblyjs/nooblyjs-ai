import { getUsr } from './lib/users.js';

// Uses getUsr for every id.
export function report(ids) {
  return ids.map((id) => getUsr(id)).join(', ');
}
