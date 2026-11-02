# Covers

A visitor watches Fiona's covers and original songs, moves through them in order, and finds one by searching the playlist.

## Sub-features

- `cover-list` shows videos with `kind` of `cover` or `original`, newest first.
- `cover-controls` moves with Next and Previous, and wraps at the ends.
- `cover-search` filters the playlist and selects a video.

## How to get to it (user POV)

- Choose `Cover` in the home menu.
- Open `/cover` directly.

## Driving it with drive.mjs

Preconditions:

- Doctor reports a non-zero cover count.

- **List.** Open `/cover`. Run `node drive.mjs cover`. The page shows `<count> Songs Loaded`, and the heading and iframe match the newest video.
- **Next.** The journey chooses the `Next` title. The heading shows the second video.
- **Previous.** The journey chooses `Previous` twice. The heading shows the last video.
- **Search.** The journey fills `Search covers...` with a real title and chooses the result. The heading shows that video.
- **Proof.** Open `cover.png` and `results.json` in the evidence folder.

## Gotchas

- The page renders the playlist twice, as a desktop sidebar and a mobile drawer. Both share one search field in the Model. The `mobile` journey covers the drawer.
- Shuffle is random, so its transitions are covered by `src/page/cover.story.test.ts`. The `coverPlayer` journey covers autoplay.
