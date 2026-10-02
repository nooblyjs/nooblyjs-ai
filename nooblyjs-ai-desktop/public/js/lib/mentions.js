// Typing `@` in the composer opens a filter list of the project's documents.
// Choosing one inserts its path, which the server parses back out and includes
// in context in full.

export function wireMentions(input, { projectId, container = document.body }) {
  let documents = null;
  let menu = null;
  let items = [];
  let activeIndex = 0;
  let anchor = -1;

  async function loadDocuments() {
    if (documents) return documents;
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/list`);
      documents = res.ok ? (await res.json()).documents : [];
    } catch {
      documents = [];
    }
    return documents;
  }

  function close() {
    menu?.remove();
    menu = null;
    items = [];
    anchor = -1;
  }

  function quoteIfNeeded(path) {
    return /\s/.test(path) ? `@"${path}"` : `@${path}`;
  }

  function choose(doc) {
    const before = input.value.slice(0, anchor);
    const after = input.value.slice(input.selectionStart);
    const insert = `${quoteIfNeeded(doc.path)} `;
    input.value = before + insert + after;
    const caret = before.length + insert.length;
    input.setSelectionRange(caret, caret);
    close();
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function highlight() {
    menu?.querySelectorAll('.mention-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
      if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function render(matches) {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'mention-menu dropdown-menu show';
      menu.setAttribute('role', 'listbox');
      container.append(menu);
    }
    menu.replaceChildren();
    items = matches;
    activeIndex = 0;

    for (const doc of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mention-item dropdown-item';
      button.setAttribute('role', 'option');
      const fileIcon = document.createElement('i');
      fileIcon.className = 'bi bi-file-earmark-text';
      fileIcon.setAttribute('aria-hidden', 'true');
      button.append(fileIcon, ' ');

      const slash = doc.path.lastIndexOf('/');
      if (slash !== -1) {
        const dir = document.createElement('span');
        dir.className = 'mention-dir';
        dir.textContent = `${doc.path.slice(0, slash + 1)} `;
        button.append(dir);
      }
      button.append(document.createTextNode(doc.title));
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(doc);
      });
      menu.append(button);
    }

    const rect = input.getBoundingClientRect();
    menu.style.left = `${rect.left + window.scrollX}px`;
    menu.style.bottom = `${window.innerHeight - rect.top - window.scrollY + 6}px`;
    highlight();
  }

  /** Finds an `@token` immediately before the caret, if the caret is in one. */
  function activeToken() {
    const caret = input.selectionStart;
    const text = input.value.slice(0, caret);
    const at = text.lastIndexOf('@');
    if (at === -1) return null;
    if (at > 0 && !/[\s(]/.test(text[at - 1])) return null;
    const term = text.slice(at + 1);
    if (/[\n]/.test(term)) return null;
    return { at, term };
  }

  input.addEventListener('input', async () => {
    const token = activeToken();
    if (!token) return close();

    const all = await loadDocuments();
    if (all.length === 0) return close();

    const needle = token.term.replace(/^"/, '').toLowerCase();
    const matches = all
      .filter((doc) => doc.path.toLowerCase().includes(needle))
      .slice(0, 8);

    if (matches.length === 0) return close();
    anchor = token.at;
    render(matches);
  });

  input.addEventListener('keydown', (event) => {
    if (!menu) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      highlight();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      highlight();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      // The composer's own Enter-to-send listener is on this same element, so
      // stopPropagation is not enough — it would send the message as well.
      event.stopImmediatePropagation();
      choose(items[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }, true); // capture, so Enter selects instead of sending

  input.addEventListener('blur', () => setTimeout(close, 120));

  return { close, invalidate: () => { documents = null; } };
}
