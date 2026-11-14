# Statistics page

`/stats` shows the play statistics to the Discord users in `STATS_USER_IDS`. It reads `/api/stats-page/report`, offers `/api/stats-page/export` downloads, and signs in through the existing Discord login.

## Sub-features

- `stats-signed-out` shows only a Sign in with Discord button, and the report route answers 401.
- `stats-dashboard` shows the tiles, the daily chart, the skip histogram, the top songs and the top videos.
- `stats-range` switches between 24 h, 7 d, 30 d and 90 d, which refetches the report.
- `stats-pick` narrows the skip histogram to one song and sorts the song table.
- `stats-no-access` shows a plain no access screen to a signed-in user who is not listed, and the report answers 403.
- `stats-outcomes` shows the autoplay vs visitor outcome panel: plays, finish rate, skip rate and median skip by origin, from the listening trail.
- `stats-transitions` shows the top transitions table (previous song to song) with a minimum plays choice and sortable plays, finish rate and skip rate.
- `stats-export` offers one download per table (`events`, `decisions`) for the current range, and each streams valid NDJSON for a listed user and answers 401 or 403 otherwise.
- `stats-moods` shows the Moods section: tiles for mood votes, songs with votes and the top mood (ties are listed), a votes-per-day chart, one stacked bar of the six moods with counts and percentages, and a per-song table sorted by votes with a stacked bar, the top mood (ties marked, songs with fewer than 3 votes marked `few votes`) and the video link. A mood chip lists only the songs it leads, and a second click clears it.
- `stats-phone` has no sideways scroll at 375px.

## Driving it with drive.mjs

`node drive.mjs statsPage` starts its own fake Discord and server on the ports after `VERIFY_PORT`, with a scratch `STATS_DB_PATH` it seeds through `server/stats.ts` and `STATS_USER_IDS` set to the two real ids. It needs the production build in `dist/`.

- **Numbers.** The seed is 8 plays today (6 visitor, 2 autoplay), 4 more visitor plays 10 days ago and 10 more 40 days ago. 7 d shows 8, 30 d 12 and 90 d 22.
- **Mood seed.** Today the first song has ceria 3 and hype 2, the second has sendu 1, and 10 days ago the second gets sendu 2. 90 d shows 8 votes, 2 songs and the tied top mood `ceria / sendu`, the sendu chip leaves only the second song, and 1 d shows 6 votes with `few votes` on the second song.
- **Evidence.** `stats-moods-desktop.png`, `stats-dashboard-desktop.png`, `stats-dashboard-90d.png`, `stats-dashboard-phone.png`, `stats-histogram-one-song.png`, `stats-signed-out.png` and `stats-no-access.png`.

## Driving the listening trail with drive.mjs

`node drive.mjs listeningTrail` needs a server from `launch.sh` (it reads that server's `STATS_DB_PATH` from `.run/stats.path` with `node:sqlite`) and the real YouTube player, like `playStats`. It plays a visit, reloads for a second one, then starts its own fake Discord and server on the same stats file to check the panels and exports.

- **Rows.** The first visit must hold Click, Play, Finish, Play, Skip, Play in seq 1 to 6 with the song before each play, then a Skip of the last song, an `autoplay_decisions` row with `propensity = 1 / pool_size` and a lower seq than the autoplay Play it caused. The second visit starts at seq 1, has a different UUID v4, and its first Play has no `prev_song_id`.
- **Memory only.** The session id appears in no cookie, `localStorage` or `sessionStorage`.
- **Panels.** The first song to the second song has 2 plays and a 50% skip rate. Choosing 5+ plays hides it.
- **Export.** `events` and `decisions` return 200 `application/x-ndjson` with as many lines as rows, 401 signed out, 403 unlisted and 400 for another table.
- **Evidence.** `trail-panels-desktop.png` and `trail-panels-phone.png`.

## Gotchas

- The 24 h range is today in UTC, because the counters are per day.
- The journey uses the fake Discord, so it does not prove the real Discord application. The page needs no new redirect URI or scope.
