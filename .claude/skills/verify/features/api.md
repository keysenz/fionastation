# Data API

The page reads one JSON route. The site never writes data, because the discord bot's `/setlist` command is the only way to change songs.

## Sub-features

- `api-read` serves `/api/get-karaoke`.
- `api-gone` marks each karaoke video with `is_gone`, learned from YouTube's oEmbed endpoint at startup and hourly.
- `api-methods` rejects anything but GET.
- `api-removed` confirms that the old write routes, the form and `/api/get-cover` no longer exist.

## How to get to it (user POV)

- Fio Radio (`/`) calls this route. `/api/get-karaoke` returns every kind, each video with a `kind` of `karaoke`, `cover` or `original`.
- Run `curl` against a route directly.

## Driving it with drive.mjs

Preconditions:

- Doctor reports non-zero counts.

- **Gone.** The `api` journey compares `is_gone` of every video with oEmbed (200 is live, 401, 403 and 404 are gone). The `setup` check waits up to 120 seconds for the server to report some gone video after it starts.
- **Methods.** Run `node drive.mjs api`. A POST to the read route returns 405.
- **Removed.** The journey requests `/api/get-cover`, `/api/post-karaoke`, `/api/update-cover`, `/api/update-karaoke`, `/api/webhook`, and `/input_video`. Each returns 404.
- **Proof.** Open `results.json` in the evidence folder.

## Gotchas

- The server learns gone videos a few seconds after startup, and again every hour. A video that turns private in between shows as live until the next refresh, or until a player reports it.
- A YouTube hiccup (any status besides 200, 401, 403, 404, or a network error) keeps the previous answer, so `is_gone` never flips on a bad response.
- In the devbox container, the database volume is mounted read-only. If the container starts while the bot is down and no `-wal` file exists, these routes return 500 until the bot opens the database. The site recovers without a restart.
- Compare counts against the live database with `sqlite3 -readonly` inside `discord-bot-discord-bot-1`.
