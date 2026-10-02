# Add slugify

Add `slugify(text)` in `src/slug.js`: lowercase; every run of characters that aren't letters or digits becomes one `-`; no `-` at the start or end.

Examples: `"Hello, World!"` → `"hello-world"`, `"  Many   spaces "` → `"many-spaces"`, `"Version 2.0"` → `"version-2-0"`.
