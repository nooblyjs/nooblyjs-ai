# PRD — LLM Project Desktop

**Status:** Draft v1
**Owner:** Stephen Booysen
**Last updated:** 2026-09-11

---

## 1. Summary

A self-hosted, single-user web application that reproduces the "Projects" workflow of
Claude Code Desktop, but lets the user choose which LLM answers — Anthropic Claude,
OpenAI, Google Gemini, or DeepSeek.

A **project** is a named workspace with a description. That description is injected as
persistent context into every chat opened inside the project. Chats are resumable: full
conversation history is retained and replayed on continuation.

Everything is stored as plain files on the local filesystem — projects are folders, chats
are files. No database, no cloud account, no React.

## 2. Problem statement

Claude Code Desktop's Projects feature is a good model for organising long-running work:
a durable description that acts as shared context, plus many chats that inherit it. It is
locked to a single vendor.

Users who want to compare model behaviour, control cost, or avoid vendor lock-in currently
have to either re-paste context into each provider's own chat UI, or adopt a heavyweight
platform. Neither preserves the simple project→chats structure or keeps data in files the
user owns.

## 3. Goals

| # | Goal |
|---|------|
| G1 | Create, read, update, delete projects with a name and a free-text description |
| G2 | Open multiple chats inside a project; the project description is automatic context |
| G3 | Resume any past chat with complete context intact |
| G4 | Configure and switch between Claude, OpenAI, Gemini and DeepSeek |
| G5 | Store all state as human-readable files on the filesystem |
| G6 | Server-rendered Node.js + Express, vanilla client-side JS, no React |

## 4. Non-goals (v1)

- Multi-user accounts, authentication, or sharing. Single-user, localhost-bound.
- Agentic tool use, file editing, or shell execution. This is a chat surface, not a coding agent.
- Vector/embedding search. Retrieval is lexical (see FR-27); embeddings would force an
  OpenAI dependency on users who chat with another provider.
- Non-markdown documents (PDF, docx, images). Markdown only.
- Mobile-native apps. The UI must be usable at narrow widths, but it is a web app.
- Cloud sync or hosted deployment. Local-first only.
- Image, audio or video input.

## 5. Users

**Primary — the practitioner.** A developer or analyst running several long-lived
workstreams at once. Each workstream has standing context ("this is a Rust CLI that parses
NMEA sentences; prefer terse answers; we target stable 1.83"). They want to ask questions
against that context without re-explaining, and they want to see whether GPT or Gemini
answers a given question better than Claude does.

They are comfortable editing a `.env` file and running `npm start`. They value their data
being in files they can grep, back up, and put in git.

## 6. User stories

### Projects
- **US-1** As a user I can create a project with a name and a multi-line description, so
  that the description becomes reusable context.
- **US-2** As a user I can see all my projects on a home screen with name, description
  excerpt, chat count, and last-activity time.
- **US-3** As a user I can edit a project's name and description in place on the project
  page — no dialog — with changes saving as I type; edits apply to subsequent turns in all
  its chats, including existing ones.
- **US-4** As a user I can delete a project, with a confirmation step, and its chats go
  with it.
- **US-5** As a user I can set a per-project default provider and model, which new chats
  inherit.

### Chats
- **US-6** As a user I can start a new chat inside a project and the project description is
  already in context — I do not paste it.
- **US-7** As a user I can see responses stream in token by token.
- **US-8** As a user I can see the list of chats in a project, ordered by most recent
  activity, each with an auto-generated title.
- **US-9** As a user I can reopen a previous chat and continue it; the model receives the
  full prior conversation.
- **US-10** As a user I can switch provider or model mid-chat, and the new provider receives
  the conversation so far.
- **US-11** As a user I can rename or delete a chat.
- **US-12** As a user I can see which provider and model produced each assistant message.

### Documents
- **US-16** As a user I can create folders and markdown documents inside a project, nested
  as deeply as I like.
- **US-17** As a user I can edit a document and see it saved, and preview its rendered
  markdown.
- **US-18** As a user I can rename and delete documents and folders, with a confirmation
  on delete.
- **US-19** As a user I can drag a document or folder into another folder, or back to the
  top level, to reorganise without dialogs.
- **US-20** As a user I can reference a specific document in a chat with `@`, and the
  model receives that document in full.
- **US-21** As a user I can ask a question without naming a document and have the model
  answer from the relevant one, found automatically.
- **US-22** As a user I can see which documents an answer drew on, and whether each was
  referenced by me or retrieved automatically.
- **US-23** As a user I can edit documents in my own editor on disk and have the app and
  retrieval pick the change up without a restart.
- **US-24** As a user I can see the project's document tree on the project page beside the
  context, drag items to reorganise there, and click one to open it in the editor.

### Configuration
- **US-13** As a user I can supply API keys via environment variables and see, in the UI,
  which providers are configured.
- **US-14** As a user I can pick a global default provider and model used when a project
  states no preference.
- **US-15** As a user I can adjust temperature and max output tokens, globally and per project.

## 7. Functional requirements

### 7.1 Project management
- **FR-1** Name is required, 1–100 characters. Description is optional, up to 20,000
  characters, plain text or Markdown.
- **FR-2** Each project gets a stable, URL-safe ID derived from a slug of the name plus a
  short random suffix. Renaming does not change the ID.
- **FR-3** A project maps to exactly one directory on disk. The directory is the source of
  truth; the app holds no state the filesystem does not have.
- **FR-4** A project dropped into the data directory by hand (correct `project.json`) is
  picked up on next listing, without restart.

### 7.2 Chat behaviour
- **FR-5** Every request to a provider is composed as: system prompt (app preamble +
  project description) → prior turns → new user message.
- **FR-6** The project description is read at send time, not copied into the chat at
  creation. Editing the description changes future turns.
- **FR-7** Responses stream to the browser incrementally.
- **FR-8** A chat's title is generated from the first user message (first ~60 characters,
  trimmed at a word boundary) and is user-editable thereafter.
- **FR-9** Every message is persisted to disk before the response is considered complete.
  A crash mid-stream must not lose the user's message.
- **FR-10** When history exceeds the model's context budget, oldest turns are dropped first,
  and the UI shows that truncation occurred. The project description is never dropped.
- **FR-11** Each assistant message records the provider, model, token counts, and finish
  reason that produced it.

### 7.3 Provider configuration
- **FR-12** Four providers in v1: `anthropic`, `openai`, `gemini`, `deepseek`.
- **FR-13** API keys are read from environment variables only. They are never written to
  project or chat files and never sent to the browser — the UI shows
  configured/not-configured, not the value.
- **FR-14** A provider with no key present is visibly disabled in the picker, with a hint
  naming the environment variable to set.
- **FR-15** Each provider exposes a curated list of selectable models with context-window
  sizes. The list is configuration, editable without touching adapter code.
- **FR-16** Adding a fifth provider must mean adding one adapter module and one config
  entry — no changes to routes, storage, or UI logic.

### 7.4 Documents and retrieval
- **FR-21** Each project has a `documents/` directory holding markdown files in
  user-defined folders, nested up to 16 levels.
- **FR-22** Documents and folders can be created, renamed, moved, and deleted. A move is a
  filesystem rename; deleting a folder removes its contents.
- **FR-23** A document is a plain `.md` file. There is no sidecar metadata: the filename is
  the title and the filesystem is the structure.
- **FR-24** Files added or edited outside the app are picked up without a restart.
- **FR-25** Only `.md` files are listed. Symlinks are ignored, and no path outside the
  project's `documents/` directory is reachable by any operation.
- **FR-26** A user can reference a document in a chat by path; a referenced document is
  included in that turn's context in full, subject to the budget.
- **FR-27** Every message additionally runs a lexical (BM25) search over the project's
  documents, chunked on markdown headings; the best-matching chunks are added to context.
- **FR-28** Documents may occupy at most 40% of the usable context window. Referenced
  documents are filled first, retrieved chunks fill the remainder, and the project
  description is never displaced.
- **FR-29** Each assistant message records which documents contributed and by which route
  (referenced or retrieved), and the UI shows them.
- **FR-30** A retrieval failure degrades the turn to a normal chat rather than failing it.

### 7.5 Storage
- **FR-17** Data root defaults to `./data`, overridable by `DATA_DIR`.
- **FR-18** Chats are JSON, pretty-printed, one file per chat, diff-friendly.
- **FR-19** Writes are atomic: write to a temp file, then rename. A killed process must
  never leave a half-written chat.
- **FR-20** The data directory is safe to commit to git or sync with Dropbox.

## 8. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Performance | Project list and chat open render in < 200 ms for 100 projects × 100 chats |
| Streaming latency | First token reaches the browser within 100 ms of arriving at the server |
| Dependencies | Lean. Express, a template engine, provider SDKs, dotenv. No frontend framework, no bundler |
| Node version | Node 20 LTS or newer |
| Security | Binds to `127.0.0.1` by default. Path traversal blocked on every ID. HTML escaped on render |
| Accessibility | Keyboard-navigable; visible focus; labelled controls; usable at 400 px width |
| Resilience | A provider error surfaces as an in-chat error message; it never crashes the server or loses the user's message |
| Observability | Structured request logs; provider calls log model, latency, token counts, never key material or full prompts |

## 9. UX outline

Three screens, server-rendered, progressively enhanced.

**Projects (`/`)** — a grid of project cards: name, description excerpt, chat count, last
activity. "New project" opens a modal with name + description. Card menu offers edit and
delete.

**Project (`/projects/:id`)** — two panes. Left: project name, editable description panel,
default provider/model selector, and the chat list ordered by recency. Right: an empty
composer to start a new chat. Below 800 px the panes stack, with the chat list collapsible.

**Chat (`/projects/:id/chats/:chatId`)** — a header showing project name, chat title, and a
provider/model picker; a scrolling transcript with role-distinguished bubbles and Markdown
rendering for assistant output; a composer pinned to the bottom with Enter to send and
Shift+Enter for newline. A banner appears when history has been truncated.

Both light and dark are supported, following the OS preference.

## 10. Success criteria

1. A user creates a project, opens a chat, and gets a contextual answer without pasting
   the description — in under 60 seconds from first launch.
2. Closing the browser and reopening a chat a day later continues it with full context.
3. Asking the same question under all four providers takes only a dropdown change.
4. `ls data/projects` and `cat` on a chat file are self-explanatory to someone who has
   never read this document.
5. Killing the server mid-stream loses at most the in-flight assistant response — never a
   user message, never a whole chat.

## 11. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider APIs drift | Adapters break | Adapter isolation; one contract test suite run against all four |
| Long chats exceed context | Requests fail | Token budgeting with oldest-first truncation and a visible banner (FR-10) |
| Concurrent writes corrupt a chat | Data loss | Atomic write + per-chat write queue |
| Filesystem scan slows at scale | Sluggish list | In-memory index with `fs.watch` invalidation; revisit if > 1,000 projects |
| Keys leak into committed data | Credential exposure | Keys live only in env; `data/` contains no secrets; `.env` gitignored |

## 12. Open questions

1. Should switching provider mid-chat re-send history verbatim, or annotate the handoff so
   the new model knows another model wrote the earlier turns? *Leaning: verbatim in v1.*
2. Should projects support attached reference files as additional context? *Deferred —
   the directory layout leaves room (`files/`) so this stays open.*
3. Is per-message regeneration ("retry with a different model") worth v1? *Deferred to v2.*

## 13. Future work

- Attached project files as context (`files/` is already reserved in the layout)
- Regenerate a response with a different provider, side by side
- Full-text search across all chats
- Export a chat to Markdown
- Cost tracking per project from recorded token counts
- Ollama / local-model adapter
