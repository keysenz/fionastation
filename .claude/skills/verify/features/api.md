# Data API

The pages read two JSON routes. The site never writes data, because the discord bot's `/setlist` command is the only way to change songs.

## Sub-features

- `api-read` serves `/api/get-karaoke` and `/api/get-cover`.
- `api-methods` rejects anything but GET.
- `api-removed` confirms that the old write routes and form no longer exist.

## How to get to it (user POV)

- The karaoke and cover pages call these routes.
- Run `curl` against a route directly.

## Driving it with drive.mjs

Preconditions:

- Doctor reports non-zero counts.

- **Methods.** Run `node drive.mjs api`. A POST to each read route returns 405.
- **Removed.** The journey requests `/api/post-karaoke`, `/api/update-cover`, `/api/update-karaoke`, `/api/webhook`, and `/input_video`. Each returns 404.
- **Proof.** Open `results.json` in the evidence folder.

## Gotchas

- In the devbox container, the database volume is mounted read-only. If the container starts while the bot is down and no `-wal` file exists, these routes return 500 until the bot opens the database. The site recovers without a restart.
- Compare counts against the live database with `sqlite3 -readonly` inside `discord-bot-discord-bot-1`.
