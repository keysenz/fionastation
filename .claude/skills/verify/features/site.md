# Site

Fio Radio is the only page. A visitor opens `/`, sees the background art and the radio, and opens an info panel for who Fiona is and the credits. The old page paths redirect to `/`.

## Sub-features

- `site-home` renders the `Fio Radio` heading and the background image at `/`.
- `site-info` shows an info button (`About Fio Radio`, 40px) in the radio header. It opens a modal dialog with the sections `Who is Fiona` and `Credits`, with the bio, her YouTube, X and wiki links, the fan-site text, the contribute links, every credited name and the background credit. Every link opens in a new tab with `rel="noopener noreferrer"`. Focus moves into the dialog on open. Escape, the `Close` button and a click on the backdrop close it, and focus returns to the info button. The dialog sits above the player bar and the skip toast.
- `site-redirects` answers `/radio`, `/karaoke`, `/cover`, `/about` and `/credits` with 301 to `/` and keeps the query string.
- `site-headers` serves the security headers from `server/main.ts`.

## How to get to it (user POV)

- Open `/`.
- Choose the circled `i` at the left of the `Fio Radio` heading.

## Driving it with drive.mjs

Preconditions:

- Doctor reports `server: ours`, or `BASE_URL` is set.

- **Home.** Run `node drive.mjs site`. The `Background` image has a non-zero natural width.
- **Info.** Run `node drive.mjs info`. The journey opens the panel with the button, reads both headings, checks that each link has `target="_blank"` and a `noopener noreferrer` rel, closes it with Escape, the `Close` button and the backdrop, and checks `document.activeElement` after each. It then repeats at 375x667, where the panel stays inside the screen, scrolls to its end, and keeps a visible 40px `Close` button. Open `info-desktop.png`, `info-375.png` and `info-375-scrolled.png`.
- **Redirects.** Run `node drive.mjs paths`. Each old path answers 301 with `Location: /?x=1` for the query `?x=1`, `/` answers 200 and an unknown path answers 404.
- **Headers.** The `site` journey fetches `/`. `X-Frame-Options` is `SAMEORIGIN`.
- **Proof.** Open the screenshots and `results.json` in the evidence folder.

## Gotchas

- Icons come from Font Awesome's CDN, so they are missing if the network blocks it.
- The dialog's title is uppercase through CSS, so read it with `textContent`, not `innerText`.
- A key press reaches the Escape handler only while focus is inside the dialog. The panel takes focus when it opens, and a click on its text keeps focus there.
