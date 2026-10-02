# Parse durations like 1h30m

Add `parseDuration(text)` to `src/duration.js`, returning seconds. It accepts `h`, `m` and `s` parts in that order, each optional but at least one: `"1h30m"` → 5400, `"45s"` → 45, `"2h"` → 7200, `"1h2m3s"` → 3723. Anything else (`""`, `"abc"`, `"5x"`, `"30m1h"`) throws a `TypeError`.
