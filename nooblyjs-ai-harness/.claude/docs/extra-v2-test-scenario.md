# A test scenario for the v2 features

One session that exercises every v2 feature (Phases 20–30) with a real model. Run it in a throwaway git repo, so nothing important is touched.

---

## Setup (once)

```bash
mkdir /tmp/noobly-v2-test && cd /tmp/noobly-v2-test && git init -q
npm init -y >/dev/null && echo "node_modules" > .gitignore
git add -A && git commit -qm "empty project"
node ~/nooblyjs-learn-harness/bin/noobly.js      # needs an API key (Anthropic recommended)
```

Put any screenshot, e.g. `shot.png`, in that folder for the image test.

## The main prompt (paste as one message)

```text
Build a tiny web app here, working step by step:

1. Get your bearings first with RepoMap, then create server.js: a Node http server
   on port 4567 serving index.html, plus a GET /api/health route returning {"ok":true}.
   Add index.html with a heading and a button that calls /api/health.

2. Start the server in the background, wait until it says it's listening,
   then check both routes with curl. Keep it running.

3. Try `npm install express` and tell me what happens and why.

4. Use two subagents IN PARALLEL, each in its own worktree:
   - one adds a README.md explaining how to run the app
   - one adds a test file test/health.test.js using node:test that calls /api/health
   Tell me the branch names when they're done.

5. Run: for i in $(seq 1 30000); do echo "log line $i"; done; echo "SECRET_MARKER at the end"
   then tell me exactly which line number contains "log line 17777".

6. Finally, rename the route /api/health to /api/status everywhere in server.js
   and index.html, stop the server, and give me a summary.
```

## What each step tests (watch for these)

| Step | Feature | What you should see |
|---|---|---|
| 1 | **Repo map (27)**, **feedback (24)**, **checkpoints (21)** | A `RepoMap` call. After each Write, a `⚠ new problems` note only if it wrote broken JS. |
| 2 | **Background tasks (22)**, **sandbox (20)** | `sandboxed · background task 1`; `TaskOutput … until /listening/`; curl works, with no permission prompts; `⚙ 1 background` in the status bar. |
| 3 | **Sandbox network (20)** | `npm install` fails with a `[sandbox] … no network access` note. The model should explain this and ask you, or request `dangerouslyDisableSandbox` (a red warning dialog). It should not keep retrying. |
| 4 | **Worktrees (29)** | Two Task calls running at the same time, and two `noobly/…` branches returned. Your folder is unchanged until you merge. |
| 5 | **Big output (26)** | A preview ending in "full output is saved in …". The model then uses Read with an offset or Grep on that file to answer 17777. |
| 6 | **MultiEdit (25)**, **TaskOutput/TaskStop (22)** | Several edits in one call (or ApplyPatch on OpenAI), then `TaskStop`. |

## Then try these yourself

```text
/tasks                         # the stopped server
/diff                          # everything noobly changed
/merge                         # lists the two worktree branches
/merge noobly/…                # merge one of them
```

Then:

1. Press **Esc Esc**, pick step 6's message, and choose **Code only**. The rename is undone, and `/diff` shows it (**rewind, 21**).
2. Send `look at shot.png and describe it` to test **images (28)**. Also ask *"what does Read show for shot.png?"*
3. If you've set `BRAVE_SEARCH_API_KEY` or `TAVILY_API_KEY`, ask *"search the web for the latest Node.js LTS version"* to test **WebSearch (28)**. It should ask permission first.

## Editor test (ACP, 30)

In Zed, add a custom agent server with command `node`, args `["<path>/bin/noobly.js", "acp"]`, and send it step 2. Tool calls and permission questions should appear in the editor.

## Notes

**Cost:** expect a few dollars on a large model.

**Most likely to go wrong** (these depend on the model following the tool descriptions, which couldn't be tested offline):

- **Step 3:** does the model handle the sandbox failure well, or keep retrying?
- **Step 4:** does it actually set `isolation: "worktree"`?

If either fails, that tells us where the tool descriptions or the system prompt need work.
