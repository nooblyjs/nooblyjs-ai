import { getUser } from './lib/users.js';

// Uses getUser for every id.
export function report(ids) {
  return ids.map((id) => getUser(id)).join(', ');
}
