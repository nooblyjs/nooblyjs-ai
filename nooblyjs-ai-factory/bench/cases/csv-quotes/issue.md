# parseCsvLine breaks on quoted commas

`parseCsvLine('a,"b,c",d')` returns 4 fields; it should return `['a', 'b,c', 'd']`. Inside quotes, `""` is a literal quote: `'"say ""hi"""'` → `['say "hi"']`.
