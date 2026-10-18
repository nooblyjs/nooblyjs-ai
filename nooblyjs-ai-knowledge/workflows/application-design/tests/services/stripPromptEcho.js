/**
 * @fileoverview Test the prompt-echo stripper.
 *
 * Self-contained and offline — the function under test is pure.
 *
 *   node application-design/tests/services/stripPromptEcho.js
 *
 * The generated pages were opening with the instruction they were given:
 * `# api\dev — Application Architect`, then `## Key Concepts — define and explain
 * the key concepts these files expose…`. The prompt now names the headings and
 * briefs them separately, which is the real fix; this is the safety net, and what
 * it must NOT do matters as much as what it must.
 *
 * @author Digital Technologies Team
 * @since 2026-08-26
 */

'use strict';

const CodeProcessorClass = require('../../services/codeProcessor.js');
const strip = CodeProcessorClass.stripPromptEcho;

let passed = 0;
let failed = 0;

function equal(label, actual, expected) {
   if (actual === expected) { passed += 1; console.log(`  ok    ${label}`); return; }
   failed += 1;
   console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}`
      + `\n        actual   ${JSON.stringify(actual)}`);
}

console.log('\nH1 — the persona is not part of the document');
equal('drops an em-dash role',
   strip('# api\\dev — Application Architect'), '# api\\dev');
equal('drops an en-dash role',
   strip('# services – Functional Designer'), '# services');
equal('drops a hyphen role',
   strip('# api/dev - Application Architect'), '# api/dev');
equal('leaves a bare folder name alone',
   strip('# api\\dev'), '# api\\dev');
equal('keeps a hyphenated folder name intact',
   strip('# sim-ready-user'), '# sim-ready-user');

console.log('\nH2 — the brief is not the heading');
equal('cuts the Key Concepts brief',
   strip('## Key Concepts — define and explain the key concepts these files expose and '
      + 'summarise how they work. Several substantial paragraphs.'),
   '## Key Concepts');
equal('cuts the Detailed Design brief',
   strip('## Detailed Design — for EACH code file write a bold filename lead-in followed by '
      + 'an analyst-level explanation. Cover every file: api.go, types.go.'),
   '## Detailed Design');
equal('cuts the Application Flow brief',
   strip('## Application Flow — a Mermaid diagram (per the rules above) showing the flow.'),
   '## Application Flow');
equal('cuts the APIs brief',
   strip('## APIs — this directory exposes no HTTP API directly.'),
   '## APIs');
equal('is case-insensitive about the section name',
   strip('## KEY CONCEPTS — define and explain…'), '## Key Concepts');

console.log('\nWhat it must NOT touch');
equal('an already-correct heading comes back byte-for-byte',
   strip('## Key Concepts'), '## Key Concepts');
equal("a heading the model invented is left alone",
   strip('## Error Handling — retries and timeouts'),
   '## Error Handling — retries and timeouts');
equal('a section name appearing mid-heading is not a match',
   strip('## Notes on Key Concepts — background'),
   '## Notes on Key Concepts — background');
equal('H3 and below are untouched',
   strip('### Key Concepts — something'), '### Key Concepts — something');

console.log('\nWhole documents');
{
   const doc = [
      '# api\\dev — Application Architect',
      '',
      '## Key Concepts — define and explain the key concepts these files expose.',
      '',
      'The api/dev package defines a lightweight, testable surface — it also uses an em dash.',
      '',
      '## Detailed Design — for EACH code file write a bold filename lead-in.',
      '',
      '**`api.go`** — Defines the API interface used by the api/dev layer.',
      '',
      '## Application Flow',
      '',
      '```mermaid',
      'graph TD',
      'A[Client] --> B[API]',
      '```',
   ].join('\n');

   const out = strip(doc);
   equal('the whole document is normalised', out, [
      '# api\\dev',
      '',
      '## Key Concepts',
      '',
      'The api/dev package defines a lightweight, testable surface — it also uses an em dash.',
      '',
      '## Detailed Design',
      '',
      '**`api.go`** — Defines the API interface used by the api/dev layer.',
      '',
      '## Application Flow',
      '',
      '```mermaid',
      'graph TD',
      'A[Client] --> B[API]',
      '```',
   ].join('\n'));

   // The two lines above are the ones a careless regex would have eaten: body
   // prose containing an em dash, and a bold filename lead-in that uses exactly
   // the `**name** — explanation` shape the brief asks for.
   equal('body prose with an em dash survives',
      strip('The package defines a surface — testable and small.'),
      'The package defines a surface — testable and small.');
   equal('a Detailed Design entry survives',
      strip('**`api.go`** — Defines the API interface.'),
      '**`api.go`** — Defines the API interface.');
   equal('a mermaid arrow is not a heading',
      strip('A[Client] --> B[API]'), 'A[Client] --> B[API]');
}

console.log('\nEdge cases');
equal('empty input', strip(''), '');
equal('null input', strip(null), null);
equal('a lone hash is not an H1', strip('#'), '#');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
