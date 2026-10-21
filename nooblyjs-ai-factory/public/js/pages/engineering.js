// The Engineering group (Phase 16d; CHG-008 before it): the stories in Engineer. Application architecture: each story's,
// per impacted system, drawn by an agent from the code at the head of main, edited and accepted by a person, and said
// stale when main moves. Engineering sign-off: each story's checks (the architecture accepted and current, every
// criterion with a ready test case, every interface with an integration test) and the sign-off, with an override
// reason when a check fails. Test analysis is the Test section's page (/quality/test-analysis).
// Data: GET /engineering, /engineering/architecture/:id; POST …/systems/:name/draft|accept, PUT …/systems/:name,
// POST /engineering/:id/sign-off.
import { h, page, ago } from '../lib.js';
import { pill, pageHead, tableWrap, empty } from '../parts.js';

const tone = (ok) => (ok ? 'teal' : 'warn');
const list = (items) => h('ul', {}, items.map((x) => h('li', {}, x)));
const enc = encodeURIComponent;

function storyCell(s) {
  return h('td.title', {}, h('strong', {}, `${s.ref} · ${s.title}`), h('br'),
    h('span.muted', {}, s.parent ? `${s.parent.ref} · ${s.parent.title}` : 'No item'), ' · ', h('a', { href: s.href }, 'Lifecycle'));
}

async function listView(p, kind) {
  const data = await p.get('engineering');
  const rows = data.stories;
  const lead = kind === 'architecture'
    ? 'Each story in Engineer, its application flow, objects, NFRs per component and the changes it proposes, per impacted system, drawn from the code.'
    : 'Nothing is built before an Application Architect and a test lead sign a story off, in one approval. Each story\'s checks, and the sign-off.';
  const head = pageHead(kind === 'architecture' ? 'Application architecture' : 'Engineering sign-off', rows.length ? `${rows.length} ${rows.length === 1 ? 'story is' : 'stories are'} in Engineer. ${lead}` : lead);
  if (!data.live) return [head, empty('The lifecycle engine is not running here', 'The stories in Engineer come from it.')];
  if (!rows.length) return [head, empty('Nothing is in Engineer', 'A story comes here with its Design handoff, from the Design section.')];
  if (kind === 'architecture') {
    return [head, tableWrap('Application architecture', {}, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Story'), h('th', {}, 'Systems'), h('th', {}, h('span.sr', {}, 'Actions')))),
      h('tbody', {}, rows.map((s) => h('tr', {}, storyCell(s),
        h('td', {}, pill(s.architecture.text, s.architecture.systems && s.architecture.accepted === s.architecture.systems ? 'teal' : 'warn', 'plain'),
          list((s.architecture.systemsList ?? []).map((x) => `${x.name}: ${x.statusText}`))),
        h('td.r', {}, h('a.btn', { href: p.href(`/engineering/architecture/${enc(s.id)}`) }, 'Open')))))))];
  }
  return [head, ...rows.map((s) => {
    const reason = h('input', { id: `override-${s.id}`, maxlength: 500, placeholder: 'Why it can go on anyway', 'aria-label': `Override reason for ${s.id}` });
    return h('section.card', { 'aria-label': `${s.id}'s sign-off` },
      h('div.card-head', {}, h('h2', {}, `${s.ref} · ${s.title}`), pill(s.signOff.text, tone(s.signOff.ready))),
      h('p.muted', {}, s.parent ? `${s.parent.ref} · ${s.parent.title} · ` : '', h('a', { href: s.href }, 'Lifecycle'), ' · ', h('a', { href: p.href(`/engineering/architecture/${enc(s.id)}`) }, 'Architecture'), ' · ', h('a', { href: p.href(`/quality/test-analysis/${enc(s.id)}`) }, 'Test analysis')),
      h('ul', {}, s.signOff.checks.map((c) => h('li', {}, pill(c.passed ? 'Passes' : 'Fails', tone(c.passed), 'plain'), ' ', c.text))),
      s.signOff.waitingOn.length ? h('p', {}, `Waiting on ${s.signOff.waitingOn.join(', ')}.`) : null,
      p.can('draft') ? h('div.btns', {},
        s.signOff.ready ? null : h('label', {}, 'Override the failing checks, with a reason ', reason),
        h('button.primary', { onclick: p.act(() => p.post(`engineering/${enc(s.id)}/sign-off`, reason.value.trim() ? { override: { reason: reason.value.trim() } } : {})) }, 'Sign off & send to Build')) : null);
  })];
}

/** "Name: field, field" lines ⇄ objects. */
const objectsText = (objects) => (objects ?? []).map((o) => `${o.name}${o.fields?.length ? `: ${o.fields.join(', ')}` : ''}`).join('\n');
const objectsOf = (text, before) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [name, rest] = l.split(/:(.*)/);
  const old = (before ?? []).find((o) => o.name === name.trim());
  return { name: name.trim(), kind: old?.kind ?? 'value', fields: (rest ?? '').split(',').map((f) => f.trim()).filter(Boolean), note: old?.note ?? '' };
});
/** "kind path: what" lines ⇄ changes. */
const changesText = (changes) => (changes ?? []).map((c) => `${c.kind} ${c.path}: ${c.what}`).join('\n');
const changesOf = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = /^(new|changed|uses)\s+(\S+?):\s*(.*)$/.exec(l);
  return m ? { kind: m[1], path: m[2], what: m[3] } : { kind: 'changed', path: l.split(/\s+/)[0], what: l };
});

function systemCard(p, d, s) {
  const canDraft = d.writable && p.can('draft');
  const canAccept = d.writable && p.can('accept-decisions') && s.status === 'proposed' && !s.currency?.stale;
  const head = h('div.card-head', {}, h('h2', {}, s.name), pill(s.statusText, s.status === 'accepted' && !s.currency?.stale ? 'teal' : 'warn'));
  const ask = canDraft && (s.status === 'none' || s.currency?.stale || s.status === 'proposed')
    ? h('button', { onclick: p.act(() => p.post(`engineering/architecture/${enc(d.storyId)}/systems/${enc(s.name)}/draft`)) }, s.status === 'none' ? `Ask Rhea to draft ${s.name}'s architecture` : 'Ask Rhea to draft it again')
    : null;
  if (s.status === 'none') return h('section.card', { 'aria-label': `${s.name}'s architecture` }, head, h('p.muted', {}, 'Not drafted yet.'), ask ? h('div.btns', {}, ask) : null);
  const flow = h('textarea', { id: `flow-${s.name}`, rows: 6, 'aria-label': `${s.name}'s flow, one step a line` });
  flow.value = (s.flow ?? []).join('\n');
  const objects = h('textarea', { id: `objects-${s.name}`, rows: 4, 'aria-label': `${s.name}'s objects: Name: field, field` });
  objects.value = objectsText(s.objects);
  const changes = h('textarea', { id: `changes-${s.name}`, rows: 4, 'aria-label': `${s.name}'s changes: new|changed|uses path: what` });
  changes.value = changesText(s.changes);
  const form = h('form', { hidden: true, onsubmit: p.act(() => p.ctx.api.put(`engineering/architecture/${enc(d.storyId)}/systems/${enc(s.name)}`, { flow: flow.value.split('\n'), objects: objectsOf(objects.value, s.objects), changes: changesOf(changes.value) })) },
    h('label', {}, 'Application flow, one step a line', flow), h('label', {}, 'Objects (Name: field, field)', objects), h('label', {}, 'Changes (new|changed|uses path: what)', changes),
    h('div.btns', {}, h('button.primary', { type: 'submit' }, 'Save: it is proposed again')));
  return h('section.card', { 'aria-label': `${s.name}'s architecture` }, head,
    h('p.muted', {}, s.currency?.text ?? '', s.draftedBy ? ` · drafted by ${s.draftedBy.name} ${ago(s.draftedAt)}` : ''),
    s.modules?.length ? h('p.muted', {}, `Read: ${s.modules.join(', ')}`) : null,
    h('h3', {}, 'Application flow'), h('ol', {}, (s.flow ?? []).map((step) => h('li', {}, step))),
    h('h3', {}, 'Objects'),
    tableWrap(`${s.name}'s objects`, {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Object'), h('th', {}, 'Kind'), h('th', {}, 'Fields'), h('th', {}, 'Note'))),
      h('tbody', {}, (s.objects ?? []).map((o) => h('tr', {}, h('td', {}, h('strong', {}, o.name)), h('td', {}, o.kind), h('td', {}, (o.fields ?? []).join(', ')), h('td.muted', {}, o.note ?? '')))))),
    h('h3', {}, 'NFRs per component'),
    tableWrap(`${s.name}'s NFRs`, {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Component'), h('th', {}, 'Requirement'), h('th', {}, 'Target'), h('th', {}, 'From'))),
      h('tbody', {}, (s.nfrs ?? []).map((n) => h('tr', {}, h('td', {}, n.component), h('td', {}, n.requirement), h('td', {}, n.target), h('td.mono', {}, n.from ?? '')))))),
    h('h3', {}, 'Changes it proposes'),
    h('ul', {}, (s.changes ?? []).map((c) => h('li', {}, h('span.mono', {}, c.path), ` (${c.kind}): ${c.what}`))),
    h('div.btns', {},
      canAccept ? h('button.primary', { onclick: p.act(() => p.post(`engineering/architecture/${enc(d.storyId)}/systems/${enc(s.name)}/accept`)) }, `Accept ${s.name}'s architecture`) : null,
      ask,
      canDraft ? h('button', { onclick: (e) => { e.preventDefault(); form.hidden = !form.hidden; } }, 'Edit') : null),
    canDraft ? form : null);
}

async function architectureView(p) {
  const d = await p.get(`engineering/architecture/${enc(p.params.id)}`);
  return [
    pageHead(`Application architecture: ${d.storyId}`, `${d.title} · ${d.summary.text}.${d.writable ? '' : ` It is in ${d.stage}, so this is read only.`}`,
      h('a.btn', { href: d.href }, 'Open in Lifecycle'), d.designHref ? h('a.btn', { href: d.designHref }, 'Its design') : null),
    d.systems.map((s) => systemCard(p, d, s)),
    d.sample ? h('p.note', {}, 'Sample data of the seed story: ask for a draft to read the code.') : null,
  ];
}

const VIEWS = {
  architecture: (p) => listView(p, 'architecture'),
  signoff: (p) => listView(p, 'signoff'),
  'architecture-detail': architectureView,
};
const pages = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, page(v)]));

export function render(view, args) {
  return pages[args.route?.meta?.view ?? 'architecture'](view, args);
}
