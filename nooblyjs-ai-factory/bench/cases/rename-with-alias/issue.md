# Rename getUsr to getUser

Rename `getUsr` to `getUser` everywhere (`src/users.js` and its callers). Keep `getUsr` exported as a deprecated alias of `getUser` so other code keeps working. `node src/main.js` must print the same thing as before.
