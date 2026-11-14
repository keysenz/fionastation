# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

- The discord bot owns the SQLite database and is the only writer. The site only reads it, through `server/db.ts`.
- The site owns a second SQLite file, `PLAYLISTS_DB_PATH`, for shared playlists, and is its only writer (`server/playlists.ts`). Nothing else may open it for writing. Playlist routes live under `/api/playlists` and take GET, POST, PUT and DELETE. Entries are always derived from `karaoke.db` by song id. `PLAYLISTS_IP_LIMIT_PER_HOUR` overrides the 10 creates an hour per IP for perf runs. `server/` may import `src/playlistName.ts` at runtime, and the Dockerfile copies that one file.
- The site owns a third SQLite file, `STATS_DB_PATH`, for private play statistics, and is its only writer (`server/stats.ts`). Unset or unopenable, `POST /api/stats` answers 503 and the rest of the site works. It keeps no IP, visitor id or cookie. `song_stats` holds daily counters of `Click`, `Play` and `Finish` by song and origin (`Visitor` or `Autoplay`), and `skips` holds one raw row per skip with `seconds_into_song`, because skip counts alone cannot tell a disliked song from the talk after one. The page posts `{ songId, kind, origin }` (plus `secondsIntoSong` for `Skip`, and for no other kind) with the `RecordStat` Command. `STATS_IP_LIMIT_PER_HOUR` overrides the 600 posts an hour per IP. The private read route is `GET /stats?days=N` (default 30) on the admin listener, behind `ADMIN_SECRET`. It lists per song and per video the clicks, plays, finishes and skips by origin, with the median seconds into a skip for songs, sorted by visitor plays. It joins `karaoke.db` at read time, so video totals are not stored. Nothing reads these numbers to pick a video yet.
- The site has two pages. Fio Radio is at `/`, and the song list Fiona can sing is at `/songs`. The old `/radio`, `/karaoke`, `/cover`, `/about` and `/credits` paths redirect to `/` in `server/main.ts`. Fio Radio lists karaoke, cover and original videos together. `src/page/karaoke/karaoke.ts` holds that page's state and `view.ts` its markup. `setlist.ts` holds the queue rules as pure functions. Run the `karaoke-queue` skill when you change it.
- Run the `radio-player` skill when you change `update`, a Message or a Command in `src/page/karaoke/karaoke.ts`, or `PlayerEvent` or `videoEvents` in `src/youtube.ts`. It explores every order of clicks, player events and Command results up to a bound.
- What a play is doing is one `phase` on `NowPlaying` in `setlist.ts`: `Loading`, `Playing`, `Paused`, `MovingOn`, `Gone` or `LoadFailed`. Derive every view decision from it. A gone stream (YouTube error 100, 101 or 150) is skipped and never enters the queue or history. A load that failed (any other error, a script that did not load, or 20 seconds of loading) stays on its song and is retried after 2, 4 and 8 seconds. `attempt` counts those loads and only a `Playing` report resets it.
- Tailwind stays on v3 with PostCSS, unlike Foldkit's default of v4, so the page styles did not change in the migration.
- `server/` runs directly with Node's type stripping and has no build step. Keep its imports type-only or relative with a `.ts` extension. It is not covered by Foldkit's lint.
- When you add a page, add its path to `src/route.ts`, to `PAGE_PATHS` in `server/main.ts`, and as a rewrite to `/index.html` in `vercel.json`, because Vercel serves only static files. The about and credits text lives in the info panel, `src/page/karaoke/info.ts`.
- Use the `verify` skill to confirm a change in a real browser. It drives the production build.
- `server/lyrics-aligned.json` holds LRCLIB lines retimed to Fiona's singing, per song. Only the offline batch in `scripts/align-lyrics/` writes it (see its README). The server swaps those lines in only when the entry's `lrclibId` is the picked track and its `songTitle` normalizes to the song's current title.
- The song list's source is a Google Sheet that Fiona edits, not the database. `server/songbook.ts` reads its CSV export (`SONGBOOK_SHEET_ID` overrides the sheet) and serves it as `/api/get-songbook`. A future YouTube chat bot reads that route.
