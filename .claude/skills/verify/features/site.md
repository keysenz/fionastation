# Site pages

A visitor lands on the home page, sees the background art, and opens the static pages from the menu.

## Sub-features

- `site-home` renders the heading, menu, and background image.
- `site-pages` opens About and Credits from the menu.
- `site-headers` serves the security headers from `server/main.ts`.

## How to get to it (user POV)

- Open `/`.
- Choose a menu item.

## Driving it with drive.mjs

Preconditions:

- Doctor reports `server: ours`, or `BASE_URL` is set.

- **Home.** Open `/`. Run `node drive.mjs site`. The `Background` image has a non-zero natural width.
- **Pages.** The journey chooses `About` and `Credits`. Each page's heading appears.
- **Headers.** The journey fetches `/`. `X-Frame-Options` is `SAMEORIGIN`.
- **Proof.** Open `home.png` and `results.json` in the evidence folder.

## Gotchas

- Icons come from Font Awesome's CDN, so they are missing if the network blocks it.
