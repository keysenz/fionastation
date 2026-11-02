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

Each sequence has up to 150 actions, or 52 to 80 consecutive plays to reach the history cap. It uses 12 distinct songs and the fixed seed `20261101`, with 1000 sequences per property.

| Property | Plain meaning |
| --- | --- |
| `queue-is-fifo-and-lossless` | Queue order is first-in, first-out, except that Previous returns the song it leaves to the front. Next and video end play the head. |
| `history-is-bounded-and-newest-first` | History never passes 50, and a replaced song becomes its newest entry. |
| `new-play-gets-a-new-player` | Each play and Previous gets a new `playId`, even for the same song, and toggling keeps it. |
| `end-of-video-continues-the-archive` | With an empty queue, a video end plays the archive's next song, and the last song pauses. |
| `reload-restores-queue-and-history` | Saving and restoring keeps the queue and history, and nothing plays. |

"Playing with no current song" is no longer a property, because the `NowPlaying` type cannot represent it.

## Reading a failure

A `FAIL` prints the shortened steps and the reason.

- **A real bug.** The steps are something the UI can do, and the outcome breaks the promise. Report or fix the code. Do not weaken the property.
- **A modeling error.** The steps are something the UI cannot do, so `apply()` is wrong, or the behavior changed on purpose. Update `apply()` or the property in the same change, and say why.
- **`MUTANT STALE`.** The module's text changed, so update `MUTANTS` to match. This is not a bug.

## Scope

**Covered.** The pure setlist transitions and the saved JSON format.

**Not covered.** The Commands and player events around them, which `src/page/karaoke/story.test.ts` and the `player` journey in the `verify` skill cover.
