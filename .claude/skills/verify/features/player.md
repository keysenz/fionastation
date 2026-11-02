# Player

A visitor plays a video, and the page and the YouTube player stay in agreement.

## Sub-features

- `player-expand` keeps the same iframe across expand and collapse.
- `player-control` pauses the real video from the bar.
- `player-report` shows a play or pause started inside the player in the bar.
- `player-end` moves to the next song at video end, and replaces the iframe.
- `player-unavailable` says so in the bar when YouTube refuses a video.
- `cover-autoplay` moves to the next cover at video end when autoplay is on.

## How to get to it (user POV)

- Choose a song on `/karaoke`, or open `/cover`.

## Driving it with drive.mjs

Preconditions:

- The network reaches YouTube.

- **All.** Run `node drive.mjs player unavailable coverPlayer`. The journey asks YouTube's oEmbed endpoint for a public video and drives the player through `window.YT.get`.
- **Proof.** Open `player-expanded.png` and `results.json` in the evidence folder.

## Gotchas

- Headless Chromium can block autoplay, so the journey calls `playVideo` itself before it seeks.
- Several consecutive rows can share a title, so the end check waits for a new iframe and reads its `start=`.
