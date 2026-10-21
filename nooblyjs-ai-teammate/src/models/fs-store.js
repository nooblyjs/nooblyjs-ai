// File-system store: every entity is a Markdown file with YAML front matter. Writes are atomic (tmp + rename) and
// serialized per path with an async mutex.
//
// The store itself is nooblyjs-core's (src/store/fs-store.js, which began as this file): one class for NooblyJS and its
// hosted apps, so hosted, the store the host hands over (host.store) is the same class, with the same errors. Teammates
// only re-exports it, for its own modules and for standalone.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const { FsStore, StoreError, parseMarkdown, serializeMarkdown } = require('nooblyjs-core/src/store/fs-store.js');
