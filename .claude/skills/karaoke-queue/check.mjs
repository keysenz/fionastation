#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DateTime, Option } from 'effect';
import fc from 'fast-check';

const here = dirname(fileURLToPath(import.meta.url));
const realModule = join(here, '../../../src/page/karaoke/setlist.ts');
const domainUrl = pathToFileURL(join(here, '../../../src/domain.ts')).href;
const youtubeUrl = pathToFileURL(join(here, '../../../src/youtube.ts')).href;
const playlistUrl = pathToFileURL(join(here, '../../../src/playlist.ts')).href;
const modulePath = process.env.KARAOKE_SETLIST ?? realModule;
const RUNS = Number(process.env.RUNS ?? 1000);

const S = await import(pathToFileURL(modulePath).href);

const makeSong = (n) => ({
  id: `song-${n}`, song_title: `Song ${n}`, artist: '', original_title: '', version: '', note: '', timestamp: '00:00:01', created_at: 'x', video_url: `v${Math.ceil(n / 4)}`, title_text: 'Stream', membership: false, published_at: DateTime.makeUnsafe(0), kind: ['karaoke', 'cover', 'original'][Math.ceil(n / 4) % 3],
});
const archive = Array.from({ length: 12 }, (_, i) => makeSong(i + 1));
const song = fc.integer({ min: 1, max: 12 }).map(makeSong);

// Each action also draws a number, which stands in for the random video pick when one is needed.
const withPick = (base) => fc.record({ base, pick: fc.nat(1000) }).map(({ base: b, pick }) => ({ ...b, pick }));
const action = withPick(fc.oneof(
  { weight: 5, arbitrary: song.map((s) => ({ type: 'play', song: s })) },
  { weight: 4, arbitrary: song.map((s) => ({ type: 'enqueue', song: s })) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('move'), from: fc.nat(4), to: fc.nat(4) }) },
  { weight: 3, arbitrary: fc.constant({ type: 'next' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'previous' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'end' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'toggle' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'fail' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'loadFail' }) },
  { weight: 2, arbitrary: fc.constantFrom('Visitor', 'Timer').map((by) => ({ type: 'retry', by })) },
));
const moveOrEnqueue = fc.oneof(
  { weight: 2, arbitrary: withPick(song.map((s) => ({ type: 'enqueue', song: s }))) },
  { weight: 3, arbitrary: withPick(fc.record({ type: fc.constant('move'), from: fc.nat(4), to: fc.nat(4) })) },
);
// What can happen to one play: it ends, pauses, goes, fails to load and is retried, with few songs queued.
const playerEvent = withPick(fc.oneof(
  { weight: 3, arbitrary: fc.constant({ type: 'end' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'toggle' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'fail' }) },
  { weight: 3, arbitrary: fc.constant({ type: 'loadFail' }) },
  { weight: 3, arbitrary: fc.constantFrom('Visitor', 'Timer').map((by) => ({ type: 'retry', by })) },
  { weight: 2, arbitrary: fc.constant({ type: 'next' }) },
  { weight: 1, arbitrary: fc.constant({ type: 'previous' }) },
  { weight: 1, arbitrary: song.map((s) => ({ type: 'enqueue', song: s })) },
  { weight: 2, arbitrary: song.map((s) => ({ type: 'play', song: s })) },
));
// The second shape plays enough songs in a row to reach the history cap, and the third queues and moves
// songs, because mixed sequences rarely hold more than two queued songs at once. The fourth starts a
// song and then stays close to it, because a long mixed sequence rarely ends, fails or retries a play
// while the queue is still empty.
const actionSequence = fc.oneof(
  fc.array(action, { minLength: 1, maxLength: 150 }),
  fc.array(withPick(song.map((s) => ({ type: 'play', song: s }))), { minLength: 52, maxLength: 80 }),
  fc.array(moveOrEnqueue, { minLength: 4, maxLength: 30 }),
  fc.tuple(withPick(song.map((s) => ({ type: 'play', song: s }))), fc.array(playerEvent, { minLength: 1, maxLength: 12 })).map(([first, rest]) => [first, ...rest]),
);
// Each run also draws which of the 3 videos are known gone and whether autoplay is on.
const scenario = fc.record({
  seq: actionSequence,
  goneVideos: fc.subarray(['v1', 'v2', 'v3']),
  isAutoplay: fc.boolean(),
  repeat: fc.constantFrom('Off', 'All', 'One'),
});

const current = (setlist) => Option.getOrUndefined(setlist.maybeNowPlaying);

const intentOf = (now) => Option.getOrUndefined(S.intentOf(now.phase));

// Only what the UI can do: the player bar's previous, toggle and next exist once a song is current,
// and only a current song's video can end or fail. The page ignores an end from a play that cannot
// sound, and a second gone report from a play already gone, so they change nothing here either.
// A video end or a gone video that needs a random video resolves it like the Command does, here by
// choosing the candidate the action's number points at. It returns the candidates it chose from, or
// undefined when no pick happened, and for a gone video the setlist as it waited for that pick.
function apply(setlist, a, continuation) {
  if (a.type === 'play') return { setlist: S.play(setlist, a.song) };
  if (a.type === 'enqueue') return { setlist: S.enqueue(setlist, a.song) };
  if (a.type === 'move') return { setlist: S.moveInQueue(setlist, a.from, a.to) };
  if (!current(setlist)) return { setlist };
  if (a.type === 'next') return { setlist: S.playNext(setlist, continuation.repeat) };
  if (a.type === 'previous') return { setlist: S.playPrevious(setlist) };
  if (a.type === 'loadFail') return { setlist: S.failLoad(setlist, 'VideoUnplayable') };
  if (a.type === 'retry') return { setlist: S.retryLoad(setlist, current(setlist).song, a.by) };
  if (a.type === 'end') {
    if (intentOf(current(setlist)) === undefined) return { setlist };
    const advance = S.planAdvance(setlist, continuation);
    const applied = S.applyAdvance(setlist, advance, continuation.repeat);
    if (advance._tag !== 'PickRandomVideo') return { setlist: applied };
    const song = advance.candidates[a.pick % advance.candidates.length];
    return { setlist: S.play(applied, song), candidates: advance.candidates };
  }
  if (a.type === 'fail') {
    if (S.isStreamGone(current(setlist).phase)) return { setlist };
    const { cleaned, advance } = S.planSkip(setlist, continuation);
    const applied = S.applySkip(cleaned, advance);
    if (advance._tag !== 'PickRandomVideo') return { setlist: applied };
    const song = advance.candidates[a.pick % advance.candidates.length];
    return { setlist: S.play(applied, song), candidates: advance.candidates, waiting: applied };
  }
  return { setlist: S.togglePlaying(setlist) };
}

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const fail = (msg) => { throw new Error(msg); };

const continuationOf = ({ goneVideos, isAutoplay, repeat }) => ({
  archive,
  isGone: (s) => goneVideos.includes(s.video_url),
  isAutoplay,
  repeat,
});

const expectedFirsts = (scene, now) => archive.filter((s, i) => !scene.goneVideos.includes(s.video_url)
  && s.video_url !== now.video_url && archive.findIndex((o) => o.video_url === s.video_url) === i);

// A fail that leaves the same play on the bar makes that play dead, and a loadFail on a play that is
// not dead makes it failed until a new play replaces it. Both are worked out from the actions alone.
// `attempt` is the oracle's own count of the loads of the play on the bar.
const walk = (scene, onStep) => {
  const continuation = continuationOf(scene);
  let setlist = S.emptySetlist;
  let deadPlayId;
  let failedPlayId;
  let attempt = 1;
  for (const a of scene.seq) {
    const { setlist: after, candidates, waiting } = apply(setlist, a, continuation);
    const playId = current(setlist)?.playId;
    const isDead = playId !== undefined && playId === deadPlayId;
    const isFailed = playId !== undefined && playId === failedPlayId;
    onStep(a, setlist, after, candidates, isDead, { isFailed, attempt, waiting });
    if (a.type === 'fail' && current(setlist) && current(after).playId === playId) deadPlayId = playId;
    if (a.type === 'loadFail' && current(setlist) && !isDead) failedPlayId = playId;
    if (current(after)?.playId !== playId) attempt = a.type === 'retry' ? attempt + 1 : 1;
    setlist = after;
  }
  return setlist;
};
const cannotEnd = (isDead, { isFailed }) => isDead || isFailed;

const properties = {
  // A queued song plays in the order it was queued, as moved by the visitor, and nothing drops one before it plays.
  // Previous is the one exception: the song it leaves goes to the front of the queue.
  'queue-is-fifo-and-lossless': (scene) => {
    const expectedQueue = [];
    walk(scene, (a, before, after, _, isDead, more) => {
      if (a.type === 'enqueue') expectedQueue.push(a.song);
      if (a.type === 'move' && a.from !== a.to && a.from < expectedQueue.length && a.to < expectedQueue.length) {
        const [moved] = expectedQueue.splice(a.from, 1);
        expectedQueue.splice(a.to, 0, moved);
      }
      if (a.type === 'move' && !same(after.playCount, before.playCount)) fail('move changed the play count');
      if (a.type === 'move' && !same(after.maybeNowPlaying, before.maybeNowPlaying)) fail('move changed what is playing');
      if (a.type === 'move' && !same(after.history, before.history)) fail('move changed the history');
      if (a.type === 'previous' && current(before) && before.history.length && !isDead) expectedQueue.unshift(current(before).song);
      if ((a.type === 'next' || (a.type === 'end' && !cannotEnd(isDead, more))) && current(before) && expectedQueue.length) {
        const expected = expectedQueue.shift();
        if (!same(current(after).song, expected)) fail(`${a.type} played ${current(after).song.id}, expected ${expected.id}`);
      }
      if (a.type === 'fail' && current(before) && !isDead) {
        const dead = current(before).song.video_url;
        const alive = expectedQueue.filter((s) => s.video_url !== dead);
        expectedQueue.splice(0, expectedQueue.length, ...alive);
        if (expectedQueue.length) {
          const expected = expectedQueue.shift();
          if (!same(current(after).song, expected)) fail(`fail played ${current(after).song.id}, expected ${expected.id}`);
        }
      }
      if (!same(after.queue, expectedQueue)) fail(`after ${a.type} queue is [${after.queue.map((s) => s.id)}], expected [${expectedQueue.map((s) => s.id)}]`);
    });
  },

  // History is capped at 50, and the song a new play (a click, or a video end) replaces is the newest entry.
  'history-is-bounded-and-newest-first': (scene) => {
    walk(scene, (a, before, after, _, isDead) => {
      if (after.history.length > 50) fail(`history grew to ${after.history.length}`);
      const startedNewPlay = a.type === 'play' || (a.type === 'end' && current(before) && current(after).playId !== current(before).playId);
      if (startedNewPlay && current(before) && !isDead && !same(after.history[0], current(before).song)) {
        fail(`${a.type} did not record ${current(before).song.id} as newest history`);
      }
    });
  },

  // Each new play gets its own player, even when the same song plays twice in a row.
  'new-play-gets-a-new-player': (scene) => {
    walk(scene, (a, before, after) => {
      const replaced = a.type === 'play' || (a.type === 'previous' && before.history.length > 0);
      if (replaced && current(before) && current(after).playId <= current(before).playId) {
        fail(`${a.type} kept playId ${current(after).playId}`);
      }
      if (a.type === 'toggle' && current(before) && current(after).playId !== current(before).playId) {
        fail('toggling play and pause replaced the player');
      }
    });
  },

  // With autoplay on and an empty queue, a video end picks among the first songs of every other live
  // video, and pauses the same song when there are none. YouTube ends a video only at its end, so no
  // later song of the same video is left to play.
  'end-of-video-picks-another-video-or-pauses': (scene) => {
    if (!scene.isAutoplay) return;
    walk(scene, (a, before, after, candidates, isDead, more) => {
      if (a.type !== 'end' || !current(before) || before.queue.length || cannotEnd(isDead, more)) return;
      const now = current(before).song;
      const firsts = expectedFirsts(scene, now);
      if (!firsts.length) {
        if (candidates) fail('end with no other live video asked for a random video');
        if (intentOf(current(after)) !== 'Paused') fail('end with nothing left did not pause');
        if (current(after).song.id !== now.id) fail('end with nothing left changed the song');
        return;
      }
      if (!same(candidates, firsts)) fail(`end after ${now.id} offered [${candidates?.map((s) => s.id)}], expected [${firsts.map((s) => s.id)}]`);
      if (intentOf(current(after)) !== 'Playing') fail('end did not keep playing');
    });
  },

  // A random pick, from a video end or a failed video, lands on the first song of a video that is not
  // the current one and not gone, and offers every such video once.
  'random-pick-lands-on-another-live-video-first-song': (scene) => {
    walk(scene, (a, before, after, candidates) => {
      if (!candidates) return;
      const now = current(before).song;
      const landed = current(after).song;
      if (landed.video_url === now.video_url) fail(`${a.type} picked ${landed.id} of the current video`);
      if (scene.goneVideos.includes(landed.video_url)) fail(`${a.type} picked ${landed.id} of a gone video`);
      const first = archive.find((s) => s.video_url === landed.video_url);
      if (landed.id !== first.id) fail(`${a.type} picked ${landed.id}, not the first song of its video`);
      if (!same(candidates, expectedFirsts(scene, now))) fail(`${a.type} offered [${candidates.map((s) => s.id)}], expected the first song of each other live video`);
    });
  },

  // With autoplay off and nothing queued, a video end or a gone video never starts an archive song.
  // The same song stays: paused after an end, and marked gone after a gone video.
  'autoplay-off-never-starts-an-archive-song': (scene) => {
    if (scene.isAutoplay) return;
    walk(scene, (a, before, after, candidates, isDead, more) => {
      if (!current(before) || isDead || (a.type === 'end' && more.isFailed)) return;
      const dead = current(before).song.video_url;
      const queued = a.type === 'fail' ? before.queue.filter((s) => s.video_url !== dead) : before.queue;
      if ((a.type !== 'end' && a.type !== 'fail') || queued.length) return;
      if (candidates) fail(`${a.type} asked for a random video with autoplay off`);
      if (current(after).playId !== current(before).playId) fail(`${a.type} started a new play with autoplay off`);
      if (current(after).song.id !== current(before).song.id) fail(`${a.type} moved to ${current(after).song.id} with autoplay off`);
      if (a.type === 'end' && intentOf(current(after)) !== 'Paused') fail('end with autoplay off did not pause');
      if (a.type === 'fail' && current(after).phase._tag !== 'Gone') fail(`fail with autoplay off left the song ${current(after).phase._tag}, not Gone`);
    });
  },

  // The visitor asked for the queued songs, so they play whatever autoplay says.
  'queue-plays-whatever-autoplay-says': (scene) => {
    walk(scene, (a, before, after, _, isDead, more) => {
      if ((a.type !== 'end' && a.type !== 'fail') || !current(before) || isDead || (a.type === 'end' && more.isFailed)) return;
      const dead = current(before).song.video_url;
      const queued = a.type === 'fail' ? before.queue.filter((s) => s.video_url !== dead) : before.queue;
      if (!queued.length) return;
      if (!same(current(after).song, queued[0])) fail(`${a.type} with autoplay ${scene.isAutoplay} played ${current(after).song.id}, expected the queue head ${queued[0].id}`);
      if (intentOf(current(after)) !== 'Playing') fail(`${a.type} did not keep playing the queue`);
    });
  },

  // An archive advance, by video end or by a failed video, never lands on a video known to be gone.
  'archive-advance-skips-gone-videos': (scene) => {
    if (!scene.isAutoplay) return;
    walk(scene, (a, before, after) => {
      if (!current(before) || (a.type !== 'end' && a.type !== 'fail')) return;
      const dead = current(before).song.video_url;
      const queued = a.type === 'fail' ? before.queue.filter((s) => s.video_url !== dead) : before.queue;
      if (queued.length || current(after).playId === current(before).playId) return;
      if (scene.goneVideos.includes(current(after).song.video_url)) fail(`${a.type} landed on ${current(after).song.id} of a gone video`);
    });
  },

  // A video that cannot play is skipped with every song that shares it, and Previous never returns to it.
  'unavailable-video-is-skipped': (scene) => {
    walk(scene, (a, before, after, candidates, isDead, more) => {
      if (a.type !== 'fail' || !current(before) || isDead) return;
      const dead = current(before).song.video_url;
      if (candidates && current(more.waiting).phase._tag !== 'MovingOn') fail(`a gone song waiting for its pick is ${current(more.waiting).phase._tag}, not MovingOn`);
      const deadSongs = [...after.queue, ...after.history].filter((s) => s.video_url === dead);
      if (deadSongs.length) fail(`fail left ${deadSongs.map((s) => s.id)} of the dead video in the queue or history`);
      const hasNext = before.queue.some((s) => s.video_url !== dead)
        || (scene.isAutoplay && archive.some((s) => s.video_url !== dead && !scene.goneVideos.includes(s.video_url)));
      const now = current(after);
      if (hasNext) {
        if (now.song.video_url === dead) fail(`fail stayed on ${now.song.id} of the dead video`);
        if (now.phase._tag !== 'Loading' || intentOf(now) !== 'Playing') fail(`fail left the next song ${now.phase._tag}, not loading to play`);
        if (now.playId <= current(before).playId) fail('fail kept the playId');
      } else {
        if (now.song.id !== current(before).song.id) fail(`fail with nothing left moved to ${now.song.id}`);
        if (now.phase._tag !== 'Gone') fail(`fail with nothing left is ${now.phase._tag}, not Gone`);
      }
    });
  },

  // A song whose video is gone never goes into history or the queue when the visitor leaves it.
  'gone-song-is-never-recorded': (scene) => {
    walk(scene, (a, before, after, _, isDead) => {
      if (!isDead || current(after).playId === current(before).playId) return;
      const count = (setlist) => [...setlist.queue, ...setlist.history].filter((s) => s.id === current(before).song.id).length;
      if (count(after) > count(before)) fail(`${a.type} put the gone ${current(before).song.id} back into the queue or history`);
    });
  },

  // A load that failed keeps the play, the song, the queue and the history, and is not a gone stream.
  // A gone play stays gone. A click on another song then records the failed one like any other.
  'load-failure-keeps-the-song': (scene) => {
    walk(scene, (a, before, after, _, isDead, more) => {
      if (more.isFailed && !isDead && a.type === 'play' && !same(after.history[0], current(before).song)) fail(`play did not record ${current(before).song.id}, whose load had failed, in history`);
      if (a.type !== 'loadFail' || !current(before)) return;
      if (current(after).playId !== current(before).playId || !same(current(after).song, current(before).song)) fail('loadFail changed the play');
      if (!same(after.queue, before.queue) || !same(after.history, before.history)) fail('loadFail changed the queue or history');
      if (isDead && !same(after, before)) fail('loadFail changed a gone play');
      if (!isDead && current(after).phase._tag !== 'LoadFailed') fail(`loadFail left the play ${current(after).phase._tag}`);
    });
  },

  // A retry is a new play of the same song that changes nothing else, and it counts every load since
  // the song last played, whoever asked for it. Only a failed load can be retried.
  'retry-reloads-the-same-song-and-counts-up': (scene) => {
    walk(scene, (a, before, after, _, isDead, more) => {
      if (current(after) && current(after).attempt !== (current(after).playId === current(before)?.playId ? more.attempt : a.type === 'retry' ? more.attempt + 1 : 1)) fail(`after ${a.type} the attempt is ${current(after).attempt}`);
      if (a.type !== 'retry' || !current(before)) return;
      if (isDead || !more.isFailed) {
        if (!same(after, before)) fail('retry changed a play whose load had not failed');
        return;
      }
      if (current(after).playId <= current(before).playId) fail('retry kept the playId, so the video does not reload');
      if (!same(current(after).song, current(before).song)) fail(`retry moved to ${current(after).song.id}`);
      if (!same(after.queue, before.queue) || !same(after.history, before.history)) fail('retry changed the queue or history');
      if (current(after).phase._tag !== 'Loading') fail(`retry left the play ${current(after).phase._tag}`);
      if (a.by === 'Visitor' && intentOf(current(after)) !== 'Playing') fail('a retry the visitor asked for does not play');
    });
  },

  // The automatic retries wait 2, 4 and 8 seconds, and no attempt after the third failure waits.
  'automatic-retries-double-then-stop': () => {
    const waits = Array.from({ length: 12 }, (_, i) => Option.getOrUndefined(S.loadRetryDelaySeconds(i + 1)));
    if (!same(waits.slice(0, 3), [2, 4, 8])) fail(`the waits are ${waits.slice(0, 3)}`);
    if (waits.slice(3).some((wait) => wait !== undefined)) fail('an attempt after the third failure still waits');
  },

  // A page reload restores queue and history, and nothing starts playing on its own.
  'reload-restores-queue-and-history': (scene) => {
    const before = walk(scene, () => {});
    const after = S.restoreSaved(S.emptySetlist, Option.some(S.toPersistedJson(before)));
    if (!same(after.queue, before.queue)) fail('reload changed the queue');
    if (!same(after.history, before.history)) fail('reload changed the history');
    if (Option.isSome(after.maybeNowPlaying)) fail('reload resumed playback');
  },

  'playlist-ids-follow-the-session': (scene) => {
    const end = walk(scene, () => {});
    const { isGone } = continuationOf(scene);
    const played = [...end.history].reverse();
    const playing = current(end) && !S.isStreamGone(current(end).phase) ? [current(end).song] : [];
    const ids = (songs) => [...new Set(songs.filter((s) => !isGone(s)).map((s) => s.id))];
    const sources = { Queue: end.queue, History: played, Session: [...played, ...playing, ...end.queue] };
    for (const [source, songs] of Object.entries(sources)) {
      const { songIds, omittedCount } = S.playlistSongIds(end, source, isGone);
      if (!same(songIds, ids(songs))) fail(`${source} saved ${songIds} in place of ${ids(songs)}`);
      if (omittedCount !== 0) fail(`${source} omitted songs under the cap`);
    }
  },

  // Repeat One restarts the ended song with a new player and leaves the queue and history alone, whatever autoplay says.
  'repeat-one-restarts-the-ended-song': (scene) => {
    if (scene.repeat !== 'One') return;
    walk(scene, (a, before, after, _, isDead, more) => {
      if (a.type !== 'end' || !current(before) || cannotEnd(isDead, more)) return;
      if (!same(current(after).song, current(before).song)) fail(`end under repeat One moved to ${current(after).song.id}`);
      if (current(after).playId <= current(before).playId) fail('end under repeat One kept the playId');
      if (intentOf(current(after)) !== 'Playing') fail('end under repeat One did not play');
      if (!same(after.queue, before.queue) || !same(after.history, before.history)) fail('end under repeat One changed the queue or history');
    });
  },

  // Repeat All loses no song: leaving the current one by end or Next puts it at the end of the queue, and the head plays.
  'repeat-all-loops-the-queue': (scene) => {
    if (scene.repeat !== 'All') return;
    walk(scene, (a, before, after, _, isDead, more) => {
      if ((a.type !== 'end' && a.type !== 'next') || !current(before) || (a.type === 'end' && cannotEnd(isDead, more))) return;
      const expected = isDead ? before.queue : [...before.queue, current(before).song];
      if (!expected.length) {
        if (current(after).playId !== current(before).playId || current(after).phase._tag !== 'Gone') fail(`${a.type} under repeat All replayed the gone ${current(before).song.id}`);
        return;
      }
      if (!same(current(after).song, expected[0])) fail(`${a.type} under repeat All played ${current(after).song.id}, expected ${expected[0].id}`);
      if (!same(after.queue, expected.slice(1))) fail(`${a.type} under repeat All left queue [${after.queue.map((s) => s.id)}], expected [${expected.slice(1).map((s) => s.id)}]`);
    });
  },
};

// The older properties describe repeat Off.
for (const [name, property] of Object.entries(properties)) {
  if (!name.startsWith('repeat-')) properties[name] = (scene) => property({ ...scene, repeat: 'Off' });
}

async function checkProperty(name) {
    const result = await fc.check(
    fc.property(scenario, (scene) => properties[name](scene)),
    { numRuns: RUNS, seed: 20261101, endOnFailure: false },
  );
  if (!result.failed) return { name, failed: false, runs: RUNS };
  const [scene] = result.counterexample;
  const steps = `autoplay ${scene.isAutoplay ? 'on' : 'off'}, repeat ${scene.repeat}, gone [${scene.goneVideos}]: ${scene.seq.map((a) => (a.song ? `${a.type} ${a.song.id}` : a.type === 'move' ? `move ${a.from}->${a.to}` : a.type)).join(', ')}`;
  return { name, failed: true, runs: RUNS, steps, why: result.errorInstance?.message ?? String(result.error) };
}

const MUTANTS = [
  { property: 'queue-is-fifo-and-lossless', from: 'modifyFields(looped, { queue: queue => Array.drop(queue, 1) })', to: 'looped' },
  { property: 'queue-is-fifo-and-lossless', from: 'Option.match(Array.head(looped.queue), {', to: 'Option.match(Array.last(looped.queue), {' },
  { property: 'queue-is-fifo-and-lossless', from: '...without.slice(0, to), queue[from]!, ...without.slice(to)', to: '...without.slice(0, to + 1), queue[from]!, ...without.slice(to + 1)' },
  { property: 'queue-is-fifo-and-lossless', from: 'queue: () => [...without.slice(0, to)', to: 'queue: () => [...queue.slice(0, to)' },
  { property: 'queue-is-fifo-and-lossless', from: 'from === to || !isInRange(from) || !isInRange(to)', to: 'from === to || !isInRange(from)' },
  { property: 'queue-is-fifo-and-lossless', from: 'queue => [...queue, song]', to: 'queue => [song, ...queue]' },
  { property: 'history-is-bounded-and-newest-first', from: 'Array.take([left, ...history], HISTORY_LIMIT)', to: '[left, ...history]' },
  { property: 'history-is-bounded-and-newest-first', from: '[left, ...history]', to: '[...history, left]' },
  { property: 'new-play-gets-a-new-player', from: 'attempt: 1,\n      }),\n    playCount: count => count + 1,', to: 'attempt: 1,\n      }),\n    playCount: count => count,' },
  { property: 'end-of-video-picks-another-video-or-pauses', from: 'Stop: () => pause(setlist),', to: 'Stop: () => setlist,' },
  { property: 'end-of-video-picks-another-video-or-pauses', from: 'onEmpty: () => Advance.Stop(),', to: 'onEmpty: () => Advance.Replay(),' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => !isGone(song),' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => song.video_url !== current.video_url,' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: '  Array.dedupeWith(\n    Array.filter(\n      archive,\n      song => !isGone(song) && song.video_url !== current.video_url,\n    ),\n    (first, second)', to: '  Array.dedupeWith(\n    Array.reverse(Array.filter(\n      archive,\n      song => !isGone(song) && song.video_url !== current.video_url,\n    )),\n    (first, second)' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: 'onNonEmpty: candidates => Advance.PickRandomVideo({ candidates }),', to: 'onNonEmpty: candidates => Advance.PickRandomVideo({ candidates: [candidates[0], ...candidates] }),' },
  { property: 'gone-song-is-never-recorded', from: 'isStreamGone(phase) ? Option.none() : Option.some(song),', to: 'Option.some(song),' },
  { property: 'unavailable-video-is-skipped', from: 'const cleaned = changePhase(', to: 'const cleaned = (setlist => setlist)(' },
  { property: 'unavailable-video-is-skipped', from: 'PickRandomVideo: () => changePhase(cleaned, () => Phase.MovingOn()),', to: '' },
  { property: 'load-failure-keeps-the-song', from: 'onSome: intent => Phase.LoadFailed({ reason, intent }),', to: 'onSome: () => Phase.Gone(),' },
  { property: 'load-failure-keeps-the-song', from: 'onNone: () => phase,\n      onSome: intent => Phase.LoadFailed({ reason, intent }),', to: 'onNone: () => Phase.LoadFailed({ reason, intent: \'Playing\' }),\n      onSome: intent => Phase.LoadFailed({ reason, intent }),' },
  { property: 'retry-reloads-the-same-song-and-counts-up', from: 'attempt: attempt + 1,', to: 'attempt: 1,' },
  { property: 'retry-reloads-the-same-song-and-counts-up', from: 'attempt: attempt + 1,\n                }),\n              playCount: count => count + 1,', to: 'attempt: attempt + 1,\n                }),\n              playCount: count => count,' },
  { property: 'retry-reloads-the-same-song-and-counts-up', from: "intent: by === 'Visitor' ? 'Playing' : intent,", to: 'intent,' },
  { property: 'retry-reloads-the-same-song-and-counts-up', from: 'attempt: attempt + 1,\n                }),\n', to: 'attempt: attempt + 1,\n                }),\n              history: history => [song, ...history],\n' },
  { property: 'retry-reloads-the-same-song-and-counts-up', from: 'LoadFailed: ({ intent }) =>\n            modifyFields(setlist, {', to: 'LoadFailed: ({ intent }) =>\n            modifyFields(play(setlist, song), {' },
  { property: 'automatic-retries-double-then-stop', from: 'attempt <= MAX_AUTO_LOAD_RETRIES ? Option.some', to: 'true ? Option.some' },
  { property: 'automatic-retries-double-then-stop', from: 'Option.some(2 ** attempt)', to: 'Option.some(2 * attempt)' },
  { property: 'autoplay-off-never-starts-an-archive-song', from: '  continuation.isAutoplay\n    ? Array.match(', to: '  true\n    ? Array.match(' },
  { property: 'queue-plays-whatever-autoplay-says', from: 'Array.isReadonlyArrayNonEmpty(setlist.queue)\n    ? Advance.PlayQueued()', to: 'continuation.isAutoplay && Array.isReadonlyArrayNonEmpty(setlist.queue)\n    ? Advance.PlayQueued()' },
  { property: 'queue-plays-whatever-autoplay-says', from: 'Array.isReadonlyArrayNonEmpty(cleaned.queue)\n          ? Advance.PlayQueued()', to: 'continuation.isAutoplay && Array.isReadonlyArrayNonEmpty(cleaned.queue)\n          ? Advance.PlayQueued()' },
  { property: 'queue-is-fifo-and-lossless', from: 'queue: queue => [...Option.toArray(leftSong(setlist)), ...queue],', to: 'queue: queue => queue,' },
  { property: 'unavailable-video-is-skipped', from: 'queue: queue => Array.filter(queue, isOtherVideo),', to: 'queue: queue => queue,' },
  { property: 'unavailable-video-is-skipped', from: 'history: history => Array.filter(history, isOtherVideo),', to: 'history: history => history,' },
  { property: 'unavailable-video-is-skipped', from: 'PlayQueued: () => playNext(cleaned),', to: 'PlayQueued: () => cleaned,' },
  { property: 'repeat-one-restarts-the-ended-song', from: 'if (hasSong && continuation.repeat === \'One\') {', to: 'if (false) {' },
  { property: 'repeat-all-loops-the-queue', from: 'onSome: left => enqueue(setlist, left),', to: 'onSome: () => setlist,' },
  { property: 'repeat-all-loops-the-queue', from: "if (hasSong && continuation.repeat === 'All') {", to: 'if (false) {' },
  { property: 'playlist-ids-follow-the-session', from: 'const played = Array.reverse(setlist.history)', to: 'const played = setlist.history' },
  { property: 'playlist-ids-follow-the-session', from: ': [...played, ...playing, ...setlist.queue]', to: ': [...played, ...setlist.queue, ...playing]' },
  { property: 'playlist-ids-follow-the-session', from: '({ song, phase }) => (isStreamGone(phase) ? [] : [song]),', to: '({ song }) => [song],' },
  { property: 'reload-restores-queue-and-history', from: 'queue: () => state.queue,', to: 'queue: queue => queue,' },
  { property: 'reload-restores-queue-and-history', from: 'history: () => state.history,', to: 'history: history => history,' },
];

function runMutants() {
  const dir = join(here, '.mutants');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(realModule, 'utf8').replace("'../../domain.ts'", `'${domainUrl}'`).replace("'../../youtube.ts'", `'${youtubeUrl}'`).replace("'../../playlist.ts'", `'${playlistUrl}'`);
  let wrong = 0;
  MUTANTS.forEach((m, i) => {
    if (source.split(m.from).length !== 2) {
      console.log(`MUTANT STALE ${m.property}: "${m.from}" is no longer in setlist.ts. Update MUTANTS.`);
      wrong++;
      return;
    }
    const file = join(dir, `mutant-${i}.ts`);
    writeFileSync(file, source.replace(m.from, m.to));
    const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--only', m.property], {
      env: { ...process.env, KARAOKE_SETLIST: file, RUNS: String(RUNS) }, encoding: 'utf8',
    });
    const caught = run.status === 1;
    console.log(`${caught ? 'CAUGHT' : 'MISSED'} ${m.property}: ${m.from} -> ${m.to || '(removed)'}`);
    if (!caught) wrong++;
  });
  rmSync(dir, { recursive: true, force: true });
  console.log(wrong ? `${wrong} mutants were not caught` : `all ${MUTANTS.length} mutants caught`);
  process.exit(wrong ? 2 : 0);
}

if (process.argv.includes('--mutants')) runMutants();

const onlyAt = process.argv.indexOf('--only');
const names = onlyAt > -1 ? [process.argv[onlyAt + 1]] : Object.keys(properties);
let exit = 0;
for (const name of names) {
  const r = await checkProperty(name);
  if (!r.failed) {
    console.log(`PASS ${name} (${r.runs} sequences)`);
  } else {
    console.log(`FAIL ${name}\n  steps: ${r.steps}\n  why: ${r.why}`);
    exit = 1;
  }
}
process.exit(exit);
