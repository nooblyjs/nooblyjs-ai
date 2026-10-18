// Approvals reach people where they are (Phase 12): when an approval is requested, each reviewer gets a message in
// Microsoft Teams and an email in Outlook, each with a link that opens the approval in NooblyJS. Neither can decide it:
// approving is a person's action, in NooblyJS.
//
//   Teams    a card in the reviewer's personal chat with the NooblyJS app. NooblyJS can only write there once the person
//            has the app (Teams tells the bot when they install it or write to it; that address is kept in
//            data/teams/people/<id>.yaml). Sent when their profile says "approvals in Teams".
//   Outlook  an email through Microsoft Graph (app-only: POST /users/{sender}/sendMail, Mail.Send), from
//            MS_GRAPH_SENDER. Sent unless their profile turns approval emails off.
//
// Each notification, sent or not, is audited (notify.approval_sent / notify.approval_skipped / notify.failed).
const PEOPLE_DIR = ['teams', 'people'];
const KIND_WORDS = { spec: 'Spec review', adr: 'Architecture decision', 'ui-handoff': 'Handoff to the Software Factory', merge: 'Merge', stage: 'Move to the next stage', 'infra-design': 'Infrastructure design' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {object} o
 * @param {object} o.config   { publicBaseUrl, graph: { tenantId, clientId, secret, sender }, teams: { appId } }
 * @param {{ createPersonal, send, configured }} o.connector  the Teams bot's connector
 * @param {{ attachment }} o.cards
 */
export function createNotify({ store, people, profiles, connector, cards, events, auditLog, config, fetch: fetchImpl = globalThis.fetch, clock = Date, log }) {
  const base = String(config.publicBaseUrl || '').replace(/\/+$/, '');
  const linkTo = (path) => `${base}${path}`;
  const graph = config.graph ?? {};
  const emailReady = Boolean(graph.tenantId && graph.clientId && graph.secret && graph.sender);
  let graphToken = null;
  const audit = (entry) => auditLog.record(entry).catch((err) => log?.warn?.(`notify audit: ${err.message}`));

  // ---------------------------------------------------------------------------- where a person is in Teams

  /** Keeps how to reach a person in Teams, from an activity they sent the bot (any chat; personal is best). */
  async function remember(person, a) {
    if (a.via !== 'teams' || !a.serviceUrl || !a.from?.id) return;
    const file = [...PEOPLE_DIR, `${person.id}.yaml`];
    const known = (await store.readYaml(file)) ?? {};
    const next = {
      personId: person.id, userId: a.from.id, serviceUrl: a.serviceUrl, tenantId: a.tenantId ?? known.tenantId ?? null,
      conversationId: a.personal ? a.conversationId : known.conversationId ?? null,
      botId: a.recipient?.id ?? known.botId ?? null,
    };
    if (JSON.stringify({ ...known, updatedAt: undefined }) === JSON.stringify({ ...next, updatedAt: undefined })) return;
    await store.writeYaml(file, { ...next, updatedAt: new Date(clock.now()).toISOString() });
  }

  async function teamsMessage(person, approval) {
    const ref = await store.readYaml([...PEOPLE_DIR, `${person.id}.yaml`]);
    if (!ref?.serviceUrl || !ref.userId) return { sent: false, why: 'they have not installed the NooblyJS app in Teams' };
    if (!connector.configured) return { sent: false, why: 'NooblyJS has no Teams bot registered' };
    let conversationId = ref.conversationId;
    if (!conversationId) {
      conversationId = await connector.createPersonal({ serviceUrl: ref.serviceUrl, tenantId: ref.tenantId, userId: ref.userId });
      await store.writeYaml([...PEOPLE_DIR, `${person.id}.yaml`], { ...ref, conversationId, updatedAt: new Date(clock.now()).toISOString() });
    }
    const a = { via: 'teams', serviceUrl: ref.serviceUrl, conversationId, recipient: { id: ref.botId ?? `28:${config.teams?.appId}`, name: 'NooblyJS' }, from: { id: ref.userId, name: person.name } };
    await connector.send(a, {
      type: 'message',
      summary: `Approval waiting: ${approval.title}`,
      attachments: [cards.attachment('approval-waiting', { title: approval.title, item: approval.item, requestedBy: approval.requestedBy, kind: approval.kind, url: approval.url })],
    });
    return { sent: true };
  }

  // ---------------------------------------------------------------------------- email through Microsoft Graph

  async function graphAccessToken() {
    if (graphToken && clock.now() < graphToken.until) return graphToken.value;
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(graph.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: graph.clientId, client_secret: graph.secret, scope: 'https://graph.microsoft.com/.default' }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`Microsoft did not give NooblyJS a Graph token: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
    graphToken = { value: body.access_token, until: clock.now() + Math.max(60, (Number(body.expires_in) || 3600) - 300) * 1000 };
    return graphToken.value;
  }

  async function email(person, approval) {
    if (!emailReady) return { sent: false, why: 'email is not set up (MS_GRAPH_* in NooblyJS\'s environment)' };
    if (!person.email) return { sent: false, why: 'they have no email address in NooblyJS' };
    const html = `<p style="font-family:Segoe UI,Arial,sans-serif;color:#1B2433">An approval in NooblyJS is waiting for you.</p>
<p style="font-family:Segoe UI,Arial,sans-serif;font-size:16px;color:#14274E"><strong>${escapeHtml(approval.title)}</strong></p>
<p style="font-family:Segoe UI,Arial,sans-serif;color:#3A4456">${escapeHtml(approval.kind)} · ${escapeHtml(approval.item)} · asked by ${escapeHtml(approval.requestedBy)}</p>
<p><a href="${escapeHtml(approval.url)}" style="font-family:Segoe UI,Arial,sans-serif;background:#14274E;color:#FFFFFF;padding:10px 18px;border-radius:999px;text-decoration:none">Open the approval</a></p>
<p style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#4A5466">Decide it in NooblyJS. Replying to this email does nothing.</p>`;
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graph.sender)}/sendMail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await graphAccessToken()}` },
      body: JSON.stringify({
        message: { subject: `Approval waiting: ${approval.title}`, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: person.email, name: person.name } }] },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Microsoft Graph did not send the email (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return { sent: true };
  }

  // ---------------------------------------------------------------------------- approval.requested

  async function onApprovalRequested(event) {
    const p = event.payload ?? {};
    const reviewers = Array.isArray(p.reviewerIds) ? p.reviewerIds : [];
    if (!p.approvalId || !reviewers.length) return [];
    const asker = event.actor ? await people.get(event.actor).catch(() => null) : null;
    const approval = {
      id: p.approvalId,
      title: String(p.summary ?? '').replace(/^asked for (the )?review of /i, '') || p.itemId || 'An approval',
      item: p.itemId ?? '',
      kind: KIND_WORDS[p.type] ?? 'Approval',
      requestedBy: asker?.name ?? p.actorName ?? 'NooblyJS',
      url: linkTo(`/home/approvals?id=${encodeURIComponent(p.approvalId)}`),
    };
    const results = [];
    for (const id of reviewers) {
      const person = await people.get(id).catch(() => null);
      if (!person?.active) continue;
      const prefs = (await profiles.get(person.id).catch(() => null))?.notifications ?? {};
      for (const [channel, wanted, send] of [['teams', prefs.approvalsInTeams === true, teamsMessage], ['email', prefs.approvalsByEmail !== false, email]]) {
        const base = { actor: 'notify', target: person.id, approvalId: approval.id, itemId: approval.item, channel };
        if (!wanted) {
          results.push({ person: person.id, channel, sent: false, why: 'their profile turns it off' });
          continue;
        }
        try {
          const r = await send(person, approval);
          results.push({ person: person.id, channel, ...r });
          await audit({ ...base, action: r.sent ? 'notify.approval_sent' : 'notify.approval_skipped', ...(r.why ? { reason: r.why } : {}) });
        } catch (err) {
          results.push({ person: person.id, channel, sent: false, why: err.message });
          log?.warn?.(`notify: ${channel} to ${person.id} for ${approval.id} failed: ${err.message}`);
          await audit({ ...base, action: 'notify.failed', reason: err.message });
        }
      }
    }
    return results;
  }

  const pending = new Set();
  const unsubscribe = events.on('approval.requested', (event) => {
    const run = onApprovalRequested(event).catch((err) => log?.error?.(`notify: ${err.message}`)).finally(() => pending.delete(run));
    pending.add(run);
    return run;
  });

  return {
    remember,
    onApprovalRequested,
    status: () => ({ email: emailReady, teams: connector.configured, sender: emailReady ? graph.sender : null }),
    settled: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    close: () => unsubscribe?.(),
  };
}
