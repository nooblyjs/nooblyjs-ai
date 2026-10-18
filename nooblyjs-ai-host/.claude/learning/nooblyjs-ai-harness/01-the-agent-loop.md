# nooblyjs-ai-harness: the agent loop

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- What a single "turn" is, and why one user message can cause several model requests (called "rounds").
- How the model asks for a tool, the harness runs it, and the result goes back to the model.
- How the loop knows when to stop, and why it has a round limit.

## The idea, in plain words

An AI agent is a model that can ask for things to be done and then sees the results. The model cannot read
your files or run commands on its own. It can only write a request, such as "run the Read tool on
`package.json`". The harness is the program that reads that request, does the work, and sends back the
answer. The **agent loop** is the cycle that repeats this until the model has finished.

Think of a restaurant kitchen. The chef (the model) writes order slips: "fetch the flour", "check the oven".
The runner (the harness) goes and fetches, puts every answer on one tray, and brings it back. The chef reads
the tray and either writes more slips or serves the dish. That is one round after another until the dish is
done.

The analogy stops working in one important place. The chef remembers the order. The model does not. Each
round, the harness sends the whole conversation again: everything said so far, plus the new tool results. The
model "remembers" only because the harness keeps resending it.

In the repo, one call to a session's `stream()` method is one **turn**. A turn is what happens from your
message until the model gives a final answer. Inside a turn there can be many **rounds**, each one a request to
the model.

## Where it lives in this repo

- `src/core/loop.js` · the whole loop. The `runTurn()` function (line 42) runs one turn. The file's own header
  comment (lines 1–16) gives the three steps, and it is the best short summary to read first.
- `src/core/session.js:290` · `stream()` is the public door. It calls `runTurn()` and passes the result back.
  Everything that drives the harness (the terminal UI, a headless run, or NooblyJS's worker) goes through this.
- `src/config/defaults.js:14` · `maxTurns: 25`, the default round limit.
- `test/loop.test.js` · 11 tests that describe the loop's behaviour in plain sentences. Reading the test names
  is a good way to learn what the loop promises.

## A small piece of code

This is the loop itself, the part that runs once per round (`src/core/loop.js:98–104`):

```js
while (true) {
  if (totals.rounds >= session.maxTurns) {
    stopReason = 'max_turns';
    yield { type: EVENT.NOTICE, text: `Stopped after ${session.maxTurns} rounds (maxTurns). Send another message to continue.` };
    break;
  }
  totals.rounds += 1;
```

- `while (true)` · the loop has no fixed count. It keeps going until a `break` or an error.
- `totals.rounds >= session.maxTurns` · the safety brake. Without it, a model that keeps asking for tools could
  run forever and spend money.
- `yield { type: EVENT.NOTICE, ... }` · `yield` sends an event out to whoever is listening, and the loop pauses
  until they ask for more. This is why the UI can show progress as it happens.
- `break` · leaves the loop. The turn then ends and the history is saved (line 219).

Two more lines to find later, with the same idea. Line 205 (`pending.push({ role: 'user', content: results })`)
sends every tool result back together in one message. Lines 152–153 are the normal way out: when the model's
`stop_reason` is not `tool_use`, the model has finished, and the loop breaks.

## Try it

From the `nooblyjs-ai-harness` folder, run the loop tests. They use a scripted fake model, so no API key and no
money are needed:

```bash
node --import tsx --import ./test/no-color.js --test test/loop.test.js
```

You should see `tests 11`, `pass 11`, `fail 0`. Then open `test/loop.test.js` at line 116 and read the test
called "stops after maxTurns rounds". It is the round limit from this lesson, written as a test.

## Words to know

- **Turn:** everything from one user message to the model's final answer. One call to `stream()`.
- **Round:** one request to the model inside a turn.
- **`tool_use`:** the model's request to run a tool. It names the tool and its input.
- **`tool_result`:** the harness's answer to a `tool_use`. Every `tool_use` must get one, or the API rejects the next request.
- **`stop_reason`:** why the model stopped replying. `tool_use` means it wants tools run. `end_turn` means it is finished.
- **History:** the saved conversation (`session.history`). Only the finished, valid messages are kept here.
- **Pending:** the messages of the current turn, not yet saved. They are moved into history at the end (`commit`, line 452).
- **Async generator:** a function that can pause with `yield` and resume later. `runTurn()` is one, which is why the UI can stream it.

## Summary: what you've learnt

- You know that the model only asks for tools, and the harness is the part that runs them and sends back the results.
- You can explain why one message can take several rounds, and why the whole conversation is resent each round.
- You know where the loop stops: when the model finishes, when the round limit is hit, or when you interrupt it.
- You know that every `tool_use` gets a `tool_result`, so the history always stays valid, even after an interrupt.
- You can run the 11 loop tests and read what they promise.
