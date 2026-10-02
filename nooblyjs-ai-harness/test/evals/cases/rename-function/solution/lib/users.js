const USERS = { 1: 'Ada', 2: 'Grace' };

export function getUser(id) {
  return USERS[id] ?? 'unknown';
}
