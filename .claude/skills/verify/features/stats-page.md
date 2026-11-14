# Statistics page

`/stats` shows the play statistics to the Discord users in `STATS_USER_IDS`. It reads `/api/stats-page/report` and signs in through the existing Discord login.

## Sub-features

- `stats-signed-out` shows only a Sign in with Discord button, and the report route answers 401.
- `stats-dashboard` shows the tiles, the daily chart, the skip histogram, the top songs and the top videos.
- `stats-range` switches between 24 h, 7 d, 30 d and 90 d, which refetches the report.
- `stats-pick` narrows the skip histogram to one song and sorts the song table.
- `stats-no-access` shows a plain no access screen to a signed-in user who is not listed, and the report answers 403.
- `stats-phone` has no sideways scroll at 375px.

## Driving it with drive.mjs

`node drive.mjs statsPage` starts its own fake Discord and server on the ports after `VERIFY_PORT`, with a scratch `STATS_DB_PATH` it seeds through `server/stats.ts` and `STATS_USER_IDS` set to the two real ids. It needs the production build in `dist/`.

- **Numbers.** The seed is 8 plays today (6 visitor, 2 autoplay), 4 more visitor plays 10 days ago and 10 more 40 days ago. 7 d shows 8, 30 d 12 and 90 d 22.
- **Evidence.** `stats-dashboard-desktop.png`, `stats-dashboard-90d.png`, `stats-dashboard-phone.png`, `stats-histogram-one-song.png`, `stats-signed-out.png` and `stats-no-access.png`.

## Gotchas

- The 24 h range is today in UTC, because the counters are per day.
- The journey uses the fake Discord, so it does not prove the real Discord application. The page needs no new redirect URI or scope.
