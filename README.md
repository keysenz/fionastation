# Fiona Station

A fan site for browsing Fiona Clearesta's karaoke archive and covers. The frontend is a [Foldkit](https://foldkit.dev) app in TypeScript. A small Node server in `server/` serves the built app and two read-only JSON routes.

The site reads song data from the SQLite database that the [discord bot](https://github.com/alwinihza/discord-bot) owns. The bot is the only writer and owns the schema. To add or change songs, use the bot's `/setlist` command.

| Page or route | Data |
| --- | --- |
| `/karaoke`, `/api/get-karaoke` | `karaoke_video` rows with `kind = 'karaoke'` and their songs |
| `/cover`, `/api/get-cover` | `karaoke_video` rows with `kind` of `cover` or `original` |

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
