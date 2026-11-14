# Player

A visitor plays a video, and the page and the YouTube player stay in agreement.

## Sub-features

- `player-expand` keeps the same iframe across expand and collapse.
- `player-control` pauses the real video from the bar.
- `player-report` shows a play or pause started inside the player in the bar.
- `player-end` at video end, with an empty queue, picks a random other live video and plays its first song in the same iframe, whichever song of the stream was clicked. It never replays the stream that ended. With autoplay off it pauses the same song.
- `player-unavailable` skips a video YouTube reports gone (error 100, 101 or 150), with every song that shares it, and lands on the first song of a random other live video. While that video is being picked, the bar shows a spinner in place of the play button. With autoplay off, or when nothing later is left, the same song stays, the bar says `This stream is gone`, the play button is disabled, and there is no toast.
- `player-load-retry` keeps a song whose load failed (any other YouTube error, a YouTube script that did not load, or a play still loading after 20 seconds). The bar says it could not load, and the middle button becomes `Retry`. The radio loads it again by itself after 2, 4 and 8 seconds, and then stops. `Retry` loads at once and counts as the next attempt. Nothing is marked gone, and the queue and history do not change.
- `player-lyrics-retry` shows, in the open player, a song whose lyrics failed to load with a `Try again` button. The panel carries `data-lyrics-retry="Waiting"` while a retry is on its way and `data-lyrics-retry="GaveUp"` once the radio stopped. The radio fetches again by itself every 15 seconds, at most three times, until the playhead passes the song's end: the next song's timestamp, or six minutes after the last song's start. Going back to the song fetches its lyrics again at once. `Try again` works in either state.
- `player-autoplay` is a switch in the bar (role `switch`, name `Autoplay`), on by default and saved in `localStorage` under `karaoke-autoplay`. Off, a video end with an empty queue keeps the same song, paused, and a failed video stays on it. The queue still plays either way.
- `player-strict-autoplay` plays each clicked song in a browser that blocks autoplay without a gesture inside the player (Safari, Firefox, phones). After the first play, every later song plays from its start in the same iframe.
- `player-segment-skip` moves within a stream from the bar. With an empty queue, Next seeks to the next song's timestamp and Previous to the song before, in the same iframe. With songs queued, Next plays the queue head instead. On a video's last song with an empty queue, Next plays a random other live video.
- `player-skip-toast` shows a toast saying why a different song started: `"<title>" was skipped because its stream is gone.` Consecutive dead videos keep the first title and say `and <n> more their streams are gone`. It dismisses itself after 6 seconds or on the close button, and shows nothing when no skip happened.

## How to get to it (user POV)

- Choose a song on `/`.

## Driving it with drive.mjs

Preconditions:

- The network reaches YouTube.

- **All.** Run `node drive.mjs player unavailable`. The journey reads `is_gone` from the API to tell live videos from gone ones and drives the player through `window.YT.get`.
- **Autoplay.** The `player` journey expects the switch on by default and inside a 375px bar with a touch target of at least 40px. It also starts the last song of a live video with more than one song, seeks near the end, and expects the player on the first song (at its timestamp) of a different live video. Then it turns the switch off, seeks near the end, and expects the same song, paused, in the same iframe. After a reload `karaoke-autoplay` is `false` and the switch is off. A page with blocked storage still renders with the switch on.
- **Proof.** Open `player-expanded.png` and `results.json` in the evidence folder.

- **Segment skip.** Run `node drive.mjs segmentSkip`. It plays the second song of the first live video with three or more songs, clicks Next and expects the player within 10 seconds after the third song's timestamp, then Previous twice to the second and first song, with one iframe throughout. On the last song it expects Next to load another live video. Then it queues the last song while the first plays and expects Next to play it. `segment-skip-next.png` holds the screenshot.

- **Cover end.** Run `node drive.mjs coverEnd`. Covers are YouTube Shorts. At its end, an embedded Short either reports ENDED or jumps back to its start without reporting anything. The journey plays the "Only Love" cover (`g26JmYMkml4`) from its video row. It expects the setlist pane to show that cover and the URL to have no `?v=`. With autoplay on, it seeks to 2 seconds before the end. It expects another live video to load within 10 seconds and keep playing, with the pane following it. Then it seeks one cover to 0.8 seconds before its end and clicks a second cover. The second cover must keep playing. With repeat One, two ends must each replay the cover from its start. With autoplay off, the end must leave the cover stopped, with the play button in the bar. A listener on the player records whether each end was reported or wrapped. The check `the step covered that path` fails when the autoplay-on end was reported, because that run says nothing about the wrap. Rerun the journey in that case. `cover-end-setlist.png`, `cover-end-moved-on.png` and `cover-end-stopped.png` hold the screenshots.

- **Strict autoplay.** Run `node drive.mjs strictAutoplay`. The journey starts its own `agent-browser` session with `--args "--autoplay-policy=user-gesture-required"`. It plays the first song of a live stream with three or more songs and expects the bar to show the play button within 10 seconds, because that browser blocks the first play. Then it expands the player and clicks the middle of the video once. Then it plays the third song of that stream and the second song of another such stream. Each must reach YouTube state 1 (playing) within 15 seconds of its timestamp, with the pause icon in the bar. A 50ms sampler expects one iframe element for the whole run. `strict-autoplay.png` holds the screenshot.

- **Loading.** The `player` journey holds YouTube's script, plays a song, and expects the expand button disabled. It then plays the next song while the script is still held and expects that later song to load once the script arrives.

- **Load retry.** Run `node drive.mjs loadRetry`. The journey makes every request for YouTube's `iframe_api` script fail and plays the first live song. It expects a `Retry` button on the same song, no play or pause button, no toast and no disabled row. It counts the page's requests for the script in the browser's resource timing, and expects four (the first and three retries), 2, 4 and 8 seconds apart, and no fifth in the next 12 seconds. Then it removes the route, focuses `Retry`, presses Enter, and expects a fifth request, the song loaded at its timestamp in one player, the play button back, and an empty queue and history. `load-retry-failed.png` and `load-retry-playing.png` hold the screenshots.

- **Lyrics retry.** Run `node drive.mjs lyricsRetry`. The journey answers every `/api/get-lyrics` request with a body that is not lyrics, plays the first song of the first live video with three or more songs, and opens the player. It expects `data-lyrics-retry="Waiting"` with a `Try again` button, then a second request for that song within 25 seconds. It seeks five seconds past the second song's timestamp and expects no further request for the first song in the next 20 seconds while the video plays on. Previous then goes back to the first song and must fetch it again within 8 seconds. Last it removes the route, clicks `Try again`, and expects the retry gone once the server answers. It counts requests per `song=` id in the browser's resource timing, because the next song fetches too. `lyrics-retry-waiting.png` and `lyrics-retry-loaded.png` hold the screenshots.

- **Unavailable.** A gone row cannot be played. The journey seeds `karaoke-storage` with a queue whose head is a gone song, plays a live song, and presses Next. It expects the player to land on the first song of a random other live video, with one player and no error in the bar. It also expects the `status` toast to name the gone song, to fit inside a 375px viewport with a 16px gutter, and to disappear within 15 seconds. `karaoke-skip-toast.png` holds the screenshot.

## Gotchas

- Headless Chrome can block autoplay, so the journey calls `playVideo` itself before it seeks.
- The same-video end check starts from a song that is not the last of its video, because the last one picks a random video. The random check can land on any other live video, so it accepts any live first song.
- The toast lasts 6 seconds, so the journey checks it before any slower step. A later private video turns the text plural.
- Several consecutive rows can share a title, so the end check reads the loaded video and its time through `window.YT.get`, not the iframe `src`.
- A one-song video was seen looping back to 0 without reporting an end, so the end check starts from a stream with more than one song. The seek repeats once a second until the player is near the end.
- `loadRetry` covers only a script that fails to load. No journey makes YouTube raise error 5 or lets a play sit loading for 20 seconds. `src/youtube.test.ts` covers the error codes, and the story tests and the `radio-player` check cover the timeout.
- The `lyricsRetry` journey takes about a minute, because it outwaits a 15-second lyrics retry after the seek. It does not reach the three-retry cap or a give-up shown on screen. The story and scene tests and the `radio-player` check cover those.
- The `loadRetry` journey takes about 40 seconds, because it waits out the three automatic retries before it clicks.
- In the strict browser a play started from the bar does not count as a gesture inside the cross-origin player, so the first play needs the click inside the video.
- **Play statistics.** Run `node drive.mjs playStats` against a server from `launch.sh`, which sets `STATS_DB_PATH`, `ADMIN_SECRET` (default `verify-admin-secret`) and `ADMIN_PORT` (default 3911). For a server you started yourself, give the driver the same two admin values. It reads `/stats?days=1` on the admin listener. A clicked song must count one click and one visitor play. A stream playing into its second song must finish the first and play the second with no click. Next partway through a song must record one skip, with seconds into the song inside the wait the journey made. Next on a video's last song must make the radio pick another video, which counts as an autoplay play.
