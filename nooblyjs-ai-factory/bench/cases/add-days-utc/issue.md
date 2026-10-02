# addDays is wrong across DST and month ends

`addDays('2024-02-28', 2)` should be `'2024-03-01'`, and `addDays('2024-03-30', 1)` gives the wrong day in some time zones. Dates are plain `YYYY-MM-DD` strings: do the arithmetic in UTC. Negative days work too.
