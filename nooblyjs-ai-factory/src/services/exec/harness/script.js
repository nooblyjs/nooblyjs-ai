// @ts-check
// Phase F01/F05: a SCRIPTED model from a JSON file, for offline demos and tests.
// Phase F07: …with replies per STATION, since a run now has several agents.
//
//   [ { "text": "Reading.", "tools": [{ "name": "Read", "input": { "file_path": "a.js" } }] },
//     { "text": "Done.", "delayMs": 3000 } ]                       ← a list: the builder's replies
//
//   { "triage": [ { "text": "```json\n{ \"kind\": \"feature\", … }\n```" } ],
//     "build":  [ … ] }                                           ← per station
//
// Each entry is one model reply for the harness's createMockProvider.
// "delayMs" (Phase F05) spreads the reply's text over that many milliseconds,
// so a demo run is slow enough to interrupt (Ctrl+C, kill -9) in the middle.
import fs from 'node:fs';
import { createMockProvider } from '../../harness.js';

const CHUNK = 3; // characters per text_delta (the mock provider's default)

/** A provider from a list of replies. */
export function scriptedProvider(replies) {
  // Phase F23: the replies travel with the provider, so a remote worker can rebuild it (objects can't cross the wire).
  return Object.assign(createMockProvider(
    replies.map(({ delayMs, ...reply }) => {
      if (!delayMs) return reply;
      const chunks = Math.max(1, Math.ceil((reply.text ?? '').length / CHUNK));
      return { ...reply, onChunk: () => new Promise((resolve) => setTimeout(resolve, delayMs / chunks)) };
    }),
  ), { replies });
}

/**
 * A provider from a script file: the whole list, or one station's part (default: 'build').
 * Phase F12: "spec#2" (if present) is used for the station's SECOND run, e.g. after a person
 * rejected the first spec. Each `factory` command is a new process that reloads the script,
 * so a station that runs again needs its own replies for that attempt.
 */
export function loadScriptedProvider(file, station = 'build', attempt = 1) {
  const script = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(script) && Array.isArray(script?.[`${station}#${attempt}`])) return scriptedProvider(script[`${station}#${attempt}`]);
  if (Array.isArray(script)) {
    if (station !== 'build') throw new Error(`${file} only has replies for the builder (a JSON list), but the "${station}" station needs some too. Use { "${station}": [...], "build": [...] }, or --line quick (no triage).`);
    return scriptedProvider(script);
  }
  if (!Array.isArray(script?.[station])) throw new Error(`${file} has no replies for the "${station}" station (it has: ${Object.keys(script ?? {}).join(', ')}).`);
  return scriptedProvider(script[station]);
}
