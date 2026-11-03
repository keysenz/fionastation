---
name: karaoke-queue
description: Property check of the karaoke queue, history, end-of-video behavior, and reload rules in src/page/karaoke/setlist.ts. Use when a change touches that module or its saved format.
---

# Karaoke queue check

**Promise.** A song someone queues plays in the order it was queued, and a reload restores the queue and history.

**Harm.** A visitor's setlist silently loses songs, plays out of order, or disappears on reload. Tests rarely reach this, because it depends on long, mixed sequences of actions.

**Tool.** No practical verifier runs on this TypeScript, so `check.mjs` runs the real pure functions against generated action sequences with [fast-check](https://fast-check.dev). This is strong testing of the real code, not a proof.

## Does your change touch this?

Run the check if you change `src/page/karaoke/setlist.ts`.

## Run

Once per checkout, run `(cd .claude/skills/karaoke-queue && npm install)`. Node 26.13 or later is required, because it runs the module's TypeScript directly.

```sh
cd .claude/skills/karaoke-queue
node --disable-warning=ExperimentalWarning check.mjs            # the properties, a few seconds
node --disable-warning=ExperimentalWarning check.mjs --mutants  # proves that each property can fail
```

Exit code 0 means every property holds.

## What it checks

Each sequence has up to 150 actions, or 52 to 80 consecutive plays to reach the history cap. It uses 12 distinct songs, 4 to each of 3 videos in archive order. Each run also draws which of the 3 videos are known gone and whether autoplay is on, and passes them to the module as its `Continuation`. Each action also carries a number that stands in for the random video pick, so a run resolves `PickRandomVideo` the way the Command does, with a deterministic choice. The seed is fixed at `20261101`, with 1000 runs per property.

| Property | Plain meaning |
| --- | --- |
| `queue-is-fifo-and-lossless` | Queue order is first-in, first-out, except that Previous returns the song it leaves to the front. Next and video end play the head. |
| `history-is-bounded-and-newest-first` | History never passes 50, and a song replaced by a click or a video end becomes its newest entry. |
| `new-play-gets-a-new-player` | Each play and Previous gets a new `playId`, even for the same song, and toggling keeps it. |
| `end-of-video-continues-within-the-video` | With autoplay on and an empty queue, a video end plays the next song of the same video, with no random pick. |
| `end-of-video-picks-another-video-or-pauses` | With no song left in the video, a video end offers the first song of every other live video, and pauses the same song when there is none. |
| `random-pick-lands-on-another-live-video-first-song` | A random pick, from a video end or a failed video, lands on the first song of a video that is not the current one and not gone, among all such videos. |
| `autoplay-off-never-starts-an-archive-song` | With autoplay off and nothing queued, a video end or a failed video never asks for a random video, and keeps the same song, paused. A failure says why. |
| `queue-plays-whatever-autoplay-says` | A video end or a failed video plays the queue head, with autoplay on or off. |
| `archive-advance-skips-gone-videos` | An archive advance, within a video or by random pick, never lands on a video known to be gone. |
| `unavailable-video-is-skipped` | A video that fails leaves no song of it in the queue or history. Playback moves to the queue head or, with autoplay on, the first song of a random other live video, without recording the failed song in history. It pauses with the reason if there is none. |
| `reload-restores-queue-and-history` | Saving and restoring keeps the queue and history, and nothing plays. |

"Playing with no current song" is no longer a property, because the `NowPlaying` type cannot represent it.

## Reading a failure

A `FAIL` prints the shortened steps and the reason.

- **A real bug.** The steps are something the UI can do, and the outcome breaks the promise. Report or fix the code. Do not weaken the property.
- **A modeling error.** The steps are something the UI cannot do, so `apply()` is wrong, or the behavior changed on purpose. Update `apply()` or the property in the same change, and say why.
- **`MUTANT STALE`.** The module's text changed, so update `MUTANTS` to match. This is not a bug.

## Scope

**Covered.** The pure setlist transitions and the saved JSON format.

**Not covered.** The randomness itself, which the `PickRandomVideo` Command draws with Effect `Random`. The Commands and player events around them, which `src/page/karaoke/story.test.ts` and the `player` journey in the `verify` skill cover.
