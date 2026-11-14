---
name: verify
description: Launch and drive the Fiona Station website (the Fio Radio page with its info panel, the /songs song list, and its read-only JSON API) in a real browser, locally or on the devbox, and capture proof. Use to confirm any UI, API, data-layer, or dependency change works in the real app.
---

# Verify Fiona Station

The user surface is a web site. `drive.mjs` drives it with the `agent-browser` CLI, using the real pages and real song data. There are no mocks. The local app reads a snapshot of the discord bot's database. The deployed app reads the live database.

`ab.mjs` is the driver's only link to the browser. It gives each journey its own `agent-browser` session (named `fio-<pid>-<journey>`), so journeys never share cookies, tabs or storage, and closes that session when the journey ends. It resolves locators in the page and sends every click, key press, fill and screenshot through `agent-browser`.

Run every command from the repository root. First-time setup, once per machine: install `agent-browser` (`npm i -g agent-browser && agent-browser install`), then load Node for the repository:

```sh
source ~/.nvm/nvm.sh && nvm use
```

The driver has no npm dependencies of its own, so there is nothing to install in this directory.

## Launch

```sh
.claude/skills/verify/launch.sh
```

This takes a database snapshot through `ssh devbox` if none exists, runs the production build, starts `server/main.ts` on port 3456, and returns after `/api/get-karaoke` serves songs. Set `VERIFY_PORT` to use another port. It refuses to start on a port that is in use.

To verify the deployed site instead, open a tunnel and pass `BASE_URL` to the commands below:

```sh
ssh -fN -M -S /tmp/fio-tunnel -L 13100:127.0.0.1:3100 devbox
export BASE_URL=http://localhost:13100
```

## Discord login

Login never talks to the real Discord in a proof. `fake-discord.mjs` stands in for it. It approves every login at once as its current user, and `GET /fake/as?id=<17 to 20 digits>&name=<name>` changes that user for the next login. `GET /fake/refuse?on=1` makes the code exchange fail, until `on=0`. The `playlistDiscord*` journeys start their own fake and server, so they need none of the setup below.

Start the fake, then launch the server with the same throwaway client values. `SITE_ORIGIN` is the origin the browser or `curl` uses, so set it to the proxy harness when you drive through the harness.

```sh
export DISCORD_CLIENT_ID=fake-client DISCORD_CLIENT_SECRET=fake-secret
FAKE_DISCORD_PORT=4457 node .claude/skills/verify/fake-discord.mjs &
DISCORD_API_BASE=http://127.0.0.1:4457 SITE_ORIGIN=http://127.0.0.1:3456 \
  VERIFY_PORT=3456 .claude/skills/verify/launch.sh
curl -sL -c jar -b jar http://127.0.0.1:3456/api/auth/discord/start -o /dev/null
curl -s -b jar http://127.0.0.1:3456/api/auth/me
```

A write that uses the session cookie needs `-H "Origin: $SITE_ORIGIN"`. The session cookie carries `Secure` only when `SITE_ORIGIN` is https, so a local `curl` jar sends it back over http.

To drive the Vercel proxy, start `proxy-harness.mjs` with `HARNESS_PORT`, `API_ORIGIN` set to the server and the same `PROXY_SECRET` as the server, and set `SITE_ORIGIN` to the harness origin. The owner routes for the bot live on the admin listener. Set `ADMIN_SECRET` and `ADMIN_PORT`, then call `/admin/owner/playlists` with `Authorization: Bearer $ADMIN_SECRET` and `X-Acting-Discord-Id`.

## Doctor

Run this first whenever something looks wrong. It only reads.

```sh
.claude/skills/verify/doctor.sh
```

Require `server: ours`, the expected Foldkit version, and a non-zero count of songs. With `BASE_URL` set, it skips the ownership line.

## Drive

```sh
(cd .claude/skills/verify && node drive.mjs)                 # every journey
(cd .claude/skills/verify && node drive.mjs karaoke info)   # chosen journeys
```

The journeys are `playlistOpen`, `playlistChoice`, `playlistNavigation`, `playlistSlowFetch`, `playlistFocus`, `playlistGone`, `playlistUnavailable`, `playlistFallback`, `playlistMobile`, `playlistTiming`, `playlistSave`, `playlistShare`, `playlistEdit`, `playlistCopy`, `playlistNoStorage`, `playlistLimit`, `playlistSaveMobile`, `playlistSaveTiming`, `playlistDiscord`, `playlistDiscordEdge`, `playlistDiscordFailure`, `playlistDiscordUnavailable`, `playlistDiscordTiming`, `site`, `radio`, `karaoke`, `songs`, `player`, `segmentSkip`, `playStats`, `coverEnd`, `strictAutoplay`, `queueReorder`, `queueReorderTouch`, `unavailable`, `loadRetry`, `lyricsRetry`, `fetchFailure`, `storage`, `navigation`, `paths`, `info`, `volume`, `mobilePlayer`, `mobile`, and `api`. `features/README.md` maps each one to what it proves. `playlistFallback` edits the server's own playlists database, which `drive.mjs` finds in `.run/playlists.path` (written by `launch.sh`). Against a server you started yourself, pass the same `PLAYLISTS_DB_PATH` to `drive.mjs`. The exit code is non-zero if any check fails. A failed `step` that passes its page saves `<journey>-step-<n>-failure.png`.

Five journeys use `agent-browser` in a different way than a plain page. `player` holds YouTube's `iframe_api` script with `network route --body` and releases it by running the real script. `loadRetry` makes that script fail with `network route --abort` and later removes the route. `fetchFailure` makes `/api/get-karaoke` fail the same way. `lyricsRetry` answers every `/api/get-lyrics` request with a body that is not lyrics, through `network route --body`, and later removes the route. The blocked-storage checks in `player` and `storage` and the `strictAutoplay` and `queueReorderTouch` journeys each start a second session, because launch flags (`--init-script`, `--args`) apply only to a session's first command.

## Evidence

Each run writes `results.json` and screenshots to `.claude/skills/verify/evidence/<timestamp>/`. The folder is gitignored and cleanup keeps it.

A proof must exercise the real user path and show both the action and the resulting state. Keep a failing check as a failure. Do not weaken a journey to make it pass. Report which target you drove. Open the screenshots too, because assertions do not catch broken styling.

## Cleanup

```sh
.claude/skills/verify/cleanup.sh
```

This stops the process group that `launch.sh` started, closes any `fio-*` browser session a crashed run left behind, removes the snapshot and logs, and lists recent evidence. Close a tunnel with `ssh -S /tmp/fio-tunnel -O exit devbox`.

## Safety

- The database belongs to the discord bot. Never write to `/data/karaoke.db`. For reads, use `sqlite3 -readonly` inside `discord-bot-discord-bot-1`.
- To test database behavior, copy the data into a throwaway Docker volume on the devbox.
