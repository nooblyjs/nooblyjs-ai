import { api, toast } from './lib/api.js';
import { renderMarkdown, hydrateMarkdown } from './lib/markdown.js';
import { wireModelPicker } from './lib/modelPicker.js';
import { streamSSE } from './lib/sse.js';
import { wireMentions } from './lib/mentions.js';

const shell = document.querySelector('.app-shell[data-chat-id]');
const projectId = shell.dataset.projectId;
const chatId = shell.dataset.chatId;

const transcript = document.querySelector('[data-transcript]');
const form = document.querySelector('[data-composer]');
const input = document.querySelector('[data-composer-input]');
const sendBtn = document.querySelector('[data-send]');
const stopBtn = document.querySelector('[data-stop]');
const banner = document.querySelector('[data-stream-banner]');
const titleEl = document.querySelector('[data-chat-title]');

const picker = wireModelPicker(document.querySelector('[data-model-picker]'), {
  onChange: ({ provider, model }) => {
    api('PATCH', `/api/projects/${projectId}/chats/${chatId}`, { provider, model }).catch((err) =>
      toast(err.message)
    );
  }
});

hydrateMarkdown(transcript);
wireMentions(input, { projectId });

/* ---- transcript helpers ---------------------------------------------- */

function atBottom() {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
}

function scrollToBottom() {
  transcript.scrollTop = transcript.scrollHeight;
}

function appendMessage(role, content, { streaming = false, markdown = false } = {}) {
  document.querySelector('[data-empty-state]')?.remove();

  const article = document.createElement('article');
  article.className = `message message-${role}${streaming ? ' message-streaming' : ''}`;

  const roleEl = document.createElement('div');
  roleEl.className = 'message-role';
  const roleIcon = document.createElement('i');
  roleIcon.className = `bi ${role === 'user' ? 'bi-person-circle' : 'bi-stars'}`;
  roleIcon.setAttribute('aria-hidden', 'true');
  roleEl.append(roleIcon, ` ${role === 'user' ? 'You' : 'Assistant'}`);

  const body = document.createElement('div');
  body.className = markdown || role === 'assistant' ? 'message-body markdown-body' : 'message-body';
  if (markdown) body.innerHTML = renderMarkdown(content);
  else body.textContent = content;

  article.append(roleEl, body);
  transcript.append(article);
  scrollToBottom();
  return { article, body };
}

function setMeta(article, text) {
  let el = article.querySelector('.message-meta');
  if (!el) {
    el = document.createElement('div');
    el.className = 'message-meta';
    article.append(el);
  }
  el.textContent = text;
}

function renderSources(article, sources) {
  if (!sources || sources.length === 0) return;
  const wrap = document.createElement('div');
  wrap.className = 'message-sources';

  const label = document.createElement('span');
  label.className = 'small text-muted';
  label.textContent = 'Sources:';
  wrap.append(label);

  for (const source of sources) {
    const chip = document.createElement('span');
    chip.className = `source-chip is-${source.kind.replace('referenced-truncated', 'referenced')}`;
    const icon = document.createElement('i');
    icon.className = 'bi bi-file-earmark-text';
    icon.setAttribute('aria-hidden', 'true');
    chip.append(icon, ` ${source.heading ? `${source.path} › ${source.heading}` : source.path}`);
    if (source.kind === 'missing') chip.title = 'Referenced but not found';
    if (source.kind === 'retrieved') chip.title = `Matched automatically (score ${source.score})`;
    if (source.kind === 'referenced-truncated') chip.title = 'Referenced; too long to include in full';
    wrap.append(chip);
  }
  article.append(wrap);
}

function describeMeta(meta) {
  const parts = [meta.model || meta.provider];
  if (meta.outputTokens) parts.push(`${meta.inputTokens} in / ${meta.outputTokens} out`);
  if (meta.latencyMs) parts.push(`${(meta.latencyMs / 1000).toFixed(1)}s`);
  if (meta.finishReason === 'aborted') parts.push('stopped');
  return parts.filter(Boolean).join(' · ');
}

/* ---- composer -------------------------------------------------------- */

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
}
input.addEventListener('input', autoGrow);

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

let controller = null;

function setStreaming(isStreaming) {
  sendBtn.hidden = isStreaming;
  stopBtn.hidden = !isStreaming;
  input.disabled = isStreaming;
  if (!isStreaming) input.focus();
}

stopBtn.addEventListener('click', () => controller?.abort());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || controller) return;

  input.value = '';
  autoGrow();
  banner.hidden = true;
  appendMessage('user', content);

  const { article, body } = appendMessage('assistant', '', { streaming: true });
  controller = new AbortController();
  setStreaming(true);

  let text = '';
  let pendingSources = [];
  let stickToBottom = true;

  // Deltas arrive faster than the screen repaints, so re-render the Markdown
  // at most once per frame rather than once per token.
  let renderQueued = false;
  const renderNow = () => {
    renderQueued = false;
    if (text) body.innerHTML = renderMarkdown(text);
    if (stickToBottom) scrollToBottom();
  };
  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  };

  try {
    const stream = streamSSE(`/api/projects/${projectId}/chats/${chatId}/messages`, {
      body: { content, ...(picker ? picker.value() : {}) },
      signal: controller.signal
    });

    for await (const { event: name, data } of stream) {
      if (name === 'meta') {
        pendingSources = data.sources || [];
        const notes = [];
        if (data.truncatedHistory) {
          notes.push(
            `Context limit reached — the ${data.droppedCount} oldest message${
              data.droppedCount === 1 ? '' : 's'
            } were not sent. The project description is always included.`
          );
        }
        if (data.modelFellBack) notes.push(`Falling back to ${data.modelLabel}.`);
        if (notes.length) {
          banner.textContent = notes.join(' ');
          banner.hidden = false;
        }
      } else if (name === 'delta') {
        stickToBottom = atBottom();
        text += data.text;
        queueRender();
      } else if (name === 'error') {
        article.classList.add('is-error');
        if (!text) body.textContent = data.message;
        else {
          renderNow();
          setMeta(article, data.message);
        }
      } else if (name === 'done') {
        renderNow();
        setMeta(article, describeMeta(data.meta));
        renderSources(article, pendingSources);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      article.classList.remove('message-streaming');
      renderNow();
      setMeta(article, 'stopped');
    } else {
      article.classList.add('is-error');
      if (text) {
        renderNow();
        setMeta(article, err.message);
      } else {
        body.textContent = err.message;
      }
    }
  } finally {
    article.classList.remove('message-streaming');
    controller = null;
    setStreaming(false);
    if (stickToBottom) scrollToBottom();
    refreshTitle();
  }
});

/* ---- title ----------------------------------------------------------- */

async function refreshTitle() {
  try {
    const { chat } = await api('GET', `/api/projects/${projectId}/chats/${chatId}`);
    if (chat.title !== titleEl.textContent) {
      titleEl.textContent = chat.title;
      document.title = `${chat.title} · LLM Projects`;
      document.querySelector('.sidebar-item.active .chat-title').textContent = chat.title;
    }
  } catch {
    // A stale title is not worth surfacing.
  }
}

document.querySelector('[data-rename-chat]').addEventListener('click', async () => {
  const title = window.prompt('Rename chat', titleEl.textContent.trim());
  if (title === null) return;
  try {
    const { chat } = await api('PATCH', `/api/projects/${projectId}/chats/${chatId}`, { title });
    titleEl.textContent = chat.title;
    document.querySelector('.sidebar-item.active .chat-title').textContent = chat.title;
  } catch (err) {
    toast(err.message);
  }
});

document.querySelector('[data-new-chat]').addEventListener('click', async () => {
  try {
    const { chat } = await api('POST', `/api/projects/${projectId}/chats`, {});
    window.location.href = `/projects/${projectId}/chats/${chat.id}`;
  } catch (err) {
    toast(err.message);
  }
});

scrollToBottom();
input.focus();
