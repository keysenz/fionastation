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
  { weight: 1, arbitrary: fc.constant({ type: 'toggle' }) },
  { weight: 1, arbitrary: fc.constant({ type: 'fail' }) },
));
const moveOrEnqueue = fc.oneof(
  { weight: 2, arbitrary: withPick(song.map((s) => ({ type: 'enqueue', song: s }))) },
  { weight: 3, arbitrary: withPick(fc.record({ type: fc.constant('move'), from: fc.nat(4), to: fc.nat(4) })) },
);
// The second shape plays enough songs in a row to reach the history cap, and the third queues and moves
// songs, because mixed sequences rarely hold more than two queued songs at once.
const actionSequence = fc.oneof(
  fc.array(action, { minLength: 1, maxLength: 150 }),
  fc.array(withPick(song.map((s) => ({ type: 'play', song: s }))), { minLength: 52, maxLength: 80 }),
  fc.array(moveOrEnqueue, { minLength: 4, maxLength: 30 }),
);
// Each run also draws which of the 3 videos are known gone and whether autoplay is on.
const scenario = fc.record({
  seq: actionSequence,
  goneVideos: fc.subarray(['v1', 'v2', 'v3']),
  isAutoplay: fc.boolean(),
  repeat: fc.constantFrom('Off', 'All', 'One'),
});

const current = (setlist) => Option.getOrUndefined(setlist.maybeNowPlaying);

// Only what the UI can do: the player bar's previous, toggle and next exist once a song is current,
// and only a current song's video can end or fail. A video end or failure that needs a random video
// resolves it like the Command does, here by choosing the candidate the action's number points at.
// It returns the candidates it chose from, or undefined when no pick happened.
function apply(setlist, a, continuation) {
  if (a.type === 'play') return { setlist: S.play(setlist, a.song) };
  if (a.type === 'enqueue') return { setlist: S.enqueue(setlist, a.song) };
  if (a.type === 'move') return { setlist: S.moveInQueue(setlist, a.from, a.to) };
  if (!current(setlist)) return { setlist };
  if (a.type === 'next') return { setlist: S.playNext(setlist, continuation.repeat) };
  if (a.type === 'previous') return { setlist: S.playPrevious(setlist) };
  if (a.type === 'end') {
    const advance = S.planAdvance(setlist, continuation);
    const applied = S.applyAdvance(setlist, advance, continuation.repeat);
    if (advance._tag !== 'PickRandomVideo') return { setlist: applied };
    const song = advance.candidates[a.pick % advance.candidates.length];
    return { setlist: S.play(applied, song), candidates: advance.candidates };
  }
  if (a.type === 'fail') {
    const { cleaned, advance } = S.planSkip(setlist, continuation, 'gone');
    const applied = S.applySkip(cleaned, advance);
    if (advance._tag !== 'PickRandomVideo') return { setlist: applied };
    const song = advance.candidates[a.pick % advance.candidates.length];
    return { setlist: S.play(applied, song), candidates: advance.candidates };
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

// A fail that leaves the same play on the bar makes that play dead, as worked out from the actions alone.
const walk = (scene, onStep) => {
  const continuation = continuationOf(scene);
  let setlist = S.emptySetlist;
  let deadPlayId;
  for (const a of scene.seq) {
    const { setlist: after, candidates } = apply(setlist, a, continuation);
    const isDead = current(setlist) !== undefined && current(setlist).playId === deadPlayId;
    onStep(a, setlist, after, candidates, isDead);
    if (a.type === 'fail' && current(setlist) && current(after).playId === current(setlist).playId) deadPlayId = current(after).playId;
    setlist = after;
  }
  return setlist;
};

const properties = {
  // A queued song plays in the order it was queued, as moved by the visitor, and nothing drops one before it plays.
  // Previous is the one exception: the song it leaves goes to the front of the queue.
  'queue-is-fifo-and-lossless': (scene) => {
    const expectedQueue = [];
    walk(scene, (a, before, after, _, isDead) => {
      if (a.type === 'enqueue') expectedQueue.push(a.song);
      if (a.type === 'move' && a.from !== a.to && a.from < expectedQueue.length && a.to < expectedQueue.length) {
        const [moved] = expectedQueue.splice(a.from, 1);
        expectedQueue.splice(a.to, 0, moved);
      }
      if (a.type === 'move' && !same(after.playCount, before.playCount)) fail('move changed the play count');
      if (a.type === 'move' && !same(after.maybeNowPlaying, before.maybeNowPlaying)) fail('move changed what is playing');
      if (a.type === 'move' && !same(after.history, before.history)) fail('move changed the history');
      if (a.type === 'previous' && current(before) && before.history.length && !isDead) expectedQueue.unshift(current(before).song);
      if ((a.type === 'next' || a.type === 'end') && current(before) && expectedQueue.length) {
        const expected = expectedQueue.shift();
        if (!same(current(after).song, expected)) fail(`${a.type} played ${current(after).song.id}, expected ${expected.id}`);
      }
      if (a.type === 'fail' && current(before)) {
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
    walk(scene, (a, before, after, candidates) => {
      if (a.type !== 'end' || !current(before) || before.queue.length) return;
      const now = current(before).song;
      const firsts = expectedFirsts(scene, now);
      if (!firsts.length) {
        if (candidates) fail('end with no other live video asked for a random video');
        if (current(after).status !== 'Paused') fail('end with nothing left did not pause');
        if (current(after).song.id !== now.id) fail('end with nothing left changed the song');
        return;
      }
      if (!same(candidates, firsts)) fail(`end after ${now.id} offered [${candidates?.map((s) => s.id)}], expected [${firsts.map((s) => s.id)}]`);
      if (current(after).status !== 'Playing') fail('end did not keep playing');
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

  // With autoplay off and nothing queued, a video end or a failed video never starts an archive song.
  // The same song stays, paused, and a failure says why.
  'autoplay-off-never-starts-an-archive-song': (scene) => {
    if (scene.isAutoplay) return;
    walk(scene, (a, before, after, candidates) => {
      if (!current(before)) return;
      const dead = current(before).song.video_url;
      const queued = a.type === 'fail' ? before.queue.filter((s) => s.video_url !== dead) : before.queue;
      if ((a.type !== 'end' && a.type !== 'fail') || queued.length) return;
      if (candidates) fail(`${a.type} asked for a random video with autoplay off`);
      if (current(after).playId !== current(before).playId) fail(`${a.type} started a new play with autoplay off`);
      if (current(after).song.id !== current(before).song.id) fail(`${a.type} moved to ${current(after).song.id} with autoplay off`);
      if (current(after).status !== 'Paused') fail(`${a.type} with autoplay off did not pause`);
      if (a.type === 'fail' && Option.isNone(current(after).maybeLoadError)) fail('fail with autoplay off did not say why');
    });
  },

  // The visitor asked for the queued songs, so they play whatever autoplay says.
  'queue-plays-whatever-autoplay-says': (scene) => {
    walk(scene, (a, before, after) => {
      if ((a.type !== 'end' && a.type !== 'fail') || !current(before)) return;
      const dead = current(before).song.video_url;
      const queued = a.type === 'fail' ? before.queue.filter((s) => s.video_url !== dead) : before.queue;
      if (!queued.length) return;
      if (!same(current(after).song, queued[0])) fail(`${a.type} with autoplay ${scene.isAutoplay} played ${current(after).song.id}, expected the queue head ${queued[0].id}`);
      if (current(after).status !== 'Playing') fail(`${a.type} did not keep playing the queue`);
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
    walk(scene, (a, before, after) => {
      if (a.type !== 'fail' || !current(before)) return;
      const dead = current(before).song.video_url;
      const deadSongs = [...after.queue, ...after.history].filter((s) => s.video_url === dead);
      if (deadSongs.length) fail(`fail left ${deadSongs.map((s) => s.id)} of the dead video in the queue or history`);
      const hasNext = before.queue.some((s) => s.video_url !== dead)
        || (scene.isAutoplay && archive.some((s) => s.video_url !== dead && !scene.goneVideos.includes(s.video_url)));
      const now = current(after);
      if (hasNext) {
        if (now.song.video_url === dead) fail(`fail stayed on ${now.song.id} of the dead video`);
        if (now.status !== 'Playing') fail('fail did not keep playing');
        if (now.playId <= current(before).playId) fail('fail kept the playId');
        if (Option.isSome(now.maybeLoadError)) fail('fail left a load error on the next song');
      } else {
        if (now.song.id !== current(before).song.id) fail(`fail with nothing left moved to ${now.song.id}`);
        if (now.status !== 'Paused') fail('fail with nothing left did not pause');
        if (Option.isNone(now.maybeLoadError)) fail('fail with nothing left did not say why');
      }
    });
  },

  // A song whose video failed never went into history or the queue when the visitor leaves it.
  'failed-song-is-never-recorded': (scene) => {
    walk(scene, (a, before, after, _, isDead) => {
      if (!isDead || current(after).playId === current(before).playId) return;
      const count = (setlist) => [...setlist.queue, ...setlist.history].filter((s) => s.id === current(before).song.id).length;
      if (count(after) > count(before)) fail(`${a.type} put the failed ${current(before).song.id} back into the queue or history`);
    });
  },

  // A page reload restores queue and history, and nothing starts playing on its own.
  'reload-restores-queue-and-history': (scene) => {
    const before = walk(scene, () => {});
    const after = S.restoreSaved(S.emptySetlist, Option.some(S.toPersistedJson(before)));
    if (!same(after.queue, before.queue)) fail('reload changed the queue');
    if (!same(after.history, before.history)) fail('reload changed the history');
    if (Option.isSome(after.maybeNowPlaying)) fail('reload resumed playback');
  },

  // Repeat One restarts the ended song with a new player and leaves the queue and history alone, whatever autoplay says.
  'repeat-one-restarts-the-ended-song': (scene) => {
    if (scene.repeat !== 'One') return;
    walk(scene, (a, before, after) => {
      if (a.type !== 'end' || !current(before)) return;
      if (!same(current(after).song, current(before).song)) fail(`end under repeat One moved to ${current(after).song.id}`);
      if (current(after).playId <= current(before).playId) fail('end under repeat One kept the playId');
      if (current(after).status !== 'Playing') fail('end under repeat One did not play');
      if (!same(after.queue, before.queue) || !same(after.history, before.history)) fail('end under repeat One changed the queue or history');
    });
  },

  // Repeat All loses no song: leaving the current one by end or Next puts it at the end of the queue, and the head plays.
  'repeat-all-loops-the-queue': (scene) => {
    if (scene.repeat !== 'All') return;
    walk(scene, (a, before, after, _, isDead) => {
      if ((a.type !== 'end' && a.type !== 'next') || !current(before)) return;
      const expected = isDead ? before.queue : [...before.queue, current(before).song];
      if (!expected.length) {
        if (current(after).playId !== current(before).playId || current(after).status !== 'Paused') fail(`${a.type} under repeat All replayed the failed ${current(before).song.id}`);
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
  { property: 'new-play-gets-a-new-player', from: 'playCount: count => count + 1,', to: 'playCount: count => count,' },
  { property: 'end-of-video-picks-another-video-or-pauses', from: "Stop: () => setStatus(setlist, 'Paused'),", to: 'Stop: () => setlist,' },
  { property: 'end-of-video-picks-another-video-or-pauses', from: 'onEmpty: () => Advance.Stop(),', to: 'onEmpty: () => Advance.Replay(),' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => !isGone(song),' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => song.video_url !== current.video_url,' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: '  Array.dedupeWith(\n    Array.filter(\n      archive,\n      song => !isGone(song) && song.video_url !== current.video_url,\n    ),\n    (first, second)', to: '  Array.dedupeWith(\n    Array.reverse(Array.filter(\n      archive,\n      song => !isGone(song) && song.video_url !== current.video_url,\n    )),\n    (first, second)' },
  { property: 'random-pick-lands-on-another-live-video-first-song', from: 'onNonEmpty: candidates => Advance.PickRandomVideo({ candidates }),', to: 'onNonEmpty: candidates => Advance.PickRandomVideo({ candidates: [candidates[0], ...candidates] }),' },
  { property: 'failed-song-is-never-recorded', from: 'Option.isNone(maybeLoadError) ? Option.some(song) : Option.none(),', to: 'Option.some(song),' },
  { property: 'unavailable-video-is-skipped', from: 'const cleaned = failLoad(', to: 'const cleaned = (setlist => setlist)(' },
  { property: 'autoplay-off-never-starts-an-archive-song', from: '  continuation.isAutoplay\n    ? Array.match(', to: '  true\n    ? Array.match(' },
  { property: 'queue-plays-whatever-autoplay-says', from: 'Array.isReadonlyArrayNonEmpty(setlist.queue)\n    ? Advance.PlayQueued()', to: 'continuation.isAutoplay && Array.isReadonlyArrayNonEmpty(setlist.queue)\n    ? Advance.PlayQueued()' },
  { property: 'queue-plays-whatever-autoplay-says', from: 'Array.isReadonlyArrayNonEmpty(cleaned.queue)\n          ? Advance.PlayQueued()', to: 'continuation.isAutoplay && Array.isReadonlyArrayNonEmpty(cleaned.queue)\n          ? Advance.PlayQueued()' },
  { property: 'queue-is-fifo-and-lossless', from: 'queue: queue => [...Option.toArray(leftSong(setlist)), ...queue],', to: 'queue: queue => queue,' },
  { property: 'unavailable-video-is-skipped', from: 'queue: queue => Array.filter(queue, isOtherVideo),', to: 'queue: queue => queue,' },
  { property: 'unavailable-video-is-skipped', from: 'history: history => Array.filter(history, isOtherVideo),', to: 'history: history => history,' },
  { property: 'unavailable-video-is-skipped', from: '{ PlayQueued: () => playNext(cleaned) },', to: '{ PlayQueued: () => cleaned },' },
  { property: 'repeat-one-restarts-the-ended-song', from: 'if (hasSong && continuation.repeat === \'One\') {', to: 'if (false) {' },
  { property: 'repeat-all-loops-the-queue', from: 'onSome: left => enqueue(setlist, left),', to: 'onSome: () => setlist,' },
  { property: 'repeat-all-loops-the-queue', from: "if (hasSong && continuation.repeat === 'All') {", to: 'if (false) {' },
  { property: 'reload-restores-queue-and-history', from: 'queue: () => state.queue,', to: 'queue: queue => queue,' },
  { property: 'reload-restores-queue-and-history', from: 'history: () => state.history,', to: 'history: history => history,' },
];

function runMutants() {
  const dir = join(here, '.mutants');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(realModule, 'utf8').replace("'../../domain.ts'", `'${domainUrl}'`);
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
      env: { ...process.env, KARAOKE_SETLIST: file, RUNS: '300' }, encoding: 'utf8',
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
