# Fiona Station

Fio Radio is a one-page fan site for browsing and playing Fiona Clearesta's karaoke, covers and originals. The frontend is a [Foldkit](https://foldkit.dev) app in TypeScript. A small Node server in `server/` serves the built app and one read-only JSON route.

The site reads song data from the SQLite database that the [discord bot](https://github.com/alwinihza/discord-bot) owns. The bot is the only writer and owns the schema. To add or change songs, use the bot's `/setlist` command.

| Page or route | Data |
| --- | --- |
| `/`, `/api/get-karaoke` | every `karaoke_video` row (karaoke, cover, original) and its songs |

`/radio`, `/karaoke`, `/cover`, `/about` and `/credits` are old page paths. They answer 301 to `/` and keep the query string.

The server also asks YouTube's oEmbed endpoint about every video at startup and then hourly (`server/videoStatus.ts`). `/api/get-karaoke` adds `is_gone: true` to a video that YouTube answers with 401, 403 or 404. The flag lives in memory only. An unclear answer or a network error keeps the previous one.

## Statistics page

`/stats` is a private dashboard of the play statistics: stat tiles, plays per day by origin with clicks and skips, a sortable table of top songs, a table of top videos, and a histogram of when people skip. It is a plain TypeScript page in `stats-page/`, built as a second Vite entry (`stats.html`), not part of the Foldkit app. Counters are per UTC day, so the 24 h range means today so far.

The page reuses the site's Discord login. A visitor who is signed out sees a Sign in with Discord button that returns to `/stats`. The data comes from `GET /api/stats-page/report?days=N`, which answers 401 when signed out, 403 when the signed-in Discord user id is not in `STATS_USER_IDS`, and 503 when `STATS_USER_IDS`, the Discord login or `STATS_DB_PATH` is missing. The rest of the site keeps working in that case. The admin `GET /stats` on `ADMIN_PORT`, behind `ADMIN_SECRET`, is unchanged.

Set `STATS_USER_IDS` to a comma-separated list of Discord user ids, such as `244661517356761089,927090060480905276`. The Discord application needs no change, because the page signs in through the same `/api/auth/discord/callback` redirect and the `identify` scope as playlists.

## Commissions

Fio's voice, studio and endorsement inquiries go through the site. The forms at `/hire`, `/studio` and `/endorse` post to `POST /api/inquiry`. The site stores each one in `COMMISSIONS_DB_PATH`, a SQLite file it alone writes (`server/commissions.ts`), and answers `{ id, trackingUrl }`. The client picks the `id`, a lowercase UUID, so a retry with the same payload answers 200 with the same reply and a different payload under that id answers 409. The server decodes the body with the form's own `InquiryPayload` Schema, checks the required answers per kind, and prices the answers again with `src/page/commission/pricing.ts`. It stores its own quote and keeps the client's only inside the payload it compares for retries. It keeps a keyed hash of the visitor's IP, not the address.

`trackingUrl` is `/commission/<id>?t=<token>`, where the token is `HMAC-SHA256(COMMISSIONS_SECRET, id)` in base64url. The page behind it reads `GET /api/commission/<id>?t=<token>`, which shows the kind, the creation date and the status history, and never the name or contact. A wrong token and an unknown id both answer 404.

The Discord bot works the commissions through the admin listener (`ADMIN_PORT`, `Authorization: Bearer <ADMIN_SECRET>`):

| Route | What it does |
| --- | --- |
| `GET /admin/commissions/unposted` | commissions with no Discord thread yet, oldest first, with fields, quote, status and `next` |
| `POST /admin/commissions/<id>/posted` | records `{ channelId, messageId }` once. The same pair answers 200, another pair 409 |
| `POST /admin/commissions/<id>/events` | moves the status with `{ status, note? }` and `X-Acting-Discord-Id`. A move the table forbids answers 400 |

The status table, which the site owns and the bot reads through `next`:

| From | Allowed next |
| --- | --- |
| `received` | `quoted`, `declined` |
| `quoted` | `deposit_paid`, `declined` |
| `deposit_paid` | `in_progress` |
| `in_progress` | `preview` |
| `preview` | `draft` |
| `draft` | `revision`, `final` |
| `revision` | `draft`, `final` |
| `final`, `declined` | none |

Set `COMMISSIONS_DB_PATH` and `COMMISSIONS_SECRET` to switch the public routes on. `COMMISSIONS_IP_LIMIT_PER_HOUR` overrides the 5 new inquiries an hour per IP. The admin routes need only the database and `ADMIN_SECRET`. Nothing deletes old commissions yet.

## Where state lives

All page state is one Schema-typed Model in `src/`, and it changes only when `update` handles a named Message. Side effects, such as fetching or controlling the YouTube player, are Commands that `update` returns. Read [`FOLDKIT.md`](./FOLDKIT.md) before you change the app.

To see the state, open the app with `npm run dev` and use the DevTools panel in the page. It lists every Message and shows the Model after each one, and you can step back through them.

The discord bot's data reaches the app through `/api/*`. The app decodes it with the Schemas in `src/domain.ts`, so data of the wrong shape shows an error instead of breaking the page later.

## Run locally

Requires Node.js 26.13 or later. The commands below assume nvm.

```sh
nvm use
npm install
node .claude/skills/verify/snapshot-db.mjs
```

The last command copies the bot's database to `.claude/skills/verify/.run/karaoke.db`. Then run the API and the dev server in two terminals:

```sh
DATABASE_PATH=.claude/skills/verify/.run/karaoke.db PORT=3001 npm run dev:api
API_PORT=3001 npm run dev
```

To run the production build instead, use `npm run build`, then `DATABASE_PATH=/path/to/karaoke.db npm start`.

## Check

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the Foldkit Story tests. `.claude/skills/karaoke-queue` checks the queue with generated action sequences, and `.claude/skills/verify` drives the production build in a real browser.

## Deploy on the devbox

The site runs next to the bot and mounts the bot's `discord-bot_botdata` volume. It listens on `127.0.0.1:3100`.

```sh
rsync -a --delete --exclude-from=.dockerignore ./ devbox:project/fionastation/
ssh devbox 'cd ~/project/fionastation && docker compose up -d --build'
```

To turn the statistics page on, put these in `~/project/fionastation/.env` and pass them through `docker-compose.yml`:

- `STATS_DB_PATH` is a file on a volume the site can write, such as `/stats/stats.db`.
- `STATS_USER_IDS` lists the Discord user ids that may open `/stats`.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `SITE_ORIGIN` must already be set for Discord login.

## Deploy on Vercel

Vercel serves the static build and sends `/api/*` to `api/proxy.ts`, which forwards it to the devbox, and serves `/stats` from `stats.html`. Set two environment variables in the Vercel project:

- `API_ORIGIN` is the devbox origin, such as `https://<host>.ts.net`, with no trailing slash.
- `PROXY_SECRET` is a long random string, such as the output of `openssl rand -hex 32`.

Put the same `PROXY_SECRET` in `~/project/fionastation/.env` on the devbox. Compose refuses to start without it, and the server answers 403 to any `/api` request that lacks it.
