// Where work sits (product.md §4): strategic themes, portfolios, value streams and products.
//
// - A **strategic theme** is an aspiration of the whole company ("Solve the every day", "Leverage AI"). It sits above
//   the portfolios: a portfolio works towards any number of themes.
// - A **portfolio** is a large area of the business (Digital, Buying, Banking). It has a document made from the
//   portfolio template (documents.js, templates.js).
// - A **value stream** sits in one portfolio (Digital Commerce, Media and Advertising, Rewards, Data Monetisation). A
//   portfolio has none or many. It has a document made from the value stream template.
// - A **product** sits in one portfolio (Registration, Payments, Checkout), and may also sit in one of that
//   portfolio's value streams. A signal, an idea and a spec each sit in one product, and through it in one
//   portfolio (and value stream). They replace the free-text "domain" the records had before.
//
// Portfolios, value streams and products are labels: a person types one and it exists. There is no list to maintain
// first. Anyone who may draft adds one (a product also on the fly, by naming a new product on an idea);
// renaming, moving, removing and linking a portfolio to its themes change what other people's work is filed under,
// so they take the approve permission. A name is unique whatever its capitals: a product's across all portfolios, so
// "Payments" means one thing, and the same for value streams and themes.
//
// A product also says where its work happens (NooblyJS Phase 11): its default repositories (Bitbucket, as Platform lists
// them, e.g. "acme/nooblyjs-ai-harness") and its Jira project ("DTE"). A new idea or spec in the product
// starts with them; the item's Architecture confirms or narrows the repositories. Anyone who may draft sets them.
//
// catalogue.yaml   { themes: [{ name, description? }],
//                    portfolios: [{ id, name, themes? }],
//                    valueStreams: [{ id, name, portfolio }],
//                    products: [{ name, portfolio, valueStream?, repositories?, jiraProject? }] }
//                  portfolio: null = not in one yet. Portfolios and value streams are referred to by name; their
//                  id names their document (portfolios/<id>.md, value-streams/<id>.md).
import { HttpError, badRequest, conflict, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';

const MAX = 40;
const MAX_DESCRIPTION = 300;
const MAX_THEMES = 20;
/** The seed story's catalogue, also used to file a data folder from before portfolios existed. */
export const SAMPLE = {
  themes: ['Solve the every day', 'Leverage AI'],
  portfolios: [['pfl_digital', 'Digital', ['Solve the every day', 'Leverage AI']], ['pfl_buying', 'Buying', []], ['pfl_banking', 'Banking', []]],
  valueStreams: [
    ['vs_digitalcommerce', 'Digital Commerce', 'Digital'], ['vs_mediaadvertising', 'Media and Advertising', 'Digital'],
    ['vs_rewards', 'Rewards', 'Digital'], ['vs_datamonetisation', 'Data Monetisation', 'Digital'],
  ],
  products: [
    ['Registration', 'Digital', 'Digital Commerce'], ['Products', 'Digital', 'Digital Commerce'], ['Merchandising', 'Digital', 'Digital Commerce'],
    ['Payments', 'Digital', 'Digital Commerce'], ['Checkout', 'Digital', 'Digital Commerce'], ['Delivery', 'Digital', 'Digital Commerce'],
    ['Search', 'Digital', 'Digital Commerce'], ['Rewards', 'Digital', 'Rewards'],
  ],
};
/** What the seed story's old domains became. A domain not listed keeps its name as a product in no portfolio. */
const FROM_DOMAIN = { Loyalty: 'Rewards' };

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const JIRA_PROJECT = /^[A-Z][A-Z0-9_]{1,19}$/;
const MAX_REPOSITORIES = 20;
const ID = /^[a-z]{2,8}_[a-z0-9]{6,32}$/;

/** A product as stored: its name and portfolio, and its value stream and tools only when it has them. */
function productRecord(p) {
  const repositories = Array.isArray(p.repositories) ? p.repositories.map(String).filter(Boolean) : [];
  return {
    name: String(p.name),
    portfolio: p.portfolio ? String(p.portfolio) : null,
    ...(p.valueStream ? { valueStream: String(p.valueStream) } : {}),
    ...(repositories.length ? { repositories } : {}),
    ...(p.jiraProject ? { jiraProject: String(p.jiraProject) } : {}),
  };
}

/**
 * The catalogue as stored, tidied. With `assign`, a portfolio or value stream without an id (one typed into the file
 * by hand, or from before documents) is given one, so it can have a document. Reads never assign: an id made up on
 * each read would name a different document every time.
 */
function normalize(doc, { assign = false } = {}) {
  const id = (value, prefix) => (ID.test(String(value ?? '')) ? String(value) : assign ? newId(prefix) : null);
  return {
    themes: (doc?.themes ?? []).filter((t) => t?.name).map((t) => ({ name: String(t.name), ...(t.description ? { description: String(t.description) } : {}) })),
    portfolios: (doc?.portfolios ?? []).filter((p) => p?.name).map((p) => {
      const themes = Array.isArray(p.themes) ? p.themes.map(String).filter(Boolean) : [];
      return { id: id(p.id, 'pfl'), name: String(p.name), ...(themes.length ? { themes } : {}) };
    }),
    valueStreams: (doc?.valueStreams ?? []).filter((v) => v?.name).map((v) => ({ id: id(v.id, 'vs'), name: String(v.name), portfolio: v.portfolio ? String(v.portfolio) : null })),
    products: (doc?.products ?? []).filter((p) => p?.name).map(productRecord),
  };
}

/** A label as typed, tidied: one line, single spaces. Throws 400 when it is empty, too long or has control characters. */
export function labelName(value, what = 'A label') {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new HttpError(400, 'bad_request', `${what} needs a name.`, { name: 'required' });
  if (name.length > MAX) throw new HttpError(400, 'bad_request', `${what} is at most ${MAX} characters.`, { name: `max ${MAX}` });
  if (/[\u0000-\u001f<>]/.test(name)) throw new HttpError(400, 'bad_request', `${what} can't contain < > or control characters.`, { name: 'invalid' });
  return name;
}

/** A theme's description: one line of at most 300 characters, or null to clear it. */
function description(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('A description is text.', { description: 'text' });
  const text = value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_DESCRIPTION) throw badRequest(`A description is at most ${MAX_DESCRIPTION} characters.`, { description: `max ${MAX_DESCRIPTION}` });
  return text || null;
}

/**
 * @param {{ repos: object, host: object, log?: object, documents?: object }} deps
 *   documents (documents.js): writes, renames and removes a portfolio's and a value stream's document with it
 */
export function createCatalogue({ repos, host, log, documents = null }) {
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'product', ...payload }, { actor: actor?.id ?? null });

  const read = async () => normalize(await repos.catalogue.get());

  /** Read-modify-write under the file's lock. `fn(catalogue)` changes it in place and returns what to answer. */
  const change = (fn) => repos.catalogue.update(async (doc) => {
    const catalogue = normalize(doc, { assign: true });
    const answer = await fn(catalogue);
    return { doc: catalogue, answer };
  });

  const findTheme = (c, name) => c.themes.find((t) => same(t.name, name)) ?? null;
  const findPortfolio = (c, name) => c.portfolios.find((p) => same(p.name, name)) ?? null;
  const findValueStream = (c, name) => c.valueStreams.find((v) => same(v.name, name)) ?? null;
  const findProduct = (c, name) => c.products.find((p) => same(p.name, name)) ?? null;

  /** The portfolio called `name`, added when it is new. `made` collects what was added, for its document and event. */
  function ensurePortfolio(c, name, made) {
    const existing = findPortfolio(c, name);
    if (existing) return existing;
    const portfolio = { id: newId('pfl'), name };
    c.portfolios.push(portfolio);
    made.push(portfolio);
    return portfolio;
  }

  /** After a write: a document for each portfolio added, and its event. */
  async function portfoliosAdded(made, actor) {
    for (const p of made) {
      await documents?.create('portfolio', p, actor);
      await emit('catalogue.portfolio_added', { portfolio: p.name, summary: `added the portfolio ${p.name}` }, actor);
    }
  }

  // ---------- strategic themes ----------

  async function addTheme({ name, description: text } = {}, actor) {
    const wanted = labelName(name, 'A strategic theme');
    const about = text === undefined ? undefined : description(text);
    const result = await change((c) => {
      const existing = findTheme(c, wanted);
      if (existing) return { added: false, theme: existing.name };
      c.themes.push({ name: wanted, ...(about ? { description: about } : {}) });
      return { added: true, theme: wanted };
    });
    if (result.added) await emit('catalogue.theme_added', { theme: result.theme, summary: `added the strategic theme ${result.theme}` }, actor);
    return result;
  }

  /** Renames a theme (every portfolio's link follows) and/or changes its description. */
  async function changeTheme(name, { name: to, description: text } = {}, actor) {
    const next = to === undefined ? undefined : labelName(to, 'A strategic theme');
    const about = text === undefined ? undefined : description(text);
    if (next === undefined && about === undefined) throw badRequest('Send a new name or description.');
    const result = await change((c) => {
      const theme = findTheme(c, name);
      if (!theme) throw notFound(`There is no strategic theme "${name}".`);
      const was = theme.name;
      if (next !== undefined) {
        const clash = findTheme(c, next);
        if (clash && clash !== theme) throw conflict(`There is already a strategic theme called ${clash.name}.`);
        for (const p of c.portfolios) if (p.themes) p.themes = p.themes.map((t) => (same(t, was) ? next : t));
        theme.name = next;
      }
      if (about !== undefined) {
        if (about) theme.description = about;
        else delete theme.description;
      }
      return { was, theme: theme.name, description: theme.description ?? null };
    });
    await emit('catalogue.theme_changed', { from: result.was, theme: result.theme, summary: result.was === result.theme ? `changed the strategic theme ${result.theme}` : `renamed the strategic theme ${result.was} to ${result.theme}` }, actor);
    return { theme: result.theme, description: result.description };
  }

  /** Removes a theme no portfolio works towards. */
  async function removeTheme(name, actor) {
    const removed = await change((c) => {
      const theme = findTheme(c, name);
      if (!theme) throw notFound(`There is no strategic theme "${name}".`);
      const linked = c.portfolios.filter((p) => (p.themes ?? []).some((t) => same(t, theme.name)));
      if (linked.length) throw conflict(`${linked.map((p) => p.name).join(', ')} ${linked.length === 1 ? 'works' : 'work'} towards ${theme.name}. Unlink ${linked.length === 1 ? 'it' : 'them'} first.`, { portfolios: linked.map((p) => p.name) });
      c.themes.splice(c.themes.indexOf(theme), 1);
      return theme.name;
    });
    await emit('catalogue.theme_removed', { theme: removed, summary: `removed the strategic theme ${removed}` }, actor);
    return { removed };
  }

  // ---------- portfolios ----------

  async function addPortfolio(name, actor) {
    const wanted = labelName(name, 'A portfolio');
    const made = [];
    const portfolio = await change((c) => ensurePortfolio(c, wanted, made).name);
    await portfoliosAdded(made, actor);
    return { portfolio, added: made.length > 0 };
  }

  /**
   * Renames a portfolio (its products and value streams follow) and/or sets the strategic themes it works towards.
   * `themes` is the whole list; each must be a theme already.
   */
  async function changePortfolio(name, { name: to, themes } = {}, actor) {
    const next = to === undefined ? undefined : labelName(to, 'A portfolio');
    if (themes !== undefined && (!Array.isArray(themes) || themes.length > MAX_THEMES)) throw badRequest(`Themes are a list of up to ${MAX_THEMES}.`, { themes: 'list' });
    if (next === undefined && themes === undefined) throw badRequest('Send a new name or the themes.');
    const result = await change((c) => {
      const portfolio = findPortfolio(c, name);
      if (!portfolio) throw notFound(`There is no portfolio "${name}".`);
      const was = { name: portfolio.name, themes: portfolio.themes ?? [] };
      if (next !== undefined) {
        const clash = findPortfolio(c, next);
        if (clash && clash !== portfolio) throw conflict(`There is already a portfolio called ${clash.name}.`);
        for (const p of c.products) if (same(p.portfolio, was.name)) p.portfolio = next;
        for (const v of c.valueStreams) if (same(v.portfolio, was.name)) v.portfolio = next;
        portfolio.name = next;
      }
      if (themes !== undefined) {
        const linked = [];
        for (const t of themes) {
          const theme = findTheme(c, labelName(t, 'A strategic theme'));
          if (!theme) throw notFound(`There is no strategic theme "${String(t).slice(0, 40)}". Add it first.`, { themes: String(t).slice(0, 40) });
          if (!linked.includes(theme.name)) linked.push(theme.name);
        }
        if (linked.length) portfolio.themes = linked;
        else delete portfolio.themes;
      }
      return { was, portfolio: { ...portfolio, themes: portfolio.themes ?? [] }, valueStreams: c.valueStreams.filter((v) => same(v.portfolio, portfolio.name)).map((v) => ({ ...v })) };
    });
    const { was, portfolio } = result;
    if (was.name !== portfolio.name) {
      await documents?.renamed('portfolio', portfolio);
      for (const v of result.valueStreams) await documents?.renamed('value-stream', v);
      await emit('catalogue.portfolio_renamed', { from: was.name, portfolio: portfolio.name, summary: `renamed the portfolio ${was.name} to ${portfolio.name}` }, actor);
    }
    if (was.themes.join('\n') !== portfolio.themes.join('\n')) {
      await emit('catalogue.portfolio_themes_changed', { portfolio: portfolio.name, themes: portfolio.themes, summary: portfolio.themes.length ? `linked ${portfolio.name} to ${portfolio.themes.join(', ')}` : `unlinked ${portfolio.name} from its strategic themes` }, actor);
    }
    return { portfolio: portfolio.name, themes: portfolio.themes };
  }

  /** Removes a portfolio with no products or value streams in it, and its document. */
  async function removePortfolio(name, actor) {
    const removed = await change((c) => {
      const portfolio = findPortfolio(c, name);
      if (!portfolio) throw notFound(`There is no portfolio "${name}".`);
      const products = c.products.filter((p) => same(p.portfolio, portfolio.name)).length;
      if (products) throw conflict(`${portfolio.name} has ${products} product${products === 1 ? '' : 's'}. Move or remove them first.`, { products });
      const streams = c.valueStreams.filter((v) => same(v.portfolio, portfolio.name)).length;
      if (streams) throw conflict(`${portfolio.name} has ${streams} value stream${streams === 1 ? '' : 's'}. Move or remove them first.`, { valueStreams: streams });
      c.portfolios.splice(c.portfolios.indexOf(portfolio), 1);
      return portfolio;
    });
    await documents?.removed('portfolio', removed.id);
    await emit('catalogue.portfolio_removed', { portfolio: removed.name, summary: `removed the portfolio ${removed.name}` }, actor);
    return { removed: removed.name };
  }

  // ---------- value streams ----------

  /** Adds a value stream to a portfolio, adding the portfolio too when it is new. An existing one is returned as it is. */
  async function addValueStream({ name, portfolio } = {}, actor) {
    const wanted = labelName(name, 'A value stream');
    if (portfolio == null || portfolio === '') throw badRequest('A value stream sits in a portfolio. Say which.', { portfolio: 'required' });
    const into = labelName(portfolio, 'A portfolio');
    const made = [];
    const result = await change((c) => {
      const existing = findValueStream(c, wanted);
      if (existing) {
        if (!same(existing.portfolio, into)) throw conflict(`${existing.name} is already a value stream in ${existing.portfolio}. A value stream sits in one portfolio.`, { valueStream: existing.name, portfolio: existing.portfolio });
        return { added: false, valueStream: { ...existing } };
      }
      const home = ensurePortfolio(c, into, made);
      const stream = { id: newId('vs'), name: wanted, portfolio: home.name };
      c.valueStreams.push(stream);
      return { added: true, valueStream: { ...stream } };
    });
    await portfoliosAdded(made, actor);
    const { valueStream } = result;
    if (result.added) {
      await documents?.create('value-stream', valueStream, actor);
      await emit('catalogue.value_stream_added', { valueStream: valueStream.name, portfolio: valueStream.portfolio, summary: `added the value stream ${valueStream.name} to ${valueStream.portfolio}` }, actor);
    }
    return { valueStream: valueStream.name, portfolio: valueStream.portfolio, id: valueStream.id, added: result.added, madePortfolio: made.length > 0 };
  }

  /** Renames a value stream (its products follow) and/or moves it to another portfolio (its products move with it). */
  async function changeValueStream(name, { name: to, portfolio } = {}, actor) {
    const next = to === undefined ? undefined : labelName(to, 'A value stream');
    const into = portfolio === undefined ? undefined : labelName(portfolio, 'A portfolio');
    if (next === undefined && into === undefined) throw badRequest('Send a new name or portfolio.');
    const result = await change((c) => {
      const stream = findValueStream(c, name);
      if (!stream) throw notFound(`There is no value stream "${name}".`);
      const was = { name: stream.name, portfolio: stream.portfolio };
      const products = c.products.filter((p) => same(p.valueStream, was.name));
      if (next !== undefined) {
        const clash = findValueStream(c, next);
        if (clash && clash !== stream) throw conflict(`There is already a value stream called ${clash.name} (in ${clash.portfolio}).`);
        stream.name = next;
        for (const p of products) p.valueStream = next;
      }
      if (into !== undefined) {
        const home = findPortfolio(c, into);
        if (!home) throw notFound(`There is no portfolio "${into}". Add it first.`);
        stream.portfolio = home.name;
        for (const p of products) p.portfolio = home.name;
      }
      return { was, stream: { ...stream }, products: products.length };
    });
    const { was, stream } = result;
    if (was.name !== stream.name || was.portfolio !== stream.portfolio) await documents?.renamed('value-stream', stream);
    if (was.name !== stream.name) await emit('catalogue.value_stream_renamed', { from: was.name, valueStream: stream.name, summary: `renamed the value stream ${was.name} to ${stream.name}` }, actor);
    if (was.portfolio !== stream.portfolio) {
      await emit('catalogue.value_stream_moved', { valueStream: stream.name, from: was.portfolio, portfolio: stream.portfolio, products: result.products, summary: `moved the value stream ${stream.name} to ${stream.portfolio}${result.products ? ` with its ${result.products} product${result.products === 1 ? '' : 's'}` : ''}` }, actor);
    }
    return { valueStream: stream.name, portfolio: stream.portfolio, products: result.products };
  }

  /** Removes a value stream with no products in it, and its document. */
  async function removeValueStream(name, actor) {
    const removed = await change((c) => {
      const stream = findValueStream(c, name);
      if (!stream) throw notFound(`There is no value stream "${name}".`);
      const products = c.products.filter((p) => same(p.valueStream, stream.name)).length;
      if (products) throw conflict(`${stream.name} has ${products} product${products === 1 ? '' : 's'}. Move them out of it first.`, { products });
      c.valueStreams.splice(c.valueStreams.indexOf(stream), 1);
      return stream;
    });
    await documents?.removed('value-stream', removed.id);
    await emit('catalogue.value_stream_removed', { valueStream: removed.name, portfolio: removed.portfolio, summary: `removed the value stream ${removed.name}` }, actor);
    return { removed: removed.name };
  }

  // ---------- products ----------

  /**
   * Adds a product to a portfolio (and value stream), adding the portfolio too when it is new. A value stream must
   * exist already, and names the portfolio when none is given. An existing product is returned as it is, or filed
   * when it has no portfolio or value stream yet.
   */
  async function addProduct({ name, portfolio, valueStream } = {}, actor) {
    const wanted = labelName(name, 'A product');
    const asked = portfolio == null || portfolio === '' ? null : labelName(portfolio, 'A portfolio');
    const streamName = valueStream == null || valueStream === '' ? null : labelName(valueStream, 'A value stream');
    const made = [];
    const result = await change((c) => {
      const stream = streamName ? findValueStream(c, streamName) : null;
      if (streamName && !stream) throw notFound(`There is no value stream "${streamName}". Add it to a portfolio first.`, { valueStream: streamName });
      if (stream && asked && !same(stream.portfolio, asked)) throw conflict(`${stream.name} is a value stream in ${stream.portfolio}, not ${asked}.`, { valueStream: stream.name, portfolio: stream.portfolio });
      const into = asked ?? stream?.portfolio ?? null;
      const existing = findProduct(c, wanted);
      if (existing) {
        if (into && existing.portfolio && !same(existing.portfolio, into)) {
          throw conflict(`${existing.name} is already a product in ${existing.portfolio}. A product sits in one portfolio.`, { product: existing.name, portfolio: existing.portfolio });
        }
        if (stream && existing.valueStream && !same(existing.valueStream, stream.name)) {
          throw conflict(`${existing.name} is already in the value stream ${existing.valueStream}. A product sits in one value stream.`, { product: existing.name, valueStream: existing.valueStream });
        }
        // A product nobody has filed yet takes the portfolio (and value stream) it is first given.
        const filed = Boolean((into && !existing.portfolio) || (stream && !existing.valueStream));
        if (into && !existing.portfolio) existing.portfolio = ensurePortfolio(c, into, made).name;
        if (stream && !existing.valueStream) existing.valueStream = stream.name;
        return { added: false, filed, product: existing.name, portfolio: existing.portfolio, valueStream: existing.valueStream ?? null };
      }
      const home = into ? ensurePortfolio(c, into, made).name : null;
      c.products.push(productRecord({ name: wanted, portfolio: home, valueStream: stream?.name }));
      return { added: true, product: wanted, portfolio: home, valueStream: stream?.name ?? null };
    });
    await portfoliosAdded(made, actor);
    const where = [result.portfolio, result.valueStream].filter(Boolean).join(' · ');
    if (result.added) await emit('catalogue.product_added', { product: result.product, portfolio: result.portfolio, valueStream: result.valueStream, summary: `added the product ${result.product}${where ? ` to ${where}` : ''}` }, actor);
    else if (result.filed) await emit('catalogue.product_moved', { product: result.product, portfolio: result.portfolio, valueStream: result.valueStream, summary: `put the product ${result.product} in ${where}` }, actor);
    return { ...result, madePortfolio: made.length > 0 };
  }

  /**
   * The product a record is being filed under, from what a person sent ({ product, portfolio }). A new name becomes a
   * product (in `portfolio`, when given). Returns the product's name as it is stored, null to clear it, or undefined
   * when the body didn't mention it.
   */
  async function productFor({ product, portfolio } = {}, actor) {
    if (product === undefined) return undefined;
    if (product === null || String(product).trim() === '') return null;
    return (await addProduct({ name: product, portfolio }, actor)).product;
  }

  /** Every record filed under a product (signals, ideas, specs), for a rename and for the counts. */
  async function filed() {
    const [signals, ideas, specs] = await Promise.all([repos.signals.list(), repos.ideas.list(), repos.specs.list()]);
    return { signals, ideas, specs };
  }

  /**
   * Renames a product and/or moves it to another portfolio or value stream. A rename refiles every record under the
   * new name. A value stream names its portfolio; moving to a portfolio the value stream isn't in takes the product
   * out of its value stream.
   */
  async function changeProduct(name, { name: to, portfolio, valueStream } = {}, actor) {
    const next = to === undefined ? null : labelName(to, 'A product');
    const into = portfolio === undefined ? undefined : portfolio === null || portfolio === '' ? null : labelName(portfolio, 'A portfolio');
    const streamName = valueStream === undefined ? undefined : valueStream === null || valueStream === '' ? null : labelName(valueStream, 'A value stream');
    const result = await change((c) => {
      const product = findProduct(c, name);
      if (!product) throw notFound(`There is no product "${name}".`);
      const was = { name: product.name, portfolio: product.portfolio, valueStream: product.valueStream ?? null };
      if (next) {
        const clash = findProduct(c, next);
        if (clash && clash !== product) throw conflict(`There is already a product called ${clash.name}${clash.portfolio ? ` (in ${clash.portfolio})` : ''}.`);
        product.name = next;
      }
      if (into !== undefined) {
        if (into && !findPortfolio(c, into)) throw notFound(`There is no portfolio "${into}". Add it first.`);
        product.portfolio = into ? findPortfolio(c, into).name : null;
      }
      if (streamName) {
        const stream = findValueStream(c, streamName);
        if (!stream) throw notFound(`There is no value stream "${streamName}". Add it to a portfolio first.`);
        if (into === undefined) product.portfolio = stream.portfolio;
        else if (!same(product.portfolio, stream.portfolio)) throw conflict(`${stream.name} is a value stream in ${stream.portfolio}, not ${product.portfolio ?? 'no portfolio'}.`);
        product.valueStream = stream.name;
      } else if (streamName === null || (product.valueStream && !same(findValueStream(c, product.valueStream)?.portfolio, product.portfolio))) {
        delete product.valueStream;
      }
      return { was, now: { name: product.name, portfolio: product.portfolio, valueStream: product.valueStream ?? null } };
    });
    let refiled = 0;
    if (result.was.name !== result.now.name) {
      const records = await filed();
      for (const [kind, list] of Object.entries(records)) {
        for (const record of list.filter((r) => same(r.product, result.was.name))) {
          await repos[kind].update(record.id, (current) => current && { ...current, product: result.now.name });
          refiled += 1;
        }
      }
      await emit('catalogue.product_renamed', { from: result.was.name, product: result.now.name, refiled, summary: `renamed the product ${result.was.name} to ${result.now.name}` }, actor);
    }
    if (result.was.portfolio !== result.now.portfolio || result.was.valueStream !== result.now.valueStream) {
      const where = [result.now.portfolio ?? 'no portfolio', result.now.valueStream].filter(Boolean).join(' · ');
      await emit('catalogue.product_moved', { product: result.now.name, from: result.was.portfolio, portfolio: result.now.portfolio, valueStream: result.now.valueStream, summary: `moved the product ${result.now.name} to ${where}` }, actor);
    }
    return { product: result.now.name, portfolio: result.now.portfolio, valueStream: result.now.valueStream, refiled };
  }

  /**
   * Where a product's work happens: its default repositories and Jira project. `repositories` are checked against
   * Platform's list (NooblyJS's catalogue of repositories) and stored by their full name; `jiraProject` must be a project
   * NooblyJS reads (Platform · Settings · Integrations). Either may be left out to keep it; [] and null clear them.
   */
  async function setTools(name, { repositories, jiraProject } = {}, actor) {
    let repos;
    if (repositories !== undefined) {
      if (!Array.isArray(repositories) || repositories.length > MAX_REPOSITORIES) throw new HttpError(400, 'bad_request', `Repositories are a list of up to ${MAX_REPOSITORIES}.`, { repositories: 'list' });
      const platform = host.service('platform');
      repos = [];
      for (const ref of repositories) {
        const found = typeof platform?.repository === 'function' ? await platform.repository(String(ref)) : null;
        if (!found) throw new HttpError(422, 'unknown_repository', `${String(ref).slice(0, 80)} is not a repository NooblyJS knows. Platform · Repositories lists them.`, { repositories: String(ref).slice(0, 80) });
        if (found.gone) throw new HttpError(422, 'repository_gone', `${found.name} is no longer in Bitbucket.`, { repositories: found.name });
        if (!repos.includes(found.name)) repos.push(found.name);
      }
    }
    let jira;
    if (jiraProject !== undefined) {
      jira = jiraProject === null || jiraProject === '' ? null : String(jiraProject).trim().toUpperCase();
      if (jira !== null) {
        if (!JIRA_PROJECT.test(jira)) throw new HttpError(400, 'bad_request', `"${String(jiraProject).slice(0, 30)}" is not a Jira project key.`, { jiraProject: 'invalid' });
        const devtools = host.service('devtools');
        const readable = devtools ? (await devtools.config()).jira.projects : null;
        if (readable && !readable.includes(jira)) throw new HttpError(422, 'jira_project_not_read', `NooblyJS does not read the Jira project ${jira}. An Owner adds it in Platform · Settings · Integrations.`, { jiraProject: jira });
      }
    }
    const result = await change((c) => {
      const product = findProduct(c, name);
      if (!product) throw notFound(`There is no product "${name}".`);
      const before = { repositories: product.repositories ?? [], jiraProject: product.jiraProject ?? null };
      if (repos !== undefined) {
        if (repos.length) product.repositories = repos;
        else delete product.repositories;
      }
      if (jira !== undefined) {
        if (jira) product.jiraProject = jira;
        else delete product.jiraProject;
      }
      return { product: product.name, before, repositories: product.repositories ?? [], jiraProject: product.jiraProject ?? null };
    });
    const changed = JSON.stringify(result.before) !== JSON.stringify({ repositories: result.repositories, jiraProject: result.jiraProject });
    if (changed) {
      const where = [result.repositories.length ? result.repositories.map((r) => r.split('/').pop()).join(', ') : null, result.jiraProject ? `Jira ${result.jiraProject}` : null].filter(Boolean).join(' · ') || 'no repositories or Jira project';
      await emit('catalogue.product_tools_changed', { product: result.product, repositories: result.repositories, jiraProject: result.jiraProject, summary: `set where ${result.product} is built: ${where}` }, actor);
    }
    return { product: result.product, repositories: result.repositories, jiraProject: result.jiraProject, changed };
  }

  /** What a new record in a product starts with: { repositories, jiraProject }, empty when it has none (or no product). */
  async function defaultsFor(productName) {
    const product = productName ? findProduct(await read(), productName) : null;
    return { repositories: product?.repositories ?? [], jiraProject: product?.jiraProject ?? null };
  }

  /** Removes a product nothing is filed under. One in use is refused: move its work first. */
  async function removeProduct(name, actor) {
    const records = await filed();
    const removed = await change((c) => {
      const product = findProduct(c, name);
      if (!product) throw notFound(`There is no product "${name}".`);
      const inUse = Object.values(records).flat().filter((r) => same(r.product, product.name)).length;
      if (inUse) throw conflict(`${product.name} has ${inUse} item${inUse === 1 ? '' : 's'} filed under it. Move them to another product first.`, { inUse });
      c.products.splice(c.products.indexOf(product), 1);
      return product.name;
    });
    await emit('catalogue.product_removed', { product: removed, summary: `removed the product ${removed}` }, actor);
    return { removed };
  }

  // ---------- reading ----------

  /**
   * The catalogue as a screen shows it: the strategic themes; each portfolio with its themes, value streams and
   * products; and the products in none. `counts` (from the board) says how many cards are filed under each product.
   */
  async function view(counts = new Map()) {
    const c = await read();
    const product = (p) => ({ name: p.name, portfolio: p.portfolio, valueStream: p.valueStream ?? null, count: counts.get(p.name.toLowerCase()) ?? 0, repositories: p.repositories ?? [], jiraProject: p.jiraProject ?? null });
    const portfolios = c.portfolios.map((p) => {
      const products = c.products.filter((x) => same(x.portfolio, p.name)).map(product);
      const valueStreams = c.valueStreams.filter((v) => same(v.portfolio, p.name)).map((v) => {
        const inStream = products.filter((x) => same(x.valueStream, v.name));
        return { id: v.id, name: v.name, portfolio: p.name, products: inStream.map((x) => x.name), count: inStream.reduce((n, x) => n + x.count, 0) };
      });
      return { id: p.id, name: p.name, themes: p.themes ?? [], valueStreams, products, count: products.reduce((n, x) => n + x.count, 0) };
    });
    return {
      themes: c.themes.map((t) => ({ name: t.name, description: t.description ?? null, portfolios: c.portfolios.filter((p) => (p.themes ?? []).some((x) => same(x, t.name))).map((p) => p.name) })),
      portfolios,
      unfiled: c.products.filter((p) => !p.portfolio || !findPortfolio(c, p.portfolio)).map(product),
      // Nothing set up yet: the board opens on "Start with your portfolios".
      empty: c.portfolios.length === 0 && c.products.length === 0,
    };
  }

  /** product name (lower case) → { name, portfolio, valueStream }, for the views. */
  async function lookup() {
    return new Map((await read()).products.map((p) => [p.name.toLowerCase(), p]));
  }

  /** A portfolio or value stream by its id, as the catalogue has it: { id, name, portfolio?, themes? }, or null. */
  async function entry(kind, id) {
    const c = await read();
    const found = (kind === 'portfolio' ? c.portfolios : c.valueStreams).find((x) => x.id === id);
    return found ? { ...found } : null;
  }

  // ---------- data folders from before ----------

  /**
   * Brings an older data folder up to date, at each start:
   * - one from before portfolios: every record's `domain` becomes its `product`, and the catalogue is made from the
   *   products found. The seed story's folder gets the sample catalogue; any other keeps its own names, in no
   *   portfolio, for a person to file;
   * - one from before documents: each portfolio and value stream is given an id, and a document from its template.
   */
  async function migrate() {
    const domains = await fromDomains();
    if (!(await repos.catalogue.get())) return { ...domains, documents: 0 };
    let c = await read();
    if ([...c.portfolios, ...c.valueStreams].some((x) => !x.id)) c = await change((next) => next);
    let documents_ = 0;
    if (documents) {
      for (const p of c.portfolios) if (await documents.create('portfolio', p)) documents_ += 1;
      for (const v of c.valueStreams) if (await documents.create('value-stream', v)) documents_ += 1;
    }
    if (documents_) log?.info?.(`portfolios and value streams: wrote ${documents_} documents from their templates`);
    return { ...domains, documents: documents_ };
  }

  async function fromDomains() {
    if (await repos.catalogue.get()) return { migrated: false };
    const records = await filed();
    const all = Object.values(records).flat();
    const withDomain = all.filter((r) => r.domain !== undefined);
    if (!withDomain.length) return { migrated: false };
    const sample = all.some((r) => r.sampleData === true);
    const catalogue = sample
      ? normalize({
        themes: SAMPLE.themes.map((name) => ({ name })),
        portfolios: SAMPLE.portfolios.map(([id, name, themes]) => ({ id, name, themes })),
        valueStreams: SAMPLE.valueStreams.map(([id, name, portfolio]) => ({ id, name, portfolio })),
        products: SAMPLE.products.map(([name, portfolio, valueStream]) => ({ name, portfolio, valueStream })),
      })
      : normalize({});
    let refiled = 0;
    for (const [kind, list] of Object.entries(records)) {
      for (const record of list.filter((r) => r.domain !== undefined)) {
        const name = record.domain ? (sample ? FROM_DOMAIN[record.domain] ?? record.domain : record.domain) : null;
        if (name && !findProduct(catalogue, name)) catalogue.products.push({ name, portfolio: null });
        await repos[kind].update(record.id, (current) => {
          if (!current) return null;
          const { domain, ...rest } = current;
          return { ...rest, product: current.product ?? (name ? findProduct(catalogue, name).name : null) };
        });
        refiled += 1;
      }
    }
    await repos.catalogue.write(catalogue);
    log?.info?.(`portfolios and products: filed ${refiled} records from their old domains (${catalogue.products.length} products, ${catalogue.portfolios.length} portfolios)`);
    return { migrated: true, refiled };
  }

  return {
    read, view, lookup, entry,
    addTheme, changeTheme, removeTheme,
    addPortfolio, changePortfolio, removePortfolio,
    addValueStream, changeValueStream, removeValueStream,
    addProduct, productFor, changeProduct, setTools, defaultsFor, removeProduct,
    migrate,
  };
}
