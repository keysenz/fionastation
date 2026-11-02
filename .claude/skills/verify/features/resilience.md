# Resilience

The site says what went wrong instead of showing a blank or misleading page, and a bad request cannot stop the server.

## Sub-features

- `fetch-failure` shows an error and a `Try again` button when an API route fails, and refuses data of the wrong shape.
- `storage` keeps pages working when saved data is corrupt or storage is blocked, and two tabs keep each other's queued songs.
- `navigation` plays the sound on `Back to Home`, browser back works, and an unknown path shows the 404 page.
- `paths` answers 404 to malformed paths without stopping the server, redirects trailing slashes without leaving the site, and serves ranges and 304s.
- `mobile` closes the playlist drawer when a video is chosen.

## How to get to it (user POV)

- Stop the API, block site data, or open a path that does not exist.

## Driving it with drive.mjs

Preconditions:

- Doctor reports non-zero counts.

- **All.** Run `node drive.mjs fetchFailure storage navigation paths mobile`. The journeys replace API responses with `page.route` and make `localStorage` throw with an init script.
- **Proof.** Open `results.json` in the evidence folder.

## Gotchas

- Only the journey's browser sees replaced responses. The server is untouched.
- `paths` uses `node:http`, because `fetch` normalizes paths before sending them.
