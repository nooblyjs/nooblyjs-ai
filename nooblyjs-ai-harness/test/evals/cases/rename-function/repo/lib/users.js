const USERS = { 1: 'Ada', 2: 'Grace' };

export function getUsr(id) {
  return USERS[id] ?? 'unknown';
}
