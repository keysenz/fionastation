# Fiona Station verification map

This directory is the maintained source for verifying the user-facing behavior of Fiona Station. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch and check the app as `../SKILL.md` describes.
- Each journey starts in a new `agent-browser` session, so `localStorage` is empty.
- The song data is real and changes when the bot's `/setlist` runs, so journeys read expected values from the API.

## Driving conventions

- Run `node drive.mjs <journey>` from `.claude/skills/verify`.
- Prefer roles, placeholders, and titles that the pages already render.
- Some controls have only an icon. For those, use the Font Awesome class, which is the only stable handle.

## Proof and skip reporting

- Report the target (the local production build or the devbox container) and the evidence folder.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a path that no journey covers as verified. Each feature's `Gotchas` section lists the known gaps.

## Features

- [Fio Radio](./karaoke.md) covers the `/` page (karaoke, cover and original videos in one list), the song list, search, player, queue, queue reordering by mouse, touch and keyboard, and reload.
- [Song list](./songs.md) covers the `/songs` page, its search, and `/api/get-songbook`.
- [Site](./site.md) covers the background image, the info panel with Who is Fiona and the Credits, the old page redirects, and security headers.
- [Data API](./api.md) covers the read-only routes and the removed write routes.
- [Player](./player.md) covers real playback, the video end, the player's reports back to the page, a load that fails and is retried, lyrics that fail and are retried until the song ends, and song changes in a browser that blocks autoplay.
- [Resilience](./resilience.md) covers failed fetches, bad data, blocked or corrupt saved data, two tabs, and bad paths.
