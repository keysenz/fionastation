---
name: radio-player
description: Exhaustive bounded check of the Fio Radio player loop, the real `update` in src/page/karaoke/karaoke.ts driven by every order of clicks, YouTube player events and Command results. Use when a change touches `update`, a Message or a Command in src/page/karaoke/karaoke.ts, or `PlayerEvent` or `videoEvents` in src/youtube.ts.
---

# Radio player check

**Promise.** The radio does what the visitor and the player last asked for. A late event from a replaced player never skips a song. Next and Previous move in the order the visitor expects, and a seek never reloads the video. A gone video never starts by itself, and no change to the queue is lost on reload. A load that failed is never treated as a gone stream, its retries end, and no play stays loading or moving on forever.

**Harm.** Songs get skipped or replayed, the radio jumps to another video when it should stay in the stream, a network blip removes a stream's songs from the queue, the bar shows a spinner that never ends, or the visitor's queue disappears. Each of these depends on the order in which async results arrive, which tests and manual clicking rarely reach.

**Tool.** `check.mjs` is an explicit-state explorer written in Node. It imports the real `update` from `karaoke.ts` and does not use a hand-written model. A state is the page `Model`, plus the Command results still on their way, plus what the YouTube player has done for the current play. From each state, it tries every message that the browser could deliver next and keeps every new state, breadth first. Every order of steps up to the depth bound is covered, and each counterexample is a shortest one. Seeded random walks then go past the bound. They sample, so a walk does not cover every order.

TLA+ is not used. A TLA+ model would check a copy of the logic, and this explorer runs the real code. The one liveness question, "does playback continue after a video ends", reduces to a one-step check on the real code (`ended-never-stalls`). A pick result that is on its way is always delivered in the end.

## Does your change touch this?

Run the check if you change any of these:

- `update`, `updateModel`, `withLoadTimeout`, `seekBeside`, `playheadOf`, `progressed`, `pickAnotherVideo`, `skipGoneVideo`, `failCurrentLoad`, `retryCurrentLoad`, `songOnBar`, `changeSetlist`, `recordFromPlayer`, `continuationOf`, `nowSingingOf`, or a Message or Command in `src/page/karaoke/karaoke.ts`.
- `PlayerEvent` or `videoEvents` in `src/youtube.ts`. These define which events the explorer may send. See "Updating".
- `Phase`, `intentOf`, `planAdvance`, `applyAdvance`, `planSkip`, `applySkip`, `play`, `playNext`, `playPrevious`, `failLoad`, `retryLoad`, `settleGone`, `loadRetryDelaySeconds`, the `report*` functions or `firstSongOfEachOtherLiveVideo` in `src/page/karaoke/setlist.ts`. Run the `karaoke-queue` skill for these too.
- `segmentAt` or `songBeside` in `src/lyrics.ts`.

## Run

Node 26.13 or later runs the TypeScript directly. The skill has no dependencies of its own. It loads `effect` and `foldkit` from the repo's `node_modules`, so run `npm install` at the repo root once per checkout.

```sh
cd .claude/skills/radio-player
node --disable-warning=ExperimentalWarning check.mjs            # every property, 60 to 70 s on 12 cores
node --disable-warning=ExperimentalWarning check.mjs --mutants  # proves that each property can fail, about 9 min
```

The run uses one worker thread for each autoplay and repeat setting.

- `--only <property>` checks one property.
- `--depth <n>` changes the bound. The default is 6, and each extra step costs about 5 times more time. The stale-timer case of `skip-toast-always-clears` needs exactly six steps, so a lower depth leaves it to the random walks. The fourth failed load, where the automatic retries stop, needs eight steps, so only the random walks reach it. The karaoke-queue check and a story test cover that stop directly.
- `--walks <n>` sets the number of random walks for each setting. The default is 300.

Exit code 0 means that every property passes, except any known findings listed below, which print `FINDING`. Exit code 1 means that a property failed. `--mutants` exits with 0 only when every mutant is caught.

## Bounds and assumptions

- **Archive.** The archive has five videos, in the order that the server sends them (`server/db.ts`).
  - `stream`: three songs, `s1` at 1:00, `s2` at 3:00 and `s3` at 5:00.
  - `single` (`solo`) and `duet`: one song each, at 0:30.
  - `gone`: the server already reports it gone (`lost`).
- **Settings.** Autoplay is on or off, and repeat is Off, All or One. Each combination is its own root, and no step changes it.
- **Visitor.** The visitor can click any song that is not gone, add a song to the queue only while the queue is empty (Previous can still make the queue longer), play or remove queue slot 0, and use Next, Previous and toast dismiss. The middle button follows the phase as `view.ts` draws it: Play/Pause for a live play (`Loading`, `Playing`, `Paused`), Retry for `LoadFailed`, and nothing to click for `MovingOn` and `Gone`. Gone songs are disabled in `view.ts`, so they cannot be clicked.
- **Player.** Events for the current play arrive in the order that `loadedVideoEvents` in `src/youtube.ts` emits them:
  - `Ready` comes first. `VideoGone` and `LoadFailed` can come before it.
  - After `Ready`, the player can send `Playing`, `Paused`, `VideoGone`, `LoadFailed` and `Progressed` at any time.
  - An error does not stop the events. The listener and its tick keep running, so a play that failed or is gone can still get every event above. This is more than a real player sends, and `update` must ignore it.
  - `Progressed` reports one of these seconds. For `stream`: 0, 60, 120, 180, 240, 300 and 360, which are each song's start, a point inside each song, and a point before the first song. For the single-song videos: 30 and 90.
  - `Ended` arrives only after the playhead has passed the start of the video's last song, because YouTube ends a video at its end.
- **Replaced players.** A replaced player can deliver any event at any time. `update` only checks whether a playId equals the current one, so one older playId stands for all older playIds.
- **Command results.**
  - `PickRandomVideo` stays pending with the candidates it was issued with, and the explorer tries each candidate as the result. Several picks can be pending at once.
  - `WaitBeforeDismissToast` stays pending until it is delivered.
  - `WaitBeforeRetryLoad` and `WaitBeforeLoadTimeout` stay pending until they are delivered, at any time. Of the timers that belong to older plays, the explorer keeps only the newest of each kind, because `update` compares a timer's playId only with the current one.
  - The explorer keeps its own count of the loads of the song on the bar since it last played. A retry adds one, and any other new play or a `Playing` report starts it at 1. The expected waits come from this count, not from the model's `attempt`.
  - Every other Command's result message returns the model unchanged in `update`, so it is not delivered.
  - A refetch (`SucceededFetchSongs`) that newly reports `single` as gone can arrive while a pick is pending.
- **Left out.** Lyrics, volume, layers, search and queue drags are not in the state, and the explorer sends none of their messages. No setlist branch reads them.
- **Depth 6, measured at 2c2f783.** About 2.5 million distinct states and 8.4 million steps in 60 to 70 s, then 72,000 random-walk steps of 40 actions each.

## What it checks

| Property | Plain meaning |
| --- | --- |
| `stale-results-never-act` | A player event, random pick, retry timer or load timeout for a play that is no longer current changes nothing and sends nothing. |
| `next-plays-queue-then-stream-then-other-video` | With a known playhead inside a song, Next does one of three things. With songs queued, it plays the queue head. With an empty queue, it sends `SeekPlayer` to the next song of the same video, with the same play, queue and history. With no later song in the video, it asks for one `PickRandomVideo` for the current play, among the first songs of the other live videos in archive order. A play that is not live (its load failed or its stream is gone) never seeks, so Next goes to the queue or another video. |
| `previous-seeks-in-stream-then-history` | With a known playhead inside a song, Previous seeks to the song before it in the same video. On the video's first song, or when the play is not live, it plays the newest history song and puts the current song at the front of the queue, unless its stream is gone. A song whose load failed is put there like any other. With no history, it does nothing. |
| `next-and-previous-with-unknown-playhead` | Before the first `Progressed`, Next and Previous move within the stream from the start of the clicked song, where the play began. With the playhead before the first song, Next seeks to the first song. |
| `seek-never-reloads` | Every `SeekPlayer` keeps the playId and song, so the `nowPlayingVideo` subscription does not reload the video. The model's playhead is the seek target, and `nowSingingOf` names the song at that point. |
| `gone-video-never-auto-starts` | A `PickRandomVideo` never offers the current video or a gone video, which includes one that failed this session. An archive advance never starts a gone video. A song from the queue and a repeat replay are excluded, because they play whatever the visitor chose. |
| `gone-video-leaves-queue-and-history` | After YouTube reports a video gone, none of its songs is left in the queue or history, and leaving its song later does not put it back. `planSkip` marks the play `Gone`, and `play`, `playNext` and `playPrevious` never record a gone play. |
| `pick-rechecks-gone-at-delivery` | A random pick that arrives after its video became known gone does not start that video. It draws again among the videos still live, or stops when none is left. |
| `player-reports-never-echo` | `Playing`, `Paused`, `Progressed` and `LoadFailed` send no `ApplyPlayback` back. `Ready` sends only a pause, and only for a live play the visitor paused. |
| `play-pause-reaches-the-player` | Play/Pause on a live play flips what the visitor wants and sends `ApplyPlayback` with the new state. |
| `end-of-stream-does-not-replay-it` | When a video ends with nothing queued and repeat Off, the radio does not start that video again. |
| `ended-never-stalls` | After the video of a live play ends, a new play starts or a pick for the current play is pending. The radio pauses only when nothing may follow: repeat Off, nothing queued, and autoplay off or no other live video. |
| `skip-toast-always-clears` | Every skip toast starts its own dismiss timer, and an older timer never hides a newer toast. Two toasts can share a `dismissId`, so the explorer tracks which timer is the newest. |
| `load-failure-never-marks-a-stream-gone` | A `LoadFailed` report or a load timeout keeps the play and its song, marks no video gone, leaves the queue, history and toast alone, and asks for no other video. It puts a live play in `LoadFailed`. A timeout changes only a play that is still `Loading`. |
| `retry-reloads-the-song-on-the-bar` | A retry of a failed load, by its timer, the Retry button or a click on the song's row, starts a new play of the song the bar names, in `Loading`, with `attempt` one higher, its own load timeout, and the same queue and history. A retry timer for a play that is no longer failed changes nothing. |
| `manual-retry-never-shortens-the-next-automatic-wait` | A failed load waits 2, 4, then 8 seconds, by the explorer's count of loads since the song last played, and the fourth and later failures wait for nothing. Nothing but a failed load starts a wait. So a manual Retry counts as an attempt, never restarts the schedule, and a load that gets ready and fails again still runs out of retries. |
| `moving-on-always-resolves` | A play in `MovingOn` always has a random pick for it on the way. A gone play (`MovingOn` or `Gone`) never becomes live again under the same playId. |
| `loading-always-ends` | A play in `Loading` always has its load timeout on the way, and that timeout puts it in `LoadFailed`. |
| `failed-play-ignores-player-reports` | A gone play ignores every report of its player. A failed load ignores every report but `VideoGone` and `Playing`: no setlist change, no playhead move, no gone video, no toast and no Command. |
| `setlist-change-is-saved` | Every change to the queue or history sends `SaveSetlist` with exactly the new queue and history. |

The expected values come from the fixture alone: songs sorted by seconds and filtered by video. They never come from the module's own helpers.

## Known findings

None. `KNOWN_FINDINGS` in `check.mjs` lists a property that the current code is known to break. The run prints it as `FINDING` and does not fail because of it. When a fix makes it pass, the run prints `PASS ... remove it from KNOWN_FINDINGS`, so remove the name.

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
- How long the timers wait in real time. The explorer delivers a timer at any point, so it does not show that 20 seconds is long enough for a slow load.
- Whether a retry really reloads the video and the YouTube script. `src/youtube.test.ts` and the `loadRetry` journey of the `verify` skill cover that.

## Coverage record

The check was last confirmed to describe the code at commit `2c2f7834ae29b7442d6b3472f2ab523e60121ee1`. It covers these files and functions:

- `src/page/karaoke/karaoke.ts`: `update`, `updateModel` (every setlist and player branch), `seekBeside`, `playheadOf`, `progressed`, `nowSingingOf`, `pickAnotherVideo`, `skipGoneVideo`, `failCurrentLoad`, `retryCurrentLoad`, `songOnBar`, `withLoadTimeout`, `continuationOf`, `changeSetlist`, `recordFromPlayer`, `withSkipToast`, and the Commands `PickRandomVideo`, `SeekPlayer`, `ApplyPlayback`, `SaveSetlist`, `WaitBeforeDismissToast`, `WaitBeforeRetryLoad` and `WaitBeforeLoadTimeout`.
- `src/page/karaoke/setlist.ts`: `Phase`, `intentOf`, `play`, `playNext`, `playPrevious`, `playFromQueue`, `togglePlaying`, `pause`, `reportReady`, `reportPlaying`, `reportPaused`, `failLoad`, `retryLoad`, `settleGone`, `loadRetryDelaySeconds`, `planAdvance`, `applyAdvance`, `planSkip`, `applySkip` and `firstSongOfEachOtherLiveVideo`.
- `src/lyrics.ts`: `segmentAt` and `songBeside`.
- `src/youtube.ts`: `PlayerEvent`, and `loadedVideoEvents` for the order of events.

To find changes since then, run `git log 2c2f7834ae29b7442d6b3472f2ab523e60121ee1..HEAD -- src/page/karaoke/karaoke.ts src/page/karaoke/setlist.ts src/lyrics.ts src/youtube.ts`. Move this commit forward only after you have read those changes, confirmed that `transitions()` and the properties still describe the code, and run both commands. The `/maintain-formal-verification-skill` skill does this pass.
