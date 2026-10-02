# Add a simple email check

Add `isEmail(text)` to `src/validate.js`. Rules (deliberately simple): exactly one `@`; a non-empty part before it with no spaces; after it, a domain with at least one `.`, no spaces, and no empty labels (`a@b..c` and `a@.b` are invalid).
