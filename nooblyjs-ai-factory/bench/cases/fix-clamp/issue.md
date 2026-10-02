# clamp ignores the maximum

`clamp(15, 0, 10)` returns 15; it should return 10. `clamp(x, min, max)` must keep x between min and max.
