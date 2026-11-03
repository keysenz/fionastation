# Karaoke archive

A visitor browses the karaoke streams in a master-detail layout, with the stream list on the left and the chosen stream's setlist on the right. On a phone the list and the setlist take turns, with an All streams button to go back. Searching a song hides every stream without it, and the visitor picks which stream's performance to play. The queue and history survive a reload.

## Sub-features

- `karaoke-list` shows one row per stream with `kind = 'karaoke'` (`nav` named `Karaoke streams`), newest first, gone streams last. Choosing a row (`aria-current`) lists only that stream's songs with timestamps in the setlist pane (`section` named `Setlist of ...`). One stream is selected at a time.
- `karaoke-search` keeps only streams with a match, shows `N matches` on each row, and shows only the matching songs under `M of N songs match` in the setlist header of the chosen stream. A literal match on a song or stream title wins, and only when nothing matches literally does a fuzzy match on song titles run. Clearing the search restores every stream and keeps the chosen one.
- `karaoke-play` opens the YouTube player for the chosen stream at the song's timestamp. Choosing the current song pauses or resumes it.
- `karaoke-queue` adds songs with an always visible `Add to Queue` button, and Next plays them in order. On a screen at least `md` wide the open queue drawer reserves its width (22.5rem with its handle), so no `Add to Queue` hides behind it. On a phone the drawer covers the page and has a `Close queue` button.
- `karaoke-previous` returns to the earlier song and puts the song it left first under Up Next.
- `karaoke-reload` restores the queue and history.
- `karaoke-gone` labels a gone stream `Stream gone`, requests no thumbnail, and lets it be chosen to show disabled rows.

## How to get to it (user POV)

- Choose `Karaoke` in the home menu.
- Open `/karaoke` directly.

## Driving it with drive.mjs

Preconditions:

- Doctor reports a non-zero song count.

- **List.** Open `/karaoke`. Run `node drive.mjs karaoke`. The stream row count equals the video count from `/api/get-karaoke`, exactly one is selected, and the setlist shows only its songs. Choosing a stream shows as many song rows as the API lists for it.
- **Search.** The journey fills `Search songs...` with the title that is on the most live streams. The stream rows equal the streams the API says contain it. Choosing each in turn, the song rows add up to the matching songs, and each header reads `M of N songs match` with an `N matches` count on its row. `zzzqqqxxx` shows `No songs found`, and clearing the search restores every stream and the stream that was chosen.
- **Play.** The journey plays that title from the last stream that has it. The iframe `src` holds that stream's video ID and `start=`. A plain play of another song checks the same. A stream row that is not selected but holds the current song shows a `Now playing` icon.
- **Queue.** `Add to Queue` is visible without hovering and at least 40px high and wide. The journey adds a song, then chooses the forward icon. The player bar shows that song. A second queued song appears under `Up Next` in the drawer. With the drawer open at 1280x800, every `Add to Queue` ends left of the drawer, is not covered, and can be clicked. The `scrollbar-color` computed on the stream list, the setlist and the drawer is the #446e92 thumb on a dark track.
- **Previous.** The journey chooses the backward icon. The bar shows the earlier song and the song it left is first under `Up Next`. The forward icon then plays that song again.
- **Reload.** The journey reloads the page. `karaoke-storage` in `localStorage` still holds the queue and history, the drawer lists the queued song, and no page error is logged.
- **Gone.** The `unavailable` journey checks that gone streams come last with the `Stream gone` label and no thumbnail, show disabled rows without `Add to Queue` when chosen, do not play when a row is clicked, and appear after the live streams in a search.
- **Phone.** The `mobile` journey sets 375px. Nothing overflows sideways, `Add to Queue` is icon only, at least 40px, and ends left of the queue handle, and a search keeps that. The setlist opens after choosing a stream and All streams returns to the list. The queue drawer has a `Close queue` button of at least 40px that slides it off screen.
- **Proof.** Open `karaoke-list.png`, `karaoke-search.png`, `karaoke-list-375.png`, `karaoke-search-375.png`, `karaoke-setlist-375.png`, `karaoke-queue.png`, `karaoke-queue-open-wide.png`, `karaoke-queue-375.png` and `results.json` in the evidence folder.

## Gotchas

- Several songs can share a title, so the journey chooses songs with distinct titles. A check on identical titles passes without proving anything.
- Song rows exist only for the chosen stream. Helpers choose the stream first (going back to the list on a phone), and find the row by its position in the API's song list for that stream.
- A check that scrolls a button into view must centre it. The player bar covers the bottom of the setlist pane, so a button that is merely inside the pane can sit under the bar.
- The current song is not kept across a reload, by design.
- The first songs in the list can be from private videos, and a private video now skips on by itself. The `karaoke`, `player`, and `storage` journeys choose rows whose `is_gone` is false in the API. The `unavailable` journey uses a gone row, and a queued gone song to reach the player.
- A gone row has no `group` or `cursor-pointer` class, so the journeys find rows as the `li` items of the setlist `ol`.
