// An inline chat: transcript, model picker and composer, mounted inside a chat
// row on the project page. Built from the <template data-chat-template> there.

import { api, toast } from './api.js';
import { renderMarkdown } from './markdown.js';
import { wireModelPicker } from './modelPicker.js';
import { streamSSE } from './sse.js';
import { wireMentions } from './mentions.js';

function describeMeta(meta) {
  const parts = [meta.model || meta.provider];
  if (meta.outputTokens) parts.push(`${meta.inputTokens} in / ${meta.outputTokens} out`);
  if (meta.latencyMs) parts.push(`${(meta.latencyMs / 1000).toFixed(1)}s`);
  if (meta.finishReason === 'aborted') parts.push('stopped');
  if (meta.truncatedHistory) parts.push('earlier turns trimmed');
  return parts.filter(Boolean).join(' · ');
}

/**
 * @param {HTMLElement} slot  element the panel is rendered into
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.chatId
 * @param {HTMLTemplateElement} options.template
 * @param {(chat: object) => void} [options.onTitle]  called when the title changes
 * @param {() => void} [options.onActivity]           called after each turn
 */
export async function mountChat(slot, { projectId, chatId, template, onTitle, onActivity }) {
  const chatUrl = `/api/projects/${projectId}/chats/${chatId}`;
  const { chat, effective } = await api('GET', chatUrl);

  slot.replaceChildren(template.content.cloneNode(true));

  const transcript = slot.querySelector('[data-transcript]');
  const form = slot.querySelector('[data-composer]');
  const input = slot.querySelector('[data-composer-input]');
  const sendBtn = slot.querySelector('[data-send]');
  const stopBtn = slot.querySelector('[data-stop]');
  const banner = slot.querySelector('[data-stream-banner]');
  const pickerEl = slot.querySelector('[data-model-picker]');

  // The template renders the picker with nothing selected; ids must be unique
  // per panel so the visually-hidden labels still point at the right field.
  for (const el of pickerEl.querySelectorAll('[id]')) {
    const label = pickerEl.querySelector(`label[for="${el.id}"]`);
    el.id = `${el.id}-${chatId}`;
    if (label) label.htmlFor = el.id;
  }
  if (effective) {
    pickerEl.querySelector('[data-provider-select]').value = effective.provider;
    pickerEl.querySelector('[data-model-select]').value = effective.model;
  }
  const picker = wireModelPicker(pickerEl, {
    onChange: ({ provider, model }) => {
      api('PATCH', chatUrl, { provider, model }).catch((err) => toast(err.message));
    }
  });

  const mentions = input.disabled ? null : wireMentions(input, { projectId });

  /* ---- transcript helpers -------------------------------------------- */

  function atBottom() {
    return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
  }

  function scrollToBottom() {
    transcript.scrollTop = transcript.scrollHeight;
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

  function appendMessage(role, content, { streaming = false } = {}) {
    transcript.querySelector('[data-empty-state]')?.remove();

    const article = document.createElement('article');
    article.className = `message message-${role}${streaming ? ' message-streaming' : ''}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'message-role';
    const roleIcon = document.createElement('i');
    roleIcon.className = `bi ${role === 'user' ? 'bi-person-circle' : 'bi-stars'}`;
    roleIcon.setAttribute('aria-hidden', 'true');
    roleEl.append(roleIcon, ` ${role === 'user' ? 'You' : 'Assistant'}`);

    const body = document.createElement('div');
    if (role === 'assistant') {
      body.className = 'message-body markdown-body';
      body.innerHTML = renderMarkdown(content);
    } else {
      body.className = 'message-body';
      body.textContent = content;
    }

    article.append(roleEl, body);
    transcript.append(article);
    return { article, body };
  }

  for (const m of chat.messages) {
    const { article } = appendMessage(m.role, m.content);
    if (m.meta?.error) article.classList.add('is-error');
    if (m.meta) setMeta(article, describeMeta(m.meta));
    renderSources(article, m.meta?.sources);
  }
  if (chat.messages.length === 0) transcript.querySelector('[data-empty-state]').hidden = false;
  scrollToBottom();

  /* ---- composer ------------------------------------------------------ */

  // While empty, size to the placeholder so a long one is not cut off on a
  // narrow screen; scrollHeight ignores placeholder text, so measure it as a value.
  function autoGrow() {
    const empty = !input.value;
    if (empty) input.value = input.placeholder;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + (input.offsetHeight - input.clientHeight), 260)}px`;
    if (empty) input.value = '';
  }
  input.addEventListener('input', autoGrow);
  window.addEventListener('resize', autoGrow);
  autoGrow();

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
    if (!isStreaming && slot.isConnected) input.focus();
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
    scrollToBottom();

    const { article, body } = appendMessage('assistant', '', { streaming: true });
    scrollToBottom();
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
      const stream = streamSSE(`${chatUrl}/messages`, {
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
      onActivity?.();
    }
  });

  /* ---- title --------------------------------------------------------- */

  let title = chat.title;

  async function refreshTitle() {
    try {
      const { chat: latest } = await api('GET', chatUrl);
      if (latest.title !== title) {
        title = latest.title;
        onTitle?.(latest);
      }
    } catch {
      // A stale title is not worth surfacing.
    }
  }

  async function rename() {
    const next = window.prompt('Rename chat', title);
    if (next === null) return;
    try {
      const { chat: updated } = await api('PATCH', chatUrl, { title: next });
      title = updated.title;
      onTitle?.(updated);
    } catch (err) {
      toast(err.message);
    }
  }

  slot.querySelector('[data-rename-chat]').addEventListener('click', rename);

  if (!input.disabled) input.focus({ preventScroll: true });

  return {
    isStreaming: () => controller !== null,
    destroy() {
      controller?.abort();
      mentions?.close();
      window.removeEventListener('resize', autoGrow);
      slot.replaceChildren();
    }
  };
}
