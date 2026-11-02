# Fiona Station verification map

This directory is the maintained source for verifying the user-facing behavior of Fiona Station. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch and check the app as `../SKILL.md` describes.
- Each journey starts in a new browser context, so `localStorage` is empty.
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

- [Karaoke archive](./karaoke.md) covers the song list, search, player, queue, and reload.
- [Covers](./cover.md) covers the cover player, its controls, and playlist search.
- [Site pages](./site.md) covers the home menu, background image, static pages, and security headers.
- [Data API](./api.md) covers the read-only routes and the removed write routes.
- [Player](./player.md) covers real playback, the video end, and the player's reports back to the page.
- [Resilience](./resilience.md) covers failed fetches, bad data, blocked or corrupt saved data, two tabs, and bad paths.
