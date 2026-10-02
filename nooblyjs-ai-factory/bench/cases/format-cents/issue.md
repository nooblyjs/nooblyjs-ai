# Add formatCents

Add `formatCents(cents)` to `src/money.js`: `1234` → `"$12.34"`, `5` → `"$0.05"`, `-5` → `"-$0.05"`, `123456789` → `"$1,234,567.89"` (commas every three digits). Non-integers throw a `TypeError`.
