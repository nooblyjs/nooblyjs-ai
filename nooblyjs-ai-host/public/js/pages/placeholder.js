// The placeholder for every screen that isn't built yet: its title, the phase that builds it and the mockup it
// must match (roadmap Phase 1). The route's `meta` says which: { phase, mockup, eyebrow, lead, chat }.
import { html } from '/ui/js/html.js';
import { pageHead, notice } from '/ui/js/components/index.js';

const PHASES = {
  2: 'Lifecycle core: items, approvals, activity',
  3: 'People, onboarding and "For you" homes',
  4: 'Team chat',
  5: 'Product Factory',
  9: 'Platform and governance',
  10: 'Metrics',
};

export async function render(view, { route, params, ctx }) {
  const { phase, mockup, eyebrow, lead, chat } = route.meta ?? {};
  const title = params.id ? `${route.title} ${params.id}` : route.title;
  if (params.id) ctx.setTitle(title);
  if (chat) ctx.chat.scope({ kind: chat, id: params.id ?? route.title });
  const where = mockup
    ? html`Its design is the mockup <code>.claude/steering/brief/${mockup}</code>.`
    : html`It has no mockup yet, so it will follow the patterns of the other screens.`;
  view.innerHTML = String(html`${pageHead({ eyebrow: eyebrow ?? `${ctx.app.label}`, title, lead })}
${notice({
    title: `Not built yet: Phase ${phase}`,
    text: html`This screen arrives in Phase ${phase}${PHASES[phase] ? html` (${PHASES[phase]})` : ''}. ${where}`,
    tone: 'muted',
    iconName: 'clock',
  })}`);
}
