// The container view as code (D2): a subset of Mermaid C4 (`C4Container`), so diagram.md renders as a diagram in
// Bitbucket or GitHub and stays a readable file. The screens draw the parsed model themselves.
//
//   C4Container
//   title Container view · slots
//   Container(slotApi, "Slot API", "Node 22", "holds, release, capacity", $tags="new")
//   ContainerDb(slotCache, "Slot cache", "Redis", "30 s TTL", $tags="new")
//   ContainerQueue(bus, "Event bus", "Kafka", "slot.released")
//   System_Ext(planner, "Delivery planner", "Java · picker shifts, routes")
//   Rel(gateway, slotApi, "gRPC")
//
// Elements are new or existing ($tags="new" | "existing", existing by default); *_Ext elements are external (and
// may be tagged new too, when this design brings them in).

const ELEMENTS = {
  Person: { kind: 'person', tech: false }, Person_Ext: { kind: 'person', tech: false, external: true },
  System: { kind: 'system', tech: false }, System_Ext: { kind: 'system', tech: false, external: true },
  SystemDb: { kind: 'database', tech: false }, SystemDb_Ext: { kind: 'database', tech: false, external: true },
  SystemQueue: { kind: 'queue', tech: false }, SystemQueue_Ext: { kind: 'queue', tech: false, external: true },
  Container: { kind: 'container', tech: true }, Container_Ext: { kind: 'container', tech: true, external: true },
  ContainerDb: { kind: 'database', tech: true }, ContainerDb_Ext: { kind: 'database', tech: true, external: true },
  ContainerQueue: { kind: 'queue', tech: true }, ContainerQueue_Ext: { kind: 'queue', tech: true, external: true },
};
const RELS = new Set(['Rel', 'BiRel', 'Rel_U', 'Rel_D', 'Rel_L', 'Rel_R', 'Rel_Up', 'Rel_Down', 'Rel_Left', 'Rel_Right', 'Rel_Back']);
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TAGS = ['new', 'existing'];

/** Splits `a, "b, c", $tags="new"` into ['a', 'b, c', { tags: 'new' }] honouring quotes. */
function splitArgs(text) {
  const args = [];
  const named = {};
  let i = 0;
  while (i < text.length) {
    while (text[i] === ' ' || text[i] === ',') i++;
    if (i >= text.length) break;
    let name = null;
    const m = /^\$([a-zA-Z]+)\s*=\s*/.exec(text.slice(i));
    if (m) {
      name = m[1];
      i += m[0].length;
    }
    let value;
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new Error('a quote is not closed');
      value = text.slice(i + 1, end);
      i = end + 1;
    } else {
      const end = text.indexOf(',', i);
      value = text.slice(i, end < 0 ? text.length : end).trim();
      i = end < 0 ? text.length : end;
    }
    if (name) named[name] = value;
    else args.push(value);
  }
  return { args, named };
}

/**
 * Parses the code. Returns { title, nodes, edges, errors }: errors are { line, message } a person can act on.
 * Nodes: { id, kind, label, tech, description, status: 'new' | 'existing' | 'external' }.
 */
export function parseC4(code) {
  const out = { title: null, nodes: [], edges: [], errors: [] };
  const lines = String(code ?? '').split(/\r?\n/);
  let header = false;
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const n = index + 1;
    if (!line || line.startsWith('%%')) return;
    if (!header) {
      if (line === 'C4Container') header = true;
      else out.errors.push({ line: n, message: 'The diagram starts with C4Container.' });
      header = true;
      return;
    }
    if (line.startsWith('title ')) {
      out.title = line.slice(6).trim();
      return;
    }
    const m = /^([A-Za-z_]+)\((.*)\)$/.exec(line);
    if (!m) {
      out.errors.push({ line: n, message: `Not understood: "${line.slice(0, 60)}". Use Container(…), ContainerDb(…), System_Ext(…) or Rel(…).` });
      return;
    }
    const [, fn, inner] = m;
    let parsed;
    try {
      parsed = splitArgs(inner);
    } catch (err) {
      out.errors.push({ line: n, message: err.message });
      return;
    }
    const { args, named } = parsed;
    if (ELEMENTS[fn]) {
      const def = ELEMENTS[fn];
      const [id, label, a, b] = args;
      if (!ALIAS.test(id ?? '')) return out.errors.push({ line: n, message: `"${id ?? ''}" is not a valid name (letters, digits and _).` });
      if (!label) return out.errors.push({ line: n, message: `${id} needs a label.` });
      if (out.nodes.some((x) => x.id === id)) return out.errors.push({ line: n, message: `${id} is defined twice.` });
      const tag = named.tags ?? 'existing';
      if (!TAGS.includes(tag)) return out.errors.push({ line: n, message: `$tags must be "new" or "existing", not "${tag}".` });
      out.nodes.push({
        id, kind: def.kind, label,
        tech: def.tech ? a ?? '' : '',
        description: def.tech ? b ?? '' : a ?? '',
        status: def.external ? 'external' : tag,
        isNew: tag === 'new',
        line: n,
      });
      return;
    }
    if (RELS.has(fn)) {
      const [from, to, label, tech] = args;
      if (!from || !to) return out.errors.push({ line: n, message: 'Rel needs a from and a to.' });
      out.edges.push({ from, to, label: label ?? '', tech: tech ?? '', line: n });
      return;
    }
    out.errors.push({ line: n, message: `${fn}(…) isn't supported here.` });
  });
  if (!header) out.errors.push({ line: 1, message: 'The diagram is empty. Start with C4Container.' });
  const ids = new Set(out.nodes.map((x) => x.id));
  for (const e of out.edges) {
    for (const end of [e.from, e.to]) if (!ids.has(end)) out.errors.push({ line: e.line, message: `${end} isn't defined.` });
  }
  return out;
}

/** The code inside diagram.md's ```mermaid fence (or the whole body when there is none). */
export const codeFromBody = (body) => {
  const m = /```mermaid\s*\n([\s\S]*?)```/.exec(String(body ?? ''));
  return (m ? m[1] : String(body ?? '')).trim();
};

export const bodyFromCode = (code) => `\`\`\`mermaid\n${String(code).trim()}\n\`\`\``;

/** Elements that add something new to depend on (each needs an ADR): a new store, queue or (external) system. */
export const isDependency = (node) => node.isNew && (node.status === 'external' || ['database', 'queue', 'system'].includes(node.kind));
