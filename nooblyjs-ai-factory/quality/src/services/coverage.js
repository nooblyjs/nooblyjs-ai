// Phase 20: COVERAGE (root product.md §3.6: "coverage is a fact"). For an item, each of its features and each story,
// every acceptance criterion is counted three ways, in words:
//
//   with a ready test case    a case a test analyst marked ready, written for the criterion as it reads now
//   with an automated test    an automated case of it found in the latest test run's commit (passing, failing or not proven)
//   with a passing test       the latest test run of the story passes an automated case of it
//
// "1 of 3 criteria have a passing test (Build)". Build is the level the line's runs are at; environment runs join in
// Phase 21. Nothing here is stored: it is read from the test analysis, the test runs and Design's stories.
import { criterionRef } from './runs.js';

const PRESENT = new Set(['passing', 'failing', 'unproven']);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const have = (n, total, what) => `${n} of ${plural(total, 'criterion', 'criteria')} ${n === 1 && total === 1 ? 'has' : 'have'} ${what}`;

/** The three counts of a list of criterion rows, in words. */
function tally(rows) {
  const n = rows.length;
  const ready = rows.filter((r) => r.ready).length;
  const automated = rows.filter((r) => r.automated).length;
  const passing = rows.filter((r) => r.passing).length;
  return {
    criteria: n, ready, automated, passing, changed: rows.filter((r) => r.changed).length,
    text: n ? `${have(passing, n, 'a passing test')} (Build)` : 'No acceptance criteria yet',
    detail: n ? `${ready} with a ready test case · ${automated} with an automated test · ${passing} with a passing test` : '',
  };
}

export function createCoverage({ host, analysis, runs }) {
  const workflows = () => host.service?.('workflows') ?? null;

  /** One story: each criterion, from its test analysis and its latest test run. */
  async function storyCoverage(story, design) {
    const view = await analysis.view(story.id).catch(() => null);
    const designed = design?.stories?.find((s) => s.id === story.id) ?? null;
    const criteria = designed?.criteria ?? view?.criteria?.map((c) => c.text) ?? [];
    const latest = (await runs.list({ storyId: story.id }))[0] ?? null;
    const cases = view?.cases ?? [];
    const result = (id) => latest?.cases?.find((c) => c.id === id)?.status ?? null;
    const rows = criteria.map((text, i) => {
      const own = cases.filter((c) => c.criterion === i);
      const auto = own.filter((c) => c.automate !== false);
      return {
        ref: criterionRef(story.id, i), text, cases: own.map((c) => c.id),
        ready: own.some((c) => c.status === 'ready' && !c.criterionChanged),
        automated: auto.some((c) => PRESENT.has(result(c.id))),
        passing: auto.some((c) => result(c.id) === 'passing'),
        changed: own.some((c) => c.criterionChanged),
      };
    });
    return {
      id: story.id, ref: story.ref ?? story.id, title: designed?.title ?? story.title, stage: story.stage, feature: designed?.feature ?? story.feature?.id ?? null,
      analysed: Boolean(view?.drafted), ...tally(rows), rows,
      latestRun: latest ? { id: latest.id, status: latest.status, at: latest.at, text: latest.text } : null,
      href: `/factory/quality/test-analysis/${encodeURIComponent(story.id)}`,
    };
  }

  /** Coverage of an item across its stories and features (or of one story). */
  async function coverageOf(itemId) {
    const w = workflows();
    const item = await w?.item?.({ itemId }).catch(() => null);
    if (!item) return null;
    const parentId = item.type === 'story' ? item.parentId : item.id;
    const stories = item.type === 'story' ? [item] : ((await w?.storiesOf?.({ itemId }).catch(() => [])) ?? []).filter((s) => s.status !== 'withdrawn');
    const design = parentId ? await Promise.resolve(host.service?.('design')?.designFor?.(parentId)).catch(() => null) : null;
    const rows = await Promise.all(stories.map((s) => storyCoverage(s, design)));
    rows.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const features = (design?.features ?? []).map((f) => {
      const own = rows.filter((r) => r.feature === f.id);
      return own.length ? { id: f.id, title: f.title, stories: own.map((r) => r.id), ...tally(own.flatMap((r) => r.rows)) } : null;
    }).filter(Boolean);
    const total = tally(rows.flatMap((r) => r.rows));
    return {
      itemId: item.id, ref: item.ref ?? item.id, title: item.title, ...total,
      text: rows.length ? `${total.text}, across ${rows.length === 1 ? rows[0].id : `${rows[0].id} to ${rows.at(-1).id.replace(/^.*-(\d+)$/, '-$1')}`}` : 'No stories yet',
      features, stories: rows,
    };
  }

  /** Every item with stories past Design: its coverage (the Coverage page). */
  async function all() {
    const items = ((await workflows()?.items?.({}).catch(() => [])) ?? []).filter((i) => i.status === 'active' && i.type !== 'story' && i.type !== 'pr' && i.type !== 'defect');
    const out = [];
    for (const item of items) {
      const stories = (await workflows()?.storiesOf?.({ itemId: item.id }).catch(() => [])) ?? [];
      if (!stories.some((s) => ['engineer', 'build', 'test', 'release', 'operate'].includes(s.stage))) continue;
      out.push(await coverageOf(item.id));
    }
    return out.filter(Boolean).sort((a, b) => a.itemId.localeCompare(b.itemId, 'en', { numeric: true }));
  }

  /** The gaps a tester sees on their home: criteria with no passing test, per story in Build or Test. */
  async function gaps() {
    const out = [];
    for (const c of await all()) {
      for (const s of c.stories.filter((x) => ['build', 'test'].includes(x.stage) && x.passing < x.criteria)) {
        out.push({ storyId: s.id, itemId: c.itemId, title: s.title, stage: s.stage, missing: s.criteria - s.passing, text: s.text, href: s.href });
      }
    }
    return out;
  }

  return { coverageOf, all, gaps };
}
