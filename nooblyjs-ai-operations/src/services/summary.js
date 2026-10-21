// The sidebar's status card and badge: releases waiting for their two approvers, and what is in a pilot, in words.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createSummary({ releases }) {
  async function status() {
    const all = await releases.list();
    const waiting = all.filter((r) => r.status === 'waiting-approval');
    const piloting = all.filter((r) => r.status === 'piloting');
    const text = waiting.length ? `${plural(waiting.length, 'release')} waiting for approvers` : piloting.length ? `${plural(piloting.length, 'release')} in a pilot` : all.length ? 'No release waiting' : 'No releases yet';
    return { badges: { releases: waiting.length }, card: { pill: { text, tone: waiting.length ? 'warning' : piloting.length ? 'info' : 'neutral' } } };
  }
  return { status };
}
