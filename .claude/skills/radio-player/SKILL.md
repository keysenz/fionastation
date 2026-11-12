---
name: radio-player
description: Exhaustive bounded check of the Fio Radio player loop, the real `update` in src/page/karaoke/karaoke.ts driven by every order of clicks, YouTube player events and Command results. Use when a change touches `update`, a Message or a Command in src/page/karaoke/karaoke.ts, or `PlayerEvent` or `videoEvents` in src/youtube.ts.
---

# Radio player check

**Promise.** The radio does what the visitor and the player last asked for. A late event from a replaced player never skips a song. Next and Previous move in the order the visitor expects, and a seek never reloads the video. A gone video never starts by itself, and no change to the queue is lost on reload.

**Harm.** Songs get skipped or replayed, the radio jumps to another video when it should stay in the stream, or the visitor's queue disappears. Each of these depends on the order in which async results arrive, which tests and manual clicking rarely reach.

**Tool.** `check.mjs` is an explicit-state explorer written in Node. It imports the real `update` from `karaoke.ts` and does not use a hand-written model. A state is the page `Model`, plus the Command results still on their way, plus what the YouTube player has done for the current play. From each state, it tries every message that the browser could deliver next and keeps every new state, breadth first. Every order of steps up to the depth bound is covered, and each counterexample is a shortest one. Seeded random walks then go past the bound. They sample, so a walk does not cover every order.

TLA+ is not used. A TLA+ model would check a copy of the logic, and this explorer runs the real code. The one liveness question, "does playback continue after a video ends", reduces to a one-step check on the real code (`ended-never-stalls`). A pick result that is on its way is always delivered in the end.

## Does your change touch this?

Run the check if you change any of these:

- `update`, `updateModel`, `seekBeside`, `progressed`, `pickAnotherVideo`, `changeSetlist`, `recordFromPlayer`, `continuationOf`, `nowSingingOf`, or a Message or Command in `src/page/karaoke/karaoke.ts`.
- `PlayerEvent` or `videoEvents` in `src/youtube.ts`. These define which events the explorer may send. See "Updating".
- `planAdvance`, `applyAdvance`, `planSkip`, `applySkip`, `playPicked`, `playNext`, `playPrevious` or `firstSongOfEachOtherLiveVideo` in `src/page/karaoke/setlist.ts`. Run the `karaoke-queue` skill for these too.
- `segmentAt` or `segmentSongBeside` in `src/lyrics.ts`.

## Run

Node 26.13 or later runs the TypeScript directly. The skill has no dependencies of its own. It loads `effect` and `foldkit` from the repo's `node_modules`, so run `npm install` at the repo root once per checkout.

```sh
cd .claude/skills/radio-player
node --disable-warning=ExperimentalWarning check.mjs            # every property, 40 to 60 s on 12 cores
node --disable-warning=ExperimentalWarning check.mjs --mutants  # proves that each property can fail, about 5 min
```

The run uses one worker thread for each autoplay and repeat setting.

- `--only <property>` checks one property.
- `--depth <n>` changes the bound. The default is 6, and each extra step costs about 5 times more time. The stale-timer case of `skip-toast-always-clears` needs exactly six steps, so a lower depth leaves it to the random walks.
- `--walks <n>` sets the number of random walks for each setting. The default is 300.

Exit code 0 means that every property passes, except the known findings below, which print `FINDING`. Exit code 1 means that a property failed. `--mutants` exits with 0 only when every mutant is caught.

## Bounds and assumptions

- **Archive.** The archive has five videos, in the order that the server sends them (`server/db.ts`).
  - `stream`: three songs, `s1` at 1:00, `s2` at 3:00 and `s3` at 5:00.
  - `single` (`solo`) and `duet`: one song each, at 0:30.
  - `gone`: the server already reports it gone (`lost`).
- **Settings.** Autoplay is on or off, and repeat is Off, All or One. Each combination is its own root, and no step changes it.
- **Visitor.** The visitor can click any song that is not gone, add a song to the queue only while the queue is empty (Previous can still make the queue longer), play or remove queue slot 0, and use Play/Pause, Next, Previous and toast dismiss. Gone songs are disabled in `view.ts`, so they cannot be clicked.
- **Player.** Events for the current play arrive in the order that `loadedVideoEvents` in `src/youtube.ts` emits them:
  - `Ready` comes first. `VideoFailed` can come before it, and `PlayerFailed` is the only event of a player that never loaded.
  - After `Ready`, the player can send `Playing`, `Paused`, `VideoFailed` and `Progressed` at any time.
  - `Progressed` reports one of these seconds. For `stream`: 0, 60, 120, 180, 240, 300 and 360, which are each song's start, a point inside each song, and a point before the first song. For the single-song videos: 30 and 90.
  - `Ended` arrives only after the playhead has passed the start of the video's last song, because YouTube ends a video at its end.
- **Replaced players.** A replaced player can deliver any event at any time. `update` only checks whether a playId equals the current one, so one older playId stands for all older playIds.
- **Command results.**
  - `PickRandomVideo` stays pending with the candidates it was issued with, and the explorer tries each candidate as the result. Several picks can be pending at once.
  - `WaitBeforeDismissToast` stays pending until it is delivered.
  - Every other Command's result message returns the model unchanged in `update`, so it is not delivered.
  - A refetch (`SucceededFetchSongs`) that newly reports `single` as gone can arrive while a pick is pending.
- **Left out.** Lyrics, volume, layers, search and queue drags are not in the state, and the explorer sends none of their messages. No setlist branch reads them.
- **Depth 6, measured at 36bbeed.** About 1.1 million distinct states and 3.8 million steps in 40 to 60 s, then 72,000 random-walk steps of 40 actions each.

## What it checks

| Property | Plain meaning |
| --- | --- |
| `stale-results-never-act` | A player event or random pick for a play that is no longer current changes nothing and sends nothing. |
| `next-plays-queue-then-stream-then-other-video` | With a known playhead inside a song, Next does one of three things. With songs queued, it plays the queue head. With an empty queue, it sends `SeekPlayer` to the next song of the same video, with the same play, queue and history. With no later song in the video, it asks for one `PickRandomVideo` for the current play, among the first songs of the other live videos in archive order. |
| `previous-seeks-in-stream-then-history` | With a known playhead inside a song, Previous seeks to the song before it in the same video. On the video's first song, it plays the newest history song and puts the current song at the front of the queue. With no history, it does nothing. |
| `next-and-previous-with-unknown-playhead` | Before the first `Progressed`, or with the playhead before the first song, Next and Previous still move within the stream from the song on the bar. |
| `seek-never-reloads` | Every `SeekPlayer` keeps the playId and song, so the `nowPlayingVideo` subscription does not reload the video. The model's playhead is the seek target, and `nowSingingOf` names the song at that point. |
| `gone-video-never-auto-starts` | A `PickRandomVideo` never offers the current video or a gone video, which includes one that failed this session. An archive advance never starts a gone video. A song from the queue and a repeat replay are excluded, because they play whatever the visitor chose. |
| `failed-video-leaves-queue-and-history` | After a video fails, none of its songs is left in the queue or history. This is the promise of `planSkip` and `applySkip`. |
| `pick-rechecks-gone-at-delivery` | A random pick that arrives after its video became known gone does not start that video. |
| `player-reports-never-echo` | `Playing`, `Paused`, `Progressed` and `PlayerFailed` send no `ApplyPlayback` back. `Ready` sends only a pause, and only for a paused play. |
| `play-pause-reaches-the-player` | Play/Pause flips the status and sends `ApplyPlayback` with the new state. |
| `end-of-stream-does-not-replay-it` | When a video ends with nothing queued and repeat Off, the radio does not start that video again. |
| `ended-never-stalls` | After the current video ends, a new play starts or a pick for the current play is pending. The radio pauses only when nothing may follow: repeat Off, nothing queued, and autoplay off or no other live video. |
| `skip-toast-always-clears` | Every skip toast starts its own dismiss timer, and an older timer never hides a newer toast. Two toasts can share a `dismissId`, so the explorer tracks which timer is the newest. |
| `setlist-change-is-saved` | Every change to the queue or history sends `SaveSetlist` with exactly the new queue and history. |

The expected values come from the fixture alone: songs sorted by seconds and filtered by video. They never come from the module's own helpers.

## Known findings at 36bbeed

These four properties fail on the current code. The run prints them as `FINDING` and does not fail because of them. Each trace is the explorer's shortest one.

1. **`end-of-stream-does-not-replay-it`: the end of a stream replays the stream.** With autoplay on and repeat Off, the steps are `ClickedSong(s1)`, `Ready`, `Progressed 300s`, `Ended`, and the radio then starts `s2` of the same stream. `Ended` plans from `nowPlaying.song`, the song that was clicked, through `planAdvance` and `nextSongInVideo`, and ignores the song at the playhead. A stream of n songs that is clicked on its first song plays to its end, then from song 2 to the end, then from song 3, and so on. The code does what its own checks expect here. The story test "the next song of the same video plays at the end, with no random pick" in `story.test.ts` and the `karaoke-queue` property `end-of-video-continues-within-the-video` both require the next song of the video. Those checks give every song the same timestamp, or check `planAdvance` without a playhead. They were written before the player bar followed the playhead (commit 96e6a1a). The owner decides which intent wins. If the current behavior is intended, delete this property and its `KNOWN_FINDINGS` entry.
2. **`next-and-previous-with-unknown-playhead`: Next leaves the stream before the first progress report.** The steps are `ClickedSong(s1)` and then `ClickedNext`. Next asks for a random other video and does not seek to `s2`, because `seekBeside` needs `nowSingingOf`, which needs a playhead. The same happens when the playhead is before the first song, and Previous then goes to history and does not seek. The window is short: the time until the first `Progressed`, or an intro before the first song.
3. **`failed-video-leaves-queue-and-history`: a failed song comes back into history or the queue.** With autoplay off, `VideoFailed` leaves the dead `s1` on the bar, paused with the reason, and no pick is pending. The visitor then clicks `solo`, and `s1` is in history. Previous then plays `s1` again. The explorer's shortest trace is the same three steps with autoplay on. `play()` records the dead current song. `playPrevious` puts it at the front of the queue in the same way. Previous or the queue can then try the dead video again, and that failure is shown as one more skip.
4. **`pick-rechecks-gone-at-delivery`: a pick can start a video that a refetch just reported gone.** The steps are `ClickedSong(s1)`, `ClickedNext`, a refetch that reports `single` gone, and then `CompletedPickRandomVideo(solo)`. In practice the window is tiny, because `Random.choice` resolves almost at once.

When a fix makes one of these pass, the run prints `PASS ... remove it from KNOWN_FINDINGS`. Remove the name from `KNOWN_FINDINGS` in `check.mjs`, and remove the entry from this list.

## Reading a failure

A `FAIL` prints the property's promise, the steps in message names (`ClickedSong(s1) -> ReceivedPlayerEvent(playId 1, Ended) -> ...`) and the reason.

- **A real bug.** The visitor, the player or a Command can produce those steps, and the outcome breaks the promise. Report the bug or fix the code. Do not weaken the property.
- **A modeling error.** The steps contain something that cannot happen, for example an event that `loadedVideoEvents` never emits in that order. Fix `transitions()` in the same change and say why. Another cause is a change in behavior on purpose: update the property and its row in the table, and say so.
- **`MUTANT STALE`.** A mutant's text is no longer in its file, so update `MUTANTS`. This is not a bug.
- **`MISSED`.** A property no longer detects the break that it guards. Fix the property or the bound before you trust a pass.

## Updating

- **A new Message or Command that changes the setlist.** Add it to `transitions()`. If its result message changes the model, add it to `pending` in `step()` as well.
- **A change to `PlayerEvent` or the order of events in `loadedVideoEvents`.** Update the player part of `transitions()` to match.
- **A new promise.** Add a property, add at least one mutant of the real code that breaks it, and confirm that `--mutants` catches the mutant.

## Scope

**Covered.**

- The real `update` and the setlist, segment and continuation functions that it calls.
- Every order of the steps above, up to depth 6, for each of the six settings.
- Random walks of 40 steps past that bound.

**Not covered.**

- The YouTube iframe itself, and whether the `nowPlayingVideo` subscription and `videoEvents` keep their own promises. The explorer assumes the event orders listed under "Bounds and assumptions". The `player` journey of the `verify` skill drives the real player.
- Queues of more than one song added by the visitor, and long histories past the bound. The `karaoke-queue` skill checks these on the pure functions.
- Lyrics fetches and retries, volume, layers, URL sync, drags and loading saved data.
- Autoplay or repeat changes during a run, and archives with other shapes, such as a stream whose song timestamps are out of order.
- A visitor's seek that lands while a pick for the same play is pending. A late pick result then still replaces the song, but in practice the window is tiny.

## Coverage record

The check was last confirmed to describe the code at commit `36bbeed283a24211d89f18a2bc739bd7c54bc651`. It covers these files and functions:

- `src/page/karaoke/karaoke.ts`: `update`, `updateModel` (every setlist and player branch), `seekBeside`, `progressed`, `nowSingingOf`, `pickAnotherVideo`, `continuationOf`, `changeSetlist`, `recordFromPlayer`, `withSkipToast`, and the Commands `PickRandomVideo`, `SeekPlayer`, `ApplyPlayback`, `SaveSetlist` and `WaitBeforeDismissToast`.
- `src/page/karaoke/setlist.ts`: `play`, `playNext`, `playPrevious`, `playFromQueue`, `planAdvance`, `applyAdvance`, `planSkip`, `applySkip`, `playPicked` and `firstSongOfEachOtherLiveVideo`.
- `src/lyrics.ts`: `segmentAt` and `segmentSongBeside`.
- `src/youtube.ts`: `PlayerEvent`, and `loadedVideoEvents` for the order of events.

To find changes since then, run `git log 36bbeed283a24211d89f18a2bc739bd7c54bc651..HEAD -- src/page/karaoke/karaoke.ts src/page/karaoke/setlist.ts src/lyrics.ts src/youtube.ts`. Move this commit forward only after you have read those changes, confirmed that `transitions()` and the properties still describe the code, and run both commands. The `/maintain-formal-verification-skill` skill does this pass.
