# Karaoke archive

A visitor searches every song from the karaoke streams, plays one at its timestamp, builds a queue, and keeps the queue and history across a reload.

## Sub-features

- `karaoke-list` shows every song from streams with `kind = 'karaoke'`.
- `karaoke-search` fuzzy-matches titles and shows an empty state.
- `karaoke-play` opens the YouTube player at the song's timestamp.
- `karaoke-queue` adds songs, and Next plays them in order.
- `karaoke-previous` returns to the earlier song and puts the song it left first under Up Next.
- `karaoke-reload` restores the queue and history.
- `karaoke-gone-row` keeps a song whose stream is gone in the list, dimmed, with a `Stream gone` pill, and it cannot be played or queued.

## How to get to it (user POV)

- Choose `Karaoke` in the home menu.
- Open `/karaoke` directly.

## Driving it with drive.mjs

Preconditions:

- Doctor reports a non-zero song count.

- **List.** Open `/karaoke`. Run `node drive.mjs karaoke`. The row count equals the song count from `/api/get-karaoke`.
- **Search.** The journey fills `Search songs...` with a real title, then with `zzzqqqxxx`. The list narrows, then shows `No songs found`.
- **Play.** The journey chooses the first row of a public video. The player bar shows its title and the iframe `src` contains the video ID and `start=`.
- **Queue.** The journey hovers a row and chooses `Add to Queue`, then chooses the forward icon. The player bar shows that song. A second queued song appears under `Up Next` in the drawer.
- **Previous.** The journey chooses the backward icon. The bar shows the earlier song and the song it left is first under `Up Next`. The forward icon then plays that song again.
- **Reload.** The journey reloads the page. `karaoke-storage` in `localStorage` still holds the queue and history, the drawer lists the queued song, and no page error is logged.
- **Gone row.** The `unavailable` journey finds a row with `is_gone` in the API. The row shows `Stream gone`, has no `Add to Queue` button, no thumbnail, and `aria-disabled`. Clicking it opens no player bar and no iframe. `karaoke-gone-row.png` holds the screenshot.
- **Proof.** Open `karaoke-queue.png` and `results.json` in the evidence folder.

## Gotchas

- Several consecutive rows can share a title, so the journey chooses rows with distinct titles. A check on identical titles passes without proving anything.
- `Add to Queue` is invisible until the row is hovered.
- The current song is not kept across a reload, by design.
- The first songs in the list can be from private videos, and a private video now skips on by itself. The `karaoke`, `player`, and `storage` journeys choose rows whose `is_gone` is false in the API. The `unavailable` journey uses a gone row, and a queued gone song to reach the player.
- A gone row has no `group` or `cursor-pointer` class, so the journeys find rows by the `rounded-lg p-3` row that holds an `h4`.
