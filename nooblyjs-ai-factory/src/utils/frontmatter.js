// @ts-check
// Frontmatter: "key: value" settings at the top of a Markdown file.
//
//   ---
//   title: Add a greeting
//   labels: [factory, docs]
//   ---
//   The rest of the file…
//
// Reading and writing both live in nooblyjs-ai-common (src/frontmatter.js), the
// same tiny format the harness uses for its commands, skills and agents. Values
// that could break the format (a newline, a leading "[" or quote) are written as
// JSON strings, which the parser reads back as quoted text.
export { formatFrontmatter, parseFrontmatter } from 'nooblyjs-ai-common/frontmatter';
