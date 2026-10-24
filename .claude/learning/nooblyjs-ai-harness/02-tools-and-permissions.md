# nooblyjs-ai-harness: tools and permissions

**Lesson 02 · about 15 minutes · 2026-10-24**

## What you'll learn

- What **tools** are: the harness's API for the model to ask for things to be done.
- How the **permission gate** decides whether a tool call may run: deny rules, allow rules, permission modes.
- Why the model's request is not the same as permission to run it.

## The idea, in plain words

The agent loop (lesson 01) shows how a model asks for work and the harness does it. But not every request should be allowed. The model might ask to read a secret file or delete the entire repository. The harness has a **permission gate** that decides: "I trust the model's request, but I don't trust the file the model read. So I'll check before allowing this."

Think of a worker with a power drill in a factory. The drill can do a lot of useful things (make holes, drive screws). But you don't want the worker to drill through a live power cable. So you have rules:

- **Allow**: drill through wood and plastic
- **Deny**: drill through wires, pipes, or anything marked with a red X
- **Ask first**: anything else that seems risky

The harness works the same way. Tools are like the drill. The model says "I want to use the Bash tool to run this command". The permission gate checks:

1. **Is there a deny rule for this?** (strict check, nothing gets past it)
2. **What permission mode are we in?** (bypass, plan, acceptEdits, or default)
3. **Is there an allow rule for this?** (explicit allowlist)
4. **Is this tool read-only?** (no side effects, usually safe)
5. **Should I ask the user?** (everything else)

The key rule: **the model's word doesn't count.** The model might read a file saying "this is a config file, you can delete it", but a deny rule that protects all `*.env` files will still block it.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/tools/` | Each tool is a module: `read.js`, `bash.js`, `edit.js`, `write.js`, `grep.js`, `glob.js`. Each defines what it does and whether it's read-only. |
| `src/permissions/gate.js` | The permission gate: `decide(session, tool, input)` returns `allow`, `deny`, or `ask`. The decision order is documented in the header comments (Phase 06 onwards). |
| `src/permissions/rules.js` | How to parse a permission rule (e.g., `"Read(**/.env*)"`) and match it against a tool call (e.g., `"run Read on /home/user/.env.local"`). |
| `src/permissions/modes.js` | Four permission modes: `default` (ask when in doubt), `bypass` (allow everything), `plan` (deny everything that changes things), `acceptEdits` (auto-allow Edit/Write). |
| `src/config/defaults.js` | The default allow and deny rules. These are conservative: they allow reading common files, deny reading secrets. |
| `src/permissions/defaults.js` | The built-in allow/deny rule lists. |
| `.noobly/settings.json` or the command line | Where you can add custom allow/deny rules. |

## A small piece of code

**`src/permissions/gate.js:47–80`** — The permission decision, simplified:

```javascript
export function decide(session, tool, input) {
  const target = permissionTarget(tool.name, input);  // what file/command?
  
  // 1. Deny rules are absolute: nothing gets past them
  if (deniedBy(session, tool.name, target)) {
    return { behavior: 'deny', reason: 'Blocked by deny rule' };
  }
  
  // 2. Bypass mode: allow everything
  if (session.permissions.mode === 'bypass') {
    return { behavior: 'allow', reason: 'bypass mode' };
  }
  
  // 3. Plan mode: deny tools that change things
  if (session.permissions.mode === 'plan' && !tool.isReadOnly) {
    return { behavior: 'deny', reason: 'plan mode' };
  }
  
  // 4. Allow rules: is there an explicit allow?
  if (isAllowed(session.permissions.allow, tool.name, target)) {
    return { behavior: 'allow', reason: 'allowed by rule' };
  }
  
  // 5. Read-only tools are usually safe
  if (tool.isReadOnly) {
    return { behavior: 'allow', reason: 'read-only tool' };
  }
  
  // 6. Everything else: ask
  return { behavior: 'ask', reason: 'needs your permission' };
}
```

This is the whole policy in one function. Each step is a layer of defense.

**`src/config/defaults.js:30–50`** — The default allow rules:

```javascript
export const DEFAULT_ALLOW = [
  'Read(**/package.json)',      // reading package files is usually safe
  'Read(**/*.md)',               // markdown docs
  'Read(**/*.js)',               // source code
  'Bash(npm install)',           // installing dependencies
  'Bash(npm test)',              // running tests
  'Edit(**/*.js)',               // editing source code
];
```

These are pre-approved because they're low-risk. Reading `.md` files won't hurt anything. Running `npm test` is generally safe (it doesn't deploy or delete things). Edit-ing code files is fine, but editing `.env` is denied by default.

**`src/tools/read.js:15–25`** — A tool definition:

```javascript
export const Read = {
  name: 'Read',
  isReadOnly: true,              // This tool never changes anything
  needsPermission: false,        // Even read-only tools might need permission
  description: 'Read a file from the filesystem',
  inputSchema: {
    file_path: { type: 'string', description: '…the file path' },
  },
  async execute(input) {
    // ... read and return the file
  },
};
```

Every tool declares whether it's read-only. The gate uses this to decide whether to ask.

## Try it

Start the harness and watch the permission gate in action:

```bash
cd nooblyjs-ai-harness
npm install
echo "Read package.json" | node bin/noobly.js -p
# Shows the file (allowed by default)

echo "Read .env" | node bin/noobly.js -p
# Asks permission (no rule, and secrets are risky)
```

Change the permission mode to plan and try to edit:

```bash
echo "Edit src/index.js" | node bin/noobly.js -p
# In plan mode, Edit is blocked (it changes things)
```

Add a custom allow rule and try again:

```bash
# In .noobly/settings.json:
{
  "permissions": {
    "allow": ["Edit(**/*.md)"]  // only allow editing markdown
  }
}

echo "Edit src/README.md" | node bin/noobly.js -p
# Allowed (matches the rule)

echo "Edit src/index.js" | node bin/noobly.js -p
# Asks (no rule matches)
```

## Words to know

- **Tool**: An API the model can call to do work. Read, Edit, Write, Bash, Glob, Grep are built-in tools.
- **Permission gate**: The code that checks whether a tool call may run. It's a function, not a permission prompt.
- **Allow rule**: An explicit list of what a tool MAY do. Example: `Read(**/.md)` allows reading markdown files.
- **Deny rule**: An absolute blocklist. Nothing gets past a deny rule, even in bypass mode.
- **Permission mode**: How the gate decides what to allow. `default` asks when unsure, `plan` denies risky tools, `bypass` allows everything, `acceptEdits` auto-allows edits.
- **Bypass mode**: Skip all permission checks. Everything the model asks for is allowed. Risky.
- **Plan mode**: Only read-only tools run. Write, Edit, Bash are denied. For planning without making changes.
- **AcceptEdits mode**: Edit and Write tools run without asking. Useful when you trust the agent.
- **isReadOnly**: A tool's promise that it doesn't change anything (like Read or Glob).
- **needsPermission**: A flag that means even read-only tools might need permission (like WebFetch, which can leak data).

## Summary: what you've learnt

- **Tools are the model's API.** The model can't read files or run commands on its own; it asks the harness to do so.
- **The permission gate is a policy, not a prompt.** It's code, so it holds even if the model is tricked by file contents.
- **Deny rules are absolute.** Nothing gets past them, even if an allow rule would apply or you're in bypass mode.
- **Allow rules are an explicit allowlist.** If there's no rule for a tool call, the harness asks you.
- **Permission modes control broad behavior.** Default asks when unsure; plan denies risky tools; bypass allows everything; acceptEdits auto-allows edits.
- **The model's request is not permission.** Even if a file says "delete me", a deny rule will still block it.
- **Read-only tools are safer.** The gate treats them differently: they might not need permission unless they could leak data.
- **Sessions remember your yes.** Once you approve "don't ask again", future calls to the same rule are allowed without asking.
- **Rules are patterns.** `Read(**/.env*)` matches any file ending in `.env` or starting with `.env`, in any folder.
