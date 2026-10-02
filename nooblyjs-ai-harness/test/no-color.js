// Loaded before every test file (see "test" in package.json). The rendering tests
// compare plain text, so colour codes must stay off even when the shell forces them
// (FORCE_COLOR is set by some terminals and CI systems). This runs before chalk reads it.
process.env.FORCE_COLOR = '0';
