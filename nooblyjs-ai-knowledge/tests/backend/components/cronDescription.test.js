'use strict';

/**
 * Cron expressions in the datasources UI: reading them, and refusing the ones
 * this app cannot actually schedule.
 *
 * The Workflows screen's Schedule button asks for a cron expression and nothing
 * else — the schedule's NAME is derived from it, "<workflow> - <cron in
 * English>" — so `describeCron` is not decoration: it is what the record on disk
 * ends up called, and what a reader scans the Schedules list for.
 *
 * The sharp edge is that READABLE and ACCEPTABLE are two different questions.
 * `0 8 * * MON-FRI` reads perfectly, and cron implementations at large accept
 * it, but BOTH validators a create request meets here are numeric-only with
 * day-of-week 0-6:
 *
 *   - `workflowBridge.validateCronExpression` (CRON_FIELDS, dayOfWeek max 6),
 *     which runs BEFORE the schedule is pushed, so the POST answers 400 and
 *     nothing is created; and
 *   - core's `scheduling/providers/cronExpression.js`, which `startCron` calls
 *     when the schedule is activated.
 *
 * The Schedules screen's own hint row advertised `0 8 * * MON-FRI` for exactly
 * as long as nobody typed it. So rather than restating the dialect in a third
 * place, this suite runs every expression through the two REAL validators and
 * asserts the browser-side `cronRejection` reaches the same verdict — and that
 * every expression either screen puts in front of a user survives all three.
 *
 * `describeCron` itself stays deliberately LENIENT: it also has to phrase
 * expressions already on disk, written by an older UI that allowed names.
 *
 * util.js is a browser script, so it is evaluated here in a `vm` with a stub
 * window — the same approach navChainCollapse.test.js uses for navigation-core.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.resolve(__dirname, '../../../src/web/datasources/public/js');
const UTIL = path.join(WEB, 'core/util.js');
const WORKFLOWS = path.join(WEB, 'screens/workflows.js');
const SCHEDULES = path.join(WEB, 'screens/schedules.js');
const BRIDGE = path.resolve(__dirname, '../../../src/datasources/lib/workflowBridge.js');

/** util.js defines globals on `window`; give it just enough of one. */
function loadUtil() {
  const ctx = {
    console,
    document: {
      addEventListener() {},
      getElementById: () => null,
      createElement: () => ({ style: {}, appendChild() {} }),
    },
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(UTIL, 'utf8'), ctx, { filename: 'util.js' });
  return ctx.window.DS.util;
}

/**
 * workflowBridge.js pulls in the whole datasources stack, and the validator is
 * a pure method — so lift it out by source rather than construct a bridge.
 */
function loadBridgeValidator() {
  const source = fs.readFileSync(BRIDGE, 'utf8');
  const lift = (name) => {
    const at = source.indexOf(`\n  ${name}(`);
    if (at === -1) throw new Error(`workflowBridge.${name} not found — has it been renamed?`);
    const open = source.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) {
        return source.slice(source.indexOf(name, at), i + 1);
      }
    }
    throw new Error(`workflowBridge.${name} is unbalanced`);
  };

  // Mirrors the module-level CRON_FIELDS the lifted methods close over.
  const CRON_FIELDS = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'dayOfMonth', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'dayOfWeek', min: 0, max: 6 },
  ];
  const lifted = vm.runInNewContext(
    `({ CRON_FIELDS, ${lift('validateCronExpression')}, ${lift('_validateCronField')} })`,
    { CRON_FIELDS }
  );
  return (expr) => {
    try { lifted.validateCronExpression(expr); return true; } catch (_err) { return false; }
  };
}

const { describeCron, cronRejection } = loadUtil();
const bridgeAccepts = loadBridgeValidator();
const { isValid: coreAccepts } = require('nooblyjs-core/src/scheduling/providers/cronExpression');

/** Both real gates a create request passes through. */
const backendAccepts = (expr) => bridgeAccepts(expr) && coreAccepts(expr);

/** The expressions each screen puts in front of a user. */
function offeredExpressions() {
  const workflows = fs.readFileSync(WORKFLOWS, 'utf8');
  const block = workflows.slice(workflows.indexOf('QUICK_CRON_PRESETS = ['));
  const presets = [...block.slice(0, block.indexOf('];')).matchAll(/\['([^']+)',\s*'([^']+)'\]/g)]
    .map((m) => ({ expr: m[1], label: m[2], where: 'Workflows quick-schedule preset' }));

  const hints = [...fs.readFileSync(SCHEDULES, 'utf8').matchAll(/codeBit\('([^']+)'\)/g)]
    .map((m) => ({ expr: m[1], label: m[1], where: 'Schedules cron hint' }));

  return { presets, hints };
}

describe('describeCron', () => {
  test.each([
    ['* * * * *', 'Every minute'],
    ['*/5 * * * *', 'Every 5 minutes'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Hourly'],
    ['30 * * * *', 'Hourly at :30'],
    ['0,30 * * * *', 'Hourly at :00, :30'],
    ['0 */2 * * *', 'Every 2 hours'],
    ['15 */6 * * *', 'Every 6 hours at :15'],
    ['0 2 * * *', 'Daily at 02:00'],
    ['30 6 * * *', 'Daily at 06:30'],
    ['0 0 * * *', 'Daily at 00:00'],
    ['0 6,18 * * *', 'Daily at 06:00, 18:00'],
    ['0 8 * * 1-5', 'Weekdays at 08:00'],
    ['0 9 * * 0,6', 'Weekends at 09:00'],
    ['0 9 * * 1', 'Mondays at 09:00'],
    ['0 9 * * 1,3,5', 'Mon, Wed, Fri at 09:00'],
    ['0 0 1 * *', 'Day 1 of the month at 00:00'],
    ['0 0 1,15 * *', 'Days 1, 15 of the month at 00:00'],
    ['0 0 1 1 *', 'Day 1 of the month at 00:00 in January'],
    ['0 * * * 1-5', 'Hourly on weekdays'],
    ['*/10 9-17 * * 1-5', 'Every 10 minutes during 09:00–17:59 on weekdays'],
    ['0 12 1 */3 *', 'Day 1 of the month at 12:00 every 3 months'],
  ])('reads %s as "%s"', (expr, expected) => {
    expect(describeCron(expr)).toBe(expected);
  });

  test('a step is not "every" — the distinction a 5-minute schedule depends on', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
    expect(describeCron('* * * * *')).toBe('Every minute');
  });

  test.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['not a cron', 'prose'],
    ['0 2 * *', 'four fields'],
    ['0 2 * * * *', 'six fields'],
    ['60 2 * * *', 'minute out of range'],
    ['0 24 * * *', 'hour out of range'],
    ['0 2 0 * *', 'day-of-month out of range'],
    ['0 2 32 * *', 'day-of-month too high'],
    ['0 2 * 13 *', 'month out of range'],
    ['*/0 * * * *', 'zero step'],
    ['0 5-2 * * *', 'inverted range'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('answers null for %s (%s)', (expr) => {
    expect(describeCron(expr)).toBeNull();
  });

  test('stays lenient about names, so a legacy record still reads', () => {
    // Written by an older UI that offered MON-FRI. It can no longer be CREATED
    // (see cronRejection below), but one already on disk must still be phrased.
    expect(describeCron('0 8 * * MON-FRI')).toBe('Weekdays at 08:00');
    expect(describeCron('5 4 * * sun')).toBe('Sundays at 04:05');
    expect(describeCron('0 9 * * 7')).toBe('Sundays at 09:00');
  });
});

describe('cronRejection agrees with the validators a create request actually meets', () => {
  const CORPUS = [
    '* * * * *', '*/5 * * * *', '*/15 * * * *', '0 * * * *', '30 * * * *', '0,30 * * * *',
    '0 */2 * * *', '15 */6 * * *', '0 2 * * *', '0 1 * * *', '30 6 * * *', '0 0 * * *',
    '0 8 * * 1-5', '0 9 * * 0,6', '0 9 * * 1', '0 9 * * 1,3,5', '0 0 1 * *', '0 0 1,15 * *',
    '0 0 1 1 *', '0 6,18 * * *', '*/10 9-17 * * 1-5', '0 * * * 1-5', '0 12 1 */3 *',
    // dialect traps: readable everywhere, refused here
    '0 8 * * MON-FRI', '5 4 * * sun', '0 9 * * SUN', '0 0 1 JAN *', '0 9 * * 7',
    // plain rubbish
    '', '   ', 'not a cron', '0 2 * *', '0 2 * * * *', '60 2 * * *', '0 24 * * *',
    '0 2 0 * *', '*/0 * * * *', '0 5-2 * * *', '0 2 32 * *', '0 2 * 13 *',
  ];

  test.each(CORPUS)('%s reaches the same verdict on both sides', (expr) => {
    expect(Boolean(cronRejection(expr))).toBe(!backendAccepts(expr));
  });

  test('the two backend validators agree with each other', () => {
    // If they ever diverge the UI cannot satisfy both, and a schedule would be
    // created that never activates (or vice versa).
    for (const expr of CORPUS) {
      expect(`${expr} -> ${bridgeAccepts(expr)}`).toBe(`${expr} -> ${coreAccepts(expr)}`);
    }
  });

  test('names and a 7 for Sunday are refused with a reason that names the fix', () => {
    expect(cronRejection('0 8 * * MON-FRI')).toMatch(/numbers, not names/);
    expect(cronRejection('0 9 * * 7')).toMatch(/Sunday is 0/);
    expect(cronRejection('not a cron')).toBe('Not a valid cron expression');
    expect(cronRejection('0 2 * * *')).toBeNull();
  });
});

describe('every expression the UI offers can actually be created', () => {
  const { presets, hints } = offeredExpressions();

  test('the quick-schedule modal offers four presets and the hint row five', () => {
    expect(presets).toHaveLength(4);
    expect(hints.length).toBeGreaterThanOrEqual(5);
  });

  test.each([...presets, ...hints].map((o) => [o.where, o.label, o.expr]))(
    '%s "%s" (%s) survives both backend validators and the UI check',
    (_where, _label, expr) => {
      expect(backendAccepts(expr)).toBe(true);
      expect(cronRejection(expr)).toBeNull();
      expect(describeCron(expr)).toEqual(expect.any(String));
    }
  );
});
