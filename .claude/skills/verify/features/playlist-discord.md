# Connect Discord on the page

A fan optionally connects Discord from the My playlists dialog. Connecting claims the playlists this browser holds edit tokens for, so the account lists and edits them from any browser.

## Journeys

Each Discord journey starts its own server wired to `fake-discord.mjs` on the three ports after `VERIFY_PORT` (the server, the fake, the admin listener), then stops both. The default server has no login configured.

- `playlistDiscord` saves two playlists, connects and expects the account name, both playlists in the list, and both in `GET /api/playlists/mine` (so they were claimed). A second browser with no tokens connects as the same user, lists them, opens one with owner actions and renames it. It deletes from the page and opens the link from a third session, disconnects (`/api/auth/me` answers 401 while the token still edits), sees a stranger playlist as a different user (no Rename, Save a copy offered), and connects after a playlist was made through the admin owner route.
- `playlistDiscordEdge` connects with `localStorage` blocked, connects as a user whose display name is `<img src=x onerror=...>` and expects plain text with no element and no script run, and checks the header and the connected dialog at 375px.
- `playlistDiscordFailure` makes the fake refuse the code exchange, replays a callback with a forged state, and exhausts the per-IP login limit. Each lands on `/` with `data-toast="LoginFailed"` and the matching `data-toast-reason`, an address bar without `login`, and no session.
- `playlistDiscordUnavailable` runs on the default server (no login configured, so `/api/auth/me` answers 503) and with `/api/auth/**` aborted. Connect is not offered, local playlists still list, and the radio works.
- `playlistDiscordTiming` alternates signed-out and connected runs from navigation to Playing. Set `TIMING_RUNS` to change the 10 runs.

## Gotchas

- Assertions use `data-account`, `data-account-name`, `data-my-playlist`, `data-playlist-bar` and `data-toast*` attributes, never wording.
- `GET /fake/as?id=&name=` changes the next login's user. `GET /fake/refuse?on=1` makes the code exchange fail until `on=0`.
- The server's `SITE_ORIGIN` is the `127.0.0.1` origin the journeys browse, because cookie writes must carry a matching `Origin`.
- A 404 from an old server on `/api/auth/*` is covered by unit tests. A journey can only abort the request.
