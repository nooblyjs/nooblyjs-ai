# chunk loops forever on size 0

`chunk([1,2,3], 0)` never returns. `chunk(array, size)` should throw a `RangeError` when size isn't a positive integer. Normal use must keep working: `chunk([1,2,3,4,5], 2)` → `[[1,2],[3,4],[5]]`.
