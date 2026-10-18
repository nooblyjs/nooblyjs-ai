# nooblyjs-ai-knowledge: redact before you store

**Lesson 02 · about 10 minutes · 2026-10-10**

## What you'll learn

- Personal data is removed **before** a file is written to the wiki, not after.
- The redaction is a pure function: text in, cleaned text and counts out, with no file access.
- The wiki never writes the original text, so there is nothing to leak later.

## The idea, in plain words

Think of a school that photocopies a letter for a file, but first blacks out the parents' phone numbers. The
blacked-out copy is the only one that goes in the file. Whoever reads the file never sees the numbers.

The wiki does this when it imports an export. Each text file goes through `redact()`. Email addresses, phone numbers
and ID numbers become markers such as `[REDACTED EMAIL]`. Only the marked text is saved.

The analogy stops working in one place: a blacked-out photocopy can sometimes be read through the marker. This
redaction is a pattern match, so it misses odd formats. The lesson is to redact at the door, not to rely on it alone.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/wiki/knowledge/redact.js` | `redact()`: the patterns and the markers. Pure: no files, no network. |
| `src/wiki/knowledge/importer.js` | Calls `redact()` on each text file before writing it. |
| `src/wiki/knowledge/store.js` | Records how many values were redacted, not what they were. |
| `test/redact.test.mjs` | Checks what is removed, and what is left alone (dates, versions, amounts). |

## A small piece of code

The marker names and the function that applies them, from `src/wiki/knowledge/redact.js` lines 19 to 24 and 49 to 54:

```js
// src/wiki/knowledge/redact.js:19
const MARK = { id: '[REDACTED ID]', email: '[REDACTED EMAIL]', phone: '[REDACTED PHONE]' };

// src/wiki/knowledge/redact.js:49
function redact(text) {
  const counts = { id: 0, email: 0, phone: 0 };
  let out = String(text ?? '');
  out = out.replace(ID_NUMBER, () => { counts.id += 1; return MARK.id; });
  out = out.replace(EMAIL, () => { counts.email += 1; return MARK.email; });
```

- Line 19: the three markers. A reader sees what kind of value was there, but not the value.
- Line 49: the function counts each kind it replaces. The import shows those counts on the Sources screen.
- The order matters: ID numbers are replaced first, so a long digit string isn't half-eaten as a phone number.
- Names are not redacted. The code says so, because that needs a model and a list of who may be named.

## Try it

Run the redaction tests, which are quick and offline:

```
cd <workspace>/nooblyjs-ai-knowledge
node --test test/redact.test.mjs
```

Read the second test. It lists things that must not be changed, such as dates and version numbers.

## Words to know

- **Redaction**: removing or hiding personal data.
- **Pattern (regular expression)**: a description of text, such as "something with an @ in it", used to find values.
- **Pure function**: one that only uses its input and returns a result, with no side effects.
- **Import**: bringing an outside folder of pages into the wiki.
- **Marker**: the replacement text, such as `[REDACTED EMAIL]`.

## Summary: what you've learnt

- You know personal data is removed before a file is saved, so the original is never stored.
- You know `redact()` is a pure function that returns the cleaned text and counts.
- You know the order of the patterns matters, and that names are deliberately not redacted.
- You know the tests check both what is removed and what must be left alone.
