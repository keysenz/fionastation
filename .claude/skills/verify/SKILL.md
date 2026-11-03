---
name: verify
description: Launch and drive the Fiona Station website (Foldkit pages for karaoke, covers, about, credits, and its read-only JSON API) in a real browser, locally or on the devbox, and capture proof. Use to confirm any UI, API, data-layer, or dependency change works in the real app.
---

# Verify Fiona Station

The user surface is a web site. `drive.mjs` drives it with Playwright, using the real pages and real song data. There are no mocks. The local app reads a snapshot of the discord bot's database. The deployed app reads the live database.

Run every command from the repository root. First-time setup, once per checkout:

```sh
source ~/.nvm/nvm.sh && nvm use
(cd .claude/skills/verify && npm install && npx playwright install chromium)
```

Playwright stays at 1.49.1 because later releases do not support this machine's Ubuntu 20.04.

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

## Doctor

Run this first whenever something looks wrong. It only reads.

```sh
.claude/skills/verify/doctor.sh
```

Require `server: ours`, the expected Foldkit version, and non-zero counts for songs and covers. With `BASE_URL` set, it skips the ownership line.

## Drive

```sh
(cd .claude/skills/verify && node drive.mjs)                 # every journey
(cd .claude/skills/verify && node drive.mjs karaoke cover)   # chosen journeys
```

The journeys are `site`, `karaoke`, `cover`, `player`, `queueReorder`, `queueReorderTouch`, `unavailable`, `coverPlayer`, `fetchFailure`, `storage`, `navigation`, `paths`, `mobile`, and `api`. `features/README.md` maps each one to what it proves. The exit code is non-zero if any check fails.

## Evidence

Each run writes `results.json` and screenshots to `.claude/skills/verify/evidence/<timestamp>/`. The folder is gitignored and cleanup keeps it.

A proof must exercise the real user path and show both the action and the resulting state. Keep a failing check as a failure. Do not weaken a journey to make it pass. Report which target you drove. Open the screenshots too, because assertions do not catch broken styling.

## Cleanup

```sh
.claude/skills/verify/cleanup.sh
```

This stops the process group that `launch.sh` started, removes the snapshot and logs, and lists recent evidence. Close a tunnel with `ssh -S /tmp/fio-tunnel -O exit devbox`.

## Safety

- The database belongs to the discord bot. Never write to `/data/karaoke.db`. For reads, use `sqlite3 -readonly` inside `discord-bot-discord-bot-1`.
- To test database behavior, copy the data into a throwaway Docker volume on the devbox.
