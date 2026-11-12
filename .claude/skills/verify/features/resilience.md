# Resilience

The site says what went wrong instead of showing a blank or misleading page, and a bad request cannot stop the server.

## Sub-features

- `fetch-failure` shows an error and a `Try again` button when an API route fails, and refuses data of the wrong shape.
- `storage` keeps pages working when saved data is corrupt or storage is blocked, and two tabs keep each other's queued songs.
- `navigation` shows the 404 page for an unknown path, its `Back to Fio Radio` link returns to `/`, and browser back returns to the 404 page.
- `paths` answers 404 to malformed paths without stopping the server, redirects trailing slashes without leaving the site, redirects the old page paths to `/`, and serves ranges and 304s.
- `mobile` keeps the list, the search and the queue drawer inside a 375px phone.

## How to get to it (user POV)

- Stop the API, block site data, or open a path that does not exist.

## Driving it with drive.mjs

Preconditions:

- Doctor reports non-zero counts.

- **All.** Run `node drive.mjs fetchFailure storage navigation paths mobile`. `fetchFailure` aborts `/api/get-karaoke` with `agent-browser network route --abort`, then removes the route before Try again. The other journeys make `localStorage` throw with a per-tab init script.
- **Proof.** Open `results.json` in the evidence folder.

## Gotchas

- Only the journey's browser sees replaced responses. The server is untouched.
- `paths` uses `node:http`, because `fetch` normalizes paths before sending them.
