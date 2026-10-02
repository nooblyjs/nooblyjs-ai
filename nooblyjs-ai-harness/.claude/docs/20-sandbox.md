# Phase 20: The OS sandbox

**Goal:** limit what a command **can** do, instead of guessing what it **will** do. Then the model can run most commands without asking you.

---

## Why rules weren't enough

Since Phase 06, every Bash command passes the **permission gate**: rules like `Bash(git diff:*)` decide from the command's *text*. The v1 security review found three ways past it in one afternoon:

| Looked harmless | Actually |
|---|---|
| `ls` (allowed by default) | ran the repo's own `ls`, because a project setting had changed `PATH` |
| `git diff --output=~/.bashrc` | an allowed prefix that **writes a file** |
| `Grep` on `.env` | a read-only tool reading a secret a Read rule protected |

Each got a fix, and each fix was another pattern. Shell is too big for patterns ever to be complete. So we add a second layer that doesn't care what the text says:

| | Permission gate (Phase 06) | Sandbox (this phase) |
|---|---|---|
| Looks at | the command's text | what the process actually does |
| Decides | *whether* it runs | *what it can touch* once it runs |
| Weakness | misses what its patterns don't know | coarse: "the project", not "this one file" |
| Enforced by | our code | the operating system's kernel |

Defence in depth: each layer covers the other's weakness.

## The policy (`src/sandbox/policy.js`)

One description, used by every backend:

| | Default |
|---|---|
| **Read** | everything, except **hidden** folders: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, `~/.npmrc`, `~/.noobly`… |
| **Write** | the **project**, a **private `/tmp`**, and package caches (`~/.npm`, `~/.cache`, `~/.yarn`…) |
| **Never write**, even inside the project | `.git/hooks`, `.git/config`, `.noobly` |
| **Network** | none |

That "never write" list needs a moment's thought. The project is writable, so why protect parts of it? Because writing there **runs code later, outside the sandbox**:

- a file in `.git/hooks/pre-commit` runs on your next `git commit`, as you
- `.git/config` can name programs git runs (`core.pager`, `core.fsmonitor`)
- `.noobly/settings.json` holds hooks (though Phase 12's trust fingerprint would catch a change)

A sandbox is only as strong as its **weakest way out**, including ways out that open later.

## Linux: bubblewrap (`src/sandbox/bwrap.js`)

[bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) uses Linux **namespaces**: the kernel gives one process its own view of the filesystem, network and process list. No root needed. The same building blocks as Docker, minus the images.

```
bwrap --ro-bind / /                      everything, read-only
      --dev /dev --proc /proc            fresh /dev and /proc
      --tmpfs /run                       hide /run (see below!)
      --bind <private dir> /tmp          a private /tmp
      --bind /work/app /work/app         the project: writable
      --bind ~/.npm ~/.npm               caches: writable
      --ro-bind /work/app/.git/hooks …   read-only again, ON TOP of the writable project
      --tmpfs ~/.ssh                     hidden: an empty folder
      --unshare-net                      its own network: nothing but a loopback
      --unshare-pid                      its own process ids
      --die-with-parent
      bash -c "<the command>"
```

Order matters: each mount covers what's under it. That's how `.git/hooks` is read-only inside a writable project.

`--unshare-pid` does one more job: the sandbox's first process is its "init", and when it ends, the kernel ends **everything** inside. A timeout or Ctrl+C can't leave a background process behind (there's a test for this).

### The surprise: a read-only file is still a door

The first version mounted `/` read-only with no network and looked airtight. Then this, from inside it:

```bash
curl --unix-socket /var/run/docker.sock http://x/version
{"Version":"29.8.0", …}
```

A **unix socket** is a file you *connect* to, and connecting isn't writing, so a read-only mount doesn't stop it. And `--unshare-net` only removes the *network*; unix sockets are part of the *filesystem*. Docker's socket is **root access**: `docker run -v /:/host …` and the sandbox is over.

So `/run` (where daemons put their sockets) is replaced by an empty `tmpfs`, and `/tmp` (tmux, ssh-agent and X11 sockets live there) by a private folder. A test now creates a socket in the host's `/tmp` and checks the sandbox can't reach it.

> Lesson: list **every kind of object** a process can reach (files, sockets, processes, the network, devices), not just files.

## macOS: seatbelt (`src/sandbox/seatbelt.js`)

macOS has no mount namespaces. Instead, `sandbox-exec -p <profile>` makes the kernel check every operation against a **profile** written in SBPL, a small Lisp:

```lisp
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "/work/app") (subpath "/private/tmp") …)
(deny file-write* (subpath "/work/app/.git/hooks"))   ; later rules win
(deny file-read* (subpath "/Users/me/.ssh"))
(deny network*)                                       ; unix sockets too
(allow network-outbound (remote ip "localhost:52814")) ; the proxy
```

Same policy, a different translation. ⚠️ This backend was written and unit-tested on Linux; the profile text is checked, but it has **not yet been run on a Mac**. Try `/sandbox` and the "Try it" commands below on one, and fix what breaks.

## Some network, not all (`src/sandbox/proxy.js`)

"No network" breaks `npm install`. "All network" lets a prompt-injected command send your code anywhere. The middle: a list of domains.

```json
{ "sandbox": { "network": ["registry.npmjs.org", "github.com"] } }
```

The sandbox still has no network of its own. Instead:

```
command ──HTTPS_PROXY──► bridge (inside, 127.0.0.1:3128)
        ──unix socket──► proxy (in noobly, outside) ──► registry.npmjs.org ✓
                                                    ──► evil.example      ✗ 403
```

- The **proxy** runs in noobly. For HTTPS, clients send `CONNECT registry.npmjs.org:443` and then encrypted bytes: we only need the host name to decide, and never see the content.
- The **bridge** (`bridge.js`, 20 lines) runs *inside* the sandbox and passes connections to the proxy's unix socket. This time the socket is deliberately made reachable: it's in the sandbox's private `/tmp`. (Since Phase 22 the bridge runs once per session, inside the executor.)
- Programs find the proxy through `HTTP(S)_PROXY`. Node's own `fetch()` only does that when `NODE_USE_ENV_PROXY=1` (Node 24+), so we set that too.
- A program that ignores the proxy variables gets **no** network. That's failing closed: the safe direction.

> **Changed in Phase 22:** on Linux, noobly no longer starts a new bubblewrap sandbox for every command. Each session has **one** long-lived sandbox with a small executor inside, and commands are sent to it (see [22-background-tasks.md](./22-background-tasks.md)). Same policy, same walls; but commands now share one private network, so a server one command starts can be reached by the next.

## The gate relaxes (`src/permissions/gate.js`)

Because the sandbox holds, a sandboxed Bash command no longer asks in default mode (`sandbox.autoAllow`, on by default). What still applies, in order:

1. **deny rules** win, sandbox or not (`rm -rf` is still refused)
2. **plan mode** still means read-only
3. a command asking to **leave the sandbox** (`dangerouslyDisableSandbox: true`) **always asks**, even if an allow rule matches. The dialog says so in red.

Print mode changes too: `noobly -p "run the tests"` used to fail with "Bash needs permission"; now the tests run, sandboxed.

## Telling the model

The model needs to know the walls exist, or it will fight them:

- A **system prompt section** (`# Sandbox`) describes the limits.
- When a sandboxed command fails with signs of the sandbox ("Read-only file system", "Could not resolve host", a proxy refusal), the result gets a note: *"[sandbox] … the failure looks caused by it … tell the user, or run it again with dangerouslyDisableSandbox: true (the user will be asked)."* Without it, models tend to try `sudo`, other folders, other tools…
- The tool line shows `sandboxed ·` or `⚠ unsandboxed ·`.

## Settings, and trust

```json
{
  "sandbox": {
    "enabled": true,
    "backend": "auto",
    "writable": ["~/data", "../shared"],
    "network": "none",
    "autoAllow": true
  }
}
```

A **project's** `sandbox` setting waits for your trust (like `env` in the security fixes): it could switch the sandbox off.

## What is NOT sandboxed

- **Hooks and MCP servers.** They're configuration you trusted, not the model's choices. Sandboxing them is on the "Beyond v2" list.
- **Edit and Write.** They have their own project-boundary checks (Phase 05) and the permission gate.
- **Reads** of most of your home folder. Hiding everything would break too many tools; the most sensitive folders are hidden instead.
- With `network: "allow"`: abstract unix sockets (not files) are reachable, like on the host.
- **Windows**, and Linux without bubblewrap (a banner notice says so; Bash then asks before every command, as before).

## Try it

```bash
sudo apt install bubblewrap            # Linux; macOS has sandbox-exec already
noobly --echo
❯ /sandbox                             # backend, writable folders, hidden folders, network
❯ run touch ~/x                        # Read-only file system, plus the [sandbox] note
❯ run curl -sI https://example.com     # Could not resolve host
❯ run echo hi > note.txt               # works, no question asked
```

## Deviations from the plan

- **No Docker backend.** Docker needs your toolchain (node, python…) *inside* an image, it doesn't pass through our fd 3 (the `pwd` channel from Phase 05), and it takes a second or more to start each command. bubblewrap gives the same isolation over *your* system in ~10 ms. Containers are a better fit for the "cloud execution" exploration.
- The macOS backend is untested on real hardware (see above).

## What we learned

- **Contain, don't predict.** A dumb wall beats a clever guess, and makes the clever guess (the gate) less important.
- A read-only filesystem is not a sandbox: **sockets**, and anything that runs **later** (git hooks), are ways out.
- The best sandbox is useless if the model doesn't understand it: **explain failures** in the tool result.
- Safety enables autonomy: the sandbox is what lets the gate stop asking.
- How Claude Code appears to do it: the same split (bubblewrap on Linux, seatbelt on macOS), a filtering proxy for network domains, and an opt-out flag per command that asks the user.
