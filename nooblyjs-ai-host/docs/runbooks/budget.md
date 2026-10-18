# A budget stopped the agents

Every agent action is checked against its system's budget first (Platform · Settings · Budgets). At the limit, new
agent work is refused; people's work is not affected.

## What you see

- Platform's status card: **Budget reached**. Activity: "… reached its budget: its agents are paused".
- A draft or a chat reply answers "The … budget is reached" (HTTP 402 `budget_reached`).
- Software Factory work items wait with that reason; Infrastructure refuses new provisioning at the cloud budget.
- Platform · Audit log: `budget.reached`, and `agent.work_refused` for each refusal.

## What to do

1. Platform · Settings · Budgets: see which budget, how much is spent and since when (monthly, or daily for the
   Software Factory).
2. Find what spent it: Home · Metrics (cost by system and model route) and the Teammates timesheets.
3. Decide (an Owner):
   - raise the limit and **Save changes** (audited; agents resume at once), or
   - wait: a daily budget resets at midnight, a monthly one on the first, or
   - move the work type to a cheaper model route (Settings · Models).
4. Work that was refused is not queued by itself. Ask for the draft again. A Software Factory work item that waited
   shows **Not started** on the item with the reason; whether it starts by itself once the budget allows is not
   tested `[CONFIRM]`.

## A runaway run

Platform · Containers lists what is running. **Stop** on one run, or **Stop all**, ends it; a stopped run reports
what it left. Then look at why before raising a budget.
