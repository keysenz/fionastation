# Player

A visitor plays a video, and the page and the YouTube player stay in agreement.

## Sub-features

- `player-expand` keeps the same iframe across expand and collapse.
- `player-control` pauses the real video from the bar.
- `player-report` shows a play or pause started inside the player in the bar.
- `player-end` moves to the next song at video end, and replaces the iframe.
- `player-unavailable` skips a video YouTube refuses, with every song that shares it, and lands on the first later song of a public video. Only when nothing later is left does the bar pause and say so.
- `player-skip-toast` shows a toast saying why a different song started: `"<title>" isn't available on YouTube, so it was skipped.` Consecutive dead videos keep the first title and say `and <n> more aren't available`. It dismisses itself after 6 seconds or on the close button, and shows nothing when no skip happened.
- `cover-autoplay` moves to the next cover at video end when autoplay is on.

## How to get to it (user POV)

- Choose a song on `/karaoke`, or open `/cover`.

## Driving it with drive.mjs

Preconditions:

- The network reaches YouTube.

- **All.** Run `node drive.mjs player unavailable coverPlayer`. The journey asks YouTube's oEmbed endpoint which videos are public or private and drives the player through `window.YT.get`.
- **Proof.** Open `player-expanded.png` and `results.json` in the evidence folder.

- **Unavailable.** The journey chooses the first song of a private video that has a later public video. It expects the player to end on the first later song of a public video, with one player and no error in the bar. Later private videos skip on their own. It also expects the `status` toast to name the private song, to fit inside a 375px viewport with a 16px gutter, and to disappear within 15 seconds. `karaoke-skip-toast.png` holds the screenshot.

## Gotchas

- Headless Chromium can block autoplay, so the journey calls `playVideo` itself before it seeks.
- The end check starts from a song whose next row is also in a public video, because a private next row would skip on.
- The toast lasts 6 seconds, so the journey checks it before any slower step. A later private video turns the text plural.
- Several consecutive rows can share a title, so the end check waits for a new iframe and reads its `start=`.
