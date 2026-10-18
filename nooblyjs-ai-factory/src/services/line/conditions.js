// @ts-check
// Phase F07: `when` conditions in a line: "run this station only if…".
//
//   "when": "triage.size == 'small'"
//   "when": "triage.kind != 'question' && tasks.count > 1"
//
// A line is CONFIG, and config must never be run as code: no eval(), no
// `new Function`. A line file that said `"when": "require('child_process')…"`
// must be a syntax error, not a program. So this is a tiny language with its
// own parser (recursive descent, ~80 lines):
//
//   expr    := and ( '||' and )*
//   and     := not ( '&&' not )*
//   not     := '!' not | compare
//   compare := value ( ('==' | '!=' | '<' | '<=' | '>' | '>=') value )?
//   value   := 'string' | number | true | false | null | path | '(' expr ')'
//   path    := name ( '.' name )*          looked up in the context; missing → undefined
//
// Parsing happens once, when the line is loaded, so a typo fails at load time
// with the position of the mistake, not in the middle of a run.

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|'([^']*)'|"([^"]*)"|(==|!=|<=|>=|&&|\|\||[<>!().])|([A-Za-z_][A-Za-z0-9_-]*))/y;

function tokenize(text) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(text);
    if (!m) throw new Error(`Cannot read "${text}" at position ${at}: "${text.slice(at, at + 10)}"`);
    if (m[1] !== undefined) tokens.push({ kind: 'value', value: Number(m[1]), at });
    else if (m[2] !== undefined || m[3] !== undefined) tokens.push({ kind: 'value', value: m[2] ?? m[3], at });
    else if (m[4] !== undefined) tokens.push({ kind: 'op', value: m[4], at });
    else tokens.push({ kind: 'name', value: m[5], at });
  }
  return tokens;
}

/**
 * Parse a condition into a function of a context object.
 * @param {string} text
 * @returns {(context: object) => boolean}
 */
export function compileCondition(text) {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const fail = (what) => {
    const t = peek();
    throw new Error(`Condition "${text}": expected ${what}${t ? ` at position ${t.at}` : ' at the end'}.`);
  };
  const eat = (op) => (peek()?.kind === 'op' && peek().value === op ? (i++, true) : false);

  const expr = () => {
    let left = and();
    while (eat('||')) {
      const a = left, b = and();
      left = (c) => a(c) || b(c);
    }
    return left;
  };
  const and = () => {
    let left = not();
    while (eat('&&')) {
      const a = left, b = not();
      left = (c) => a(c) && b(c);
    }
    return left;
  };
  const not = () => {
    if (eat('!')) {
      const inner = not();
      return (c) => !inner(c);
    }
    return compare();
  };
  // A missing path is undefined; in a config language "missing" and "null" should mean the same.
  const same = (a, b) => (a ?? null) === (b ?? null);
  const COMPARE = { '==': (a, b) => same(a, b), '!=': (a, b) => !same(a, b), '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
  const compare = () => {
    const left = value();
    const t = peek();
    if (t?.kind === 'op' && COMPARE[t.value]) {
      i++;
      const right = value();
      const fn = COMPARE[t.value];
      return (c) => fn(left(c), right(c));
    }
    return (c) => Boolean(left(c));
  };
  const value = () => {
    const t = peek();
    if (!t) return fail('a value');
    if (eat('(')) {
      const inner = expr();
      if (!eat(')')) fail('")"');
      return inner;
    }
    if (t.kind === 'value') return (i++, () => t.value);
    if (t.kind === 'name') {
      i++;
      if (t.value === 'true' || t.value === 'false' || t.value === 'null') {
        const literal = { true: true, false: false, null: null }[t.value];
        return () => literal;
      }
      const parts = [t.value];
      while (eat('.')) {
        const next = peek();
        if (next?.kind !== 'name') fail('a name after "."');
        parts.push(next.value);
        i++;
      }
      return (c) => parts.reduce((obj, key) => (obj == null ? undefined : obj[key]), c);
    }
    return fail('a value');
  };

  const fn = expr();
  if (i < tokens.length) fail('the end, or && / ||');
  return fn;
}
