# Add retry for flaky async calls

Add `retry(fn, times)` to `src/retry.js`: call the async function `fn`; if it rejects, call it again, up to `times` calls in all. Resolve with the first success; if every call fails, reject with the LAST error.
