// /dev/clock (development sign-in only): moves NooblyJS's "now" forward, so approval targets, reminders and
// escalations can be tested without waiting (roadmap test kit). Events, the audit log and every hosted app read
// this clock. It never moves backwards except by Reset.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';

const MOVES = [
  { label: '+1 hour', body: { hours: 1 } },
  { label: '+4 hours', body: { hours: 4 } },
  { label: '+1 working day', body: { workingDays: 1 } },
  { label: '+2 working days', body: { workingDays: 2 } },
];
const when = (iso) => new Date(iso).toLocaleString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export async function render(view, { ctx }) {
  let message = null;

  async function draw(clock) {
    const state = clock ?? await ctx.hostApi.get('dev/clock');
    if (!ctx.isCurrent()) return;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'NooblyJS · Development', title: 'Dev clock', lead: 'Move "now" forward to test approval targets, reminders and escalations without waiting.' })}
    ${card({ title: 'NooblyJS thinks it is', meta: state.moved ? statusPill({ text: 'Moved ahead', tone: 'warning' }) : statusPill({ text: 'Real time', tone: 'success' }), body: html`
      <p class="clock__now">${when(state.now)}</p>
      <p class="row__meta">${state.moved ? `The real time is ${when(state.realNow)}.` : 'The clock has not been moved.'} Working days are Monday to Friday.</p>
      ${message ? html`<p class="flash flash--${message.tone}" role="${message.tone === 'error' ? 'alert' : 'status'}">${message.text}</p>` : ''}
      <div class="actions">${MOVES.map((m, i) => button({ label: m.label, kind: 'secondary', attrs: { 'data-move': i } }))}${button({ label: 'Reset to real time', kind: 'danger', attrs: { 'data-move': 'reset' } })}</div>`,
    })}
    ${card({ title: 'What moving it does', body: html`<p class="row__meta">Approvals past their target are reminded, and those whose rule escalates are escalated one working day later. Open <a href="/home/approvals">Approvals</a>, <a href="/home/lifecycle">Lifecycle</a> or <a href="/home/activity">Activity</a> to see it. New events and audit records are stamped with this time.</p>` })}`);
  }

  view.addEventListener('click', async (event) => {
    const move = event.target.closest('[data-move]')?.dataset.move;
    if (move === undefined) return;
    try {
      const state = await ctx.hostApi.post('dev/clock', move === 'reset' ? { reset: true } : MOVES[Number(move)].body);
      message = { tone: 'ok', text: move === 'reset' ? 'Back to the real time.' : `Moved forward: ${MOVES[Number(move)].label.slice(1)}.` };
      await draw(state);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.message };
      await draw();
    }
  }, { signal: ctx.signal });

  await draw();
}
