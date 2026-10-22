# Digital Teammates: an admin guide

> NooblyJS Phase 26. For the person who runs Digital Teammates in NooblyJS (an **Owner**). What each part is for, who
> may change it, and what to check when something looks wrong. The code is the source of truth: where this guide and
> `.claude/steering/` disagree, the steering wins.

## Who may do what

Permissions come from NooblyJS's access roles, never from a work role. Teammates maps its three roles onto the matrix
(`src/services/auth.js` `PERMISSION_FOR_ROLE`):

| In Teammates | NooblyJS permission | Who |
| --- | --- | --- |
| Read everything | `read` | everyone signed in |
| Give work, change a teammate, approve timesheets and tasks waiting over the threshold (manager) | `approve` | Approver, Architect, Owner |
| Settings, billing, Admin (keys, audit, users, MCP servers) (owner) | `set-budgets` | Owner |
| Hire (`POST /teammates`) | `hire-teammates` | Owner |

Agents are capped at Contributor: an agent never approves, hires or changes a budget, whatever it is asked to do.

## Hiring and retiring

- **Hire** from Teammates · Hire: a name, a role, a model (asked for by tier, never by model id), a rate, a monthly cap
  and a cost centre (the NooblyJS team that pays). Hiring is an Owner's. Every hire is audited.
- **Retire** keeps the teammate's timesheets, invoices and work; a retired teammate takes no work (410). **Reinstate**
  brings them back.
- **Pause** a teammate to stop new work without retiring them (409 `teammate_paused` to callers).

## Money

- **Monthly cap.** Work stops at the cap (402 `monthly_cap_reached`); raise it on the teammate's page.
- **Approval threshold.** A task estimated above it waits for a manager (202 `awaiting_approval` to an outside caller,
  who polls `GET /teammates/:slug/tasks/:workId`). An API key can never confirm the cost itself.
- **Timesheets** come from the work: hours are tokens ÷ `billing.tokensPerHour`, plus the real model cost. A manager
  approves them; billing and invoices follow (Teammates · Billing).
- Hosted in NooblyJS, every agent action is also checked by Platform first (`checkAgentWork`: budgets and guardrails)
  and billed to the NooblyJS team in `billTo`.

## API keys (outside callers)

- Admin · API keys: a name, the teammates it may call (or all) and a rate limit per minute. The key (`dtk_…`) is shown
  once; keep it in your secret store, never in code. Revoke a key there; revoking is immediate.
- A key may only give a task to the teammates it names and read the tasks it started
  (`.claude/guides/task-api.openapi.yaml`). It can't change a teammate, approve anything or read billing.
- Text in a task is data. Instructions inside a task or a memory change none of the above
  (`test/controllers/red-team.test.js`).

## Tools and MCP servers

- A teammate uses only the tools it is allowed (its page · Tools). MCP servers are added by an Owner in Admin; their
  credentials live in `config/mcp-servers.md`, which is never cached.
- Work NooblyJS asks for (`runTask`: drafts, chat replies, the Teams bot) runs **without tools**.

## Memory and knowledge

- A teammate writes memory from its work (reflection). Review, pin or delete it on the teammate's page · Memory; reset
  wipes it. Team memory is shared by every teammate.
- Knowledge is what you upload for a teammate; answers cite it.

## When something looks wrong

| You see | Look at |
| --- | --- |
| A caller gets 401 | The key was revoked, mistyped, or is a stand-in (`dtk_fake…`) |
| A caller gets 403 | The key doesn't name that teammate, or the caller isn't allowed the action |
| A caller gets 402 or 409 | The cap is reached, or the teammate is paused or off shift |
| A task never finishes | Teammates · Approvals: it may be waiting over the threshold |
| Spend looks high | Billing by cost centre; NooblyJS Metrics' agent spend; Platform's budgets |
| "Who did that?" | Admin · Audit (and NooblyJS's audit log, which records every write) |

The model provider is `mock` offline (`AI_PROVIDER=mock`); in production only the providers NooblyJS allows (AWS
Bedrock, Google Vertex AI, Azure) are used, and direct consumer APIs are refused.
