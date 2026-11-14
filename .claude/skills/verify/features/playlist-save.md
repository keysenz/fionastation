# Save, share, edit and copy playlists

A visitor saves a named playlist from Up next, Played or Whole session, shares its `/p/<id>` link, edits it from the browser that saved it or from an edit link, and saves a copy of someone else's playlist.

## Journeys

- `playlistSave` seeds a history, a playing song and a queue, saves each source in turn, and reads each stored playlist back through `GET /api/playlists/<id>`. It also checks name cleaning, that `karaoke-my-playlists` holds the token, and that a source with no songs is disabled.
- `playlistShare` saves the queue, presses Copy and records what reaches `navigator.clipboard.writeText`, then opens the link in a second session. The second session plays the songs and is offered no Rename.
- `playlistEdit` opens the edit link in a second session (fragment dropped, Rename and Delete offered), renames, makes a stale edit and expects the conflict toast and the newer name, checks Update from queue, then deletes and opens the link from the other session.
- `playlistCopy` opens a playlist made through the API, saves a copy, and expects a new id the visitor owns while the original keeps its name and version.
- `playlistNoStorage` blocks `localStorage`, saves, and expects the link and a notice that the edit link must be copied.
- `playlistLimit` starts a second server on port 4619 with `PLAYLISTS_IP_LIMIT_PER_HOUR=1` and expects the second save to leave the dialog open with the rate-limited failure and the queue untouched.
- `playlistSaveMobile` repeats the dialogs and the playlist bar at 375px with no sideways scroll.
- `playlistSaveTiming` measures from the Submit click to the shared dialog with `performance.now()`. Set `TIMING_RUNS` to change the 10 runs.

## Gotchas

- Assertions use `data-playlist-*` attributes and `data-toast`, never wording.
- Headless Chrome may refuse clipboard access, so `playlistShare` wraps `writeText` to record the text and still calls the real one.
- `playlistLimit` needs `.run/karaoke.db` from the launcher and kills its extra server when it ends.
