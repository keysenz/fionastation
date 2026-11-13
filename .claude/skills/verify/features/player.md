# Player

A visitor plays a video, and the page and the YouTube player stay in agreement.

## Sub-features

- `player-expand` keeps the same iframe across expand and collapse.
- `player-control` pauses the real video from the bar.
- `player-report` shows a play or pause started inside the player in the bar.
- `player-end` moves to the next song of the same video at video end, in the same iframe. At the last song of a video it picks a random other live video and plays its first song. With autoplay off it pauses the same song.
- `player-unavailable` skips a video YouTube refuses, with every song that shares it, and lands on the first song of a random other live video. With autoplay off, or when nothing later is left, the same song stays paused and the bar says `This stream is gone`, with no toast.
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

- **Strict autoplay.** Run `node drive.mjs strictAutoplay`. The journey starts its own `agent-browser` session with `--args "--autoplay-policy=user-gesture-required"`. It plays the first song of a live stream with three or more songs and expects the bar to show the play button within 10 seconds, because that browser blocks the first play. Then it expands the player and clicks the middle of the video once. Then it plays the third song of that stream and the second song of another such stream. Each must reach YouTube state 1 (playing) within 15 seconds of its timestamp, with the pause icon in the bar. A 50ms sampler expects one iframe element for the whole run. `strict-autoplay.png` holds the screenshot.

- **Loading.** The `player` journey holds YouTube's script, plays a song, and expects the expand button disabled. It then plays the next song while the script is still held and expects that later song to load once the script arrives.

- **Unavailable.** A gone row cannot be played. The journey seeds `karaoke-storage` with a queue whose head is a gone song, plays a live song, and presses Next. It expects the player to land on the first song of a random other live video, with one player and no error in the bar. It also expects the `status` toast to name the gone song, to fit inside a 375px viewport with a 16px gutter, and to disappear within 15 seconds. `karaoke-skip-toast.png` holds the screenshot.

## Gotchas

- Headless Chrome can block autoplay, so the journey calls `playVideo` itself before it seeks.
- The same-video end check starts from a song that is not the last of its video, because the last one picks a random video. The random check can land on any other live video, so it accepts any live first song.
- The toast lasts 6 seconds, so the journey checks it before any slower step. A later private video turns the text plural.
- Several consecutive rows can share a title, so the end check reads the loaded video and its time through `window.YT.get`, not the iframe `src`.
- A one-song video was seen looping back to 0 without reporting an end, so the end check starts from a stream with more than one song. The seek repeats once a second until the player is near the end.
- In the strict browser a play started from the bar does not count as a gesture inside the cross-origin player, so the first play needs the click inside the video.
