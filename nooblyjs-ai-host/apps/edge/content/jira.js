// Runs on Jira Cloud issue pages. It READS the page the person has open, only when the side panel asks,
// and tells the panel when the person moves to another issue (Jira changes pages without reloading).
// It never changes the page: no typing into fields, no clicks, no saves. Putting a reviewed draft into a
// Jira field is planned for Phase 14 and needs the decision recorded there.
(() => {
  const KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;

  function issueKey() {
    const fromPath = location.pathname.match(/\/browse\/([A-Z][A-Z0-9]{1,9}-\d+)/);
    if (fromPath) return fromPath[1];
    const fromQuery = new URLSearchParams(location.search).get('selectedIssue');
    return fromQuery && KEY.test(fromQuery) ? fromQuery : null;
  }

  function text(selector) {
    return document.querySelector(selector)?.textContent?.trim() || null;
  }

  /** What NooblyJS may use about this page: the issue's key, summary, type and status, and the site. */
  function context() {
    const key = issueKey();
    return {
      kind: key ? 'jira-issue' : 'jira',
      site: location.host,
      url: location.href,
      key,
      summary: text('[data-testid="issue.views.issue-base.foundation.summary.heading"]'),
      type: text('[data-testid="issue.views.issue-base.foundation.change-issue-type.button"]'),
      status: text('[data-testid="issue.views.issue-base.foundation.status.status-field-wrapper"]'),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'noobly:context') reply(context());
  });

  // Jira is a single-page app: watch the address and say when it changes.
  let last = location.href;
  setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    chrome.runtime.sendMessage({ type: 'noobly:context-changed' }).catch(() => {});
  }, 1000);
})();
