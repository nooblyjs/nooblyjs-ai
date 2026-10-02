# withDefaults modifies its input

`withDefaults(options)` fills in missing settings, but it also changes the object passed in, so callers see settings they never set. It must return a new object and leave `options` alone.
