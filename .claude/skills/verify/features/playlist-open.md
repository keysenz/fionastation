# Open a shared playlist link

A visitor who opens `/p/<id>` gets that playlist on the Fio Radio page. With an empty queue it plays at once. With a saved queue the page asks to replace the queue, add to it, or cancel. A deleted playlist (410) and an unknown id (404) land on `/` with a toast.

## Journeys

- `playlistOpen` seeds a playlist through `POST /api/playlists`, opens its link, and expects the first song in the player bar, the rest in `karaoke-storage` in order, the link kept in the address bar, and the name in the page title.
- `playlistChoice` saves a two-song queue, opens a link, and expects the question (`role=dialog`, buttons by `data-playlist-choice`). Replace leaves only the playlist, Append keeps the queue first and starts nothing, Cancel and Escape change nothing.
- `playlistNavigation` opens a link, goes to the song list and Back, reloads, and expects no question and an unchanged queue each time. The same link again after the visitor queued another song asks, with the playlist name out of the title. A different link still asks.
- `playlistSlowFetch` holds the playlist response in the page (an init script on `fetch`) and releases it later. It expects a question when the visitor started a song meanwhile, and nothing loaded when the visitor left for `/songs` first.
- `playlistFocus` opens the question, cycles Tab and Shift+Tab through its three choices, and expects Escape to cancel and return focus to the info button.
- `playlistGone` deletes a playlist, then opens its link and `/p/zzzzzzzz`. Each lands on `/` with `data-toast` `PlaylistDeleted` or `PlaylistNotFound`. `/p/short` answers 404.
- `playlistUnavailable` queues a playlist that holds a gone song and expects it left out, with `data-toast` `PlaylistSongsUnavailable`.
- `playlistFallback` rewrites one stored entry's song id in `PLAYLISTS_DB_PATH` and expects it to resolve by video and timestamp.
- `playlistMobile` repeats the question and a toast at 375px and expects no sideways scroll.
- `playlistTiming` times navigation to a loaded player (headless Chrome does not start sound without a gesture, so the state is the video id on the player, not Playing) for `/` and for a 30-song `/p/<id>`. Set `TIMING_RUNS` to change the 10 runs.

## Gotchas

- The journeys read the playlists database path from `PLAYLISTS_DB_PATH` or from `.run/playlists.path`, which `launch.sh` writes.
- `launch.sh` raises `PLAYLISTS_IP_LIMIT_PER_HOUR` to 1000 so the journeys can seed many playlists.
- Assertions use `data-toast`, `data-playlist-choice`, `data-playlist-context` (`Playing`, `Queued` or `PlayingAndQueued`) and state, never wording.
