# Player

A visitor plays a video, and the page and the YouTube player stay in agreement.

## Sub-features

- `player-expand` keeps the same iframe across expand and collapse.
- `player-control` pauses the real video from the bar.
- `player-report` shows a play or pause started inside the player in the bar.
- `player-end` moves to the next song of the same video at video end, and replaces the iframe. At the last song of a video it picks a random other live video and plays its first song. With autoplay off it pauses the same song.
- `player-unavailable` skips a video YouTube refuses, with every song that shares it, and lands on the first song of a random other live video. With autoplay off, or when nothing later is left, the same song stays paused and the bar says `This stream is gone`, with no toast.
- `player-autoplay` is a switch in the bar (role `switch`, name `Autoplay`), on by default and saved in `localStorage` under `karaoke-autoplay`. Off, a video end with an empty queue keeps the same song, paused, and a failed video stays on it. The queue still plays either way.
- `player-skip-toast` shows a toast saying why a different song started: `"<title>" was skipped because its stream is gone.` Consecutive dead videos keep the first title and say `and <n> more their streams are gone`. It dismisses itself after 6 seconds or on the close button, and shows nothing when no skip happened.
- `cover-autoplay` moves to the next cover at video end when autoplay is on.

## How to get to it (user POV)

- Choose a song on `/karaoke`, or open `/cover`.

## Driving it with drive.mjs

Preconditions:

- The network reaches YouTube.

- **All.** Run `node drive.mjs player unavailable coverPlayer`. The journey reads `is_gone` from the API to tell live videos from gone ones and drives the player through `window.YT.get`.
- **Autoplay.** The `player` journey expects the switch on by default and inside a 375px bar with a touch target of at least 40px. It also starts the last song of a live video, seeks near the end, and expects a new player on the first song (`start=` its timestamp) of a different live video. Then it turns the switch off, seeks near the end, and expects the same song, paused, in the same iframe. After a reload `karaoke-autoplay` is `false` and the switch is off. A page with blocked storage still renders with the switch on.
- **Proof.** Open `player-expanded.png` and `results.json` in the evidence folder.

- **Unavailable.** A gone row cannot be played. The journey seeds `karaoke-storage` with a queue whose head is a gone song, plays a live song, and presses Next. It expects the player to land on the first song of a random other live video, with one player and no error in the bar. It also expects the `status` toast to name the gone song, to fit inside a 375px viewport with a 16px gutter, and to disappear within 15 seconds. `karaoke-skip-toast.png` holds the screenshot.

## Gotchas

- Headless Chromium can block autoplay, so the journey calls `playVideo` itself before it seeks.
- The same-video end check starts from a song that is not the last of its video, because the last one picks a random video. The random check can land on any other live video, so it accepts any live first song.
- The toast lasts 6 seconds, so the journey checks it before any slower step. A later private video turns the text plural.
- Several consecutive rows can share a title, so the end check waits for a new iframe and reads its `start=`.
