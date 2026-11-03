# Fiona Station

Fio Radio is a one-page fan site for browsing and playing Fiona Clearesta's karaoke, covers and originals. The frontend is a [Foldkit](https://foldkit.dev) app in TypeScript. A small Node server in `server/` serves the built app and one read-only JSON route.

The site reads song data from the SQLite database that the [discord bot](https://github.com/alwinihza/discord-bot) owns. The bot is the only writer and owns the schema. To add or change songs, use the bot's `/setlist` command.

| Page or route | Data |
| --- | --- |
| `/`, `/api/get-karaoke` | every `karaoke_video` row (karaoke, cover, original) and its songs |

`/radio`, `/karaoke`, `/cover`, `/about` and `/credits` are old page paths. They answer 301 to `/` and keep the query string.

The server also asks YouTube's oEmbed endpoint about every video at startup and then hourly (`server/videoStatus.ts`). `/api/get-karaoke` adds `is_gone: true` to a video that YouTube answers with 401, 403 or 404. The flag lives in memory only. An unclear answer or a network error keeps the previous one.

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

## Deploy on Vercel

Vercel serves the static build and sends `/api/*` to `api/proxy.ts`, which forwards it to the devbox. Set two environment variables in the Vercel project:

- `API_ORIGIN` is the devbox origin, such as `https://<host>.ts.net`, with no trailing slash.
- `PROXY_SECRET` is a long random string, such as the output of `openssl rand -hex 32`.

Put the same `PROXY_SECRET` in `~/project/fionastation/.env` on the devbox. Compose refuses to start without it, and the server answers 403 to any `/api` request that lacks it.
