// @ts-check
// Phase F11: matching paths against simple globs ("src/auth/**", "*.sql", "config/*.json").
//
//   **   any number of folders (including none)
//   *    anything except "/"
//   ?    one character except "/"
// A pattern without "/" matches the file name anywhere ("*.sql" matches "db/x.sql").

/** @param {string} pattern */
export function globToRegExp(pattern) {
  const p = pattern.replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      re += p[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += p[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(p.includes('/') ? `^${re}$` : `(^|/)${re}$`);
}

/** Does `file` match any of `patterns`? */
export function matchesAny(file, patterns) {
  return patterns.some((p) => globToRegExp(p).test(file));
}
