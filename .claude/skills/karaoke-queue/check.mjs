#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Option } from 'effect';
import fc from 'fast-check';

const here = dirname(fileURLToPath(import.meta.url));
const realModule = join(here, '../../../src/page/karaoke/setlist.ts');
const domainUrl = pathToFileURL(join(here, '../../../src/domain.ts')).href;
const modulePath = process.env.KARAOKE_SETLIST ?? realModule;
const RUNS = Number(process.env.RUNS ?? 1000);

// A property in KNOWN_FINDINGS is a defect already reported to the owner. It must keep failing,
// and the check fails if it starts passing so that the entry gets removed.
const KNOWN_FINDINGS = new Set(['previous-keeps-current-song']);

const S = await import(pathToFileURL(modulePath).href);

const makeSong = (n) => ({
  id: `song-${n}`, song_title: `Song ${n}`, timestamp: '00:00:01', created_at: 'x', video_url: `v${n}`, title_text: 'Stream', membership: false,
});
const archive = Array.from({ length: 12 }, (_, i) => makeSong(i + 1));
const song = fc.integer({ min: 1, max: 12 }).map(makeSong);

const action = fc.oneof(
  { weight: 5, arbitrary: song.map((s) => ({ type: 'play', song: s })) },
  { weight: 4, arbitrary: song.map((s) => ({ type: 'enqueue', song: s })) },
  { weight: 3, arbitrary: fc.constant({ type: 'next' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'previous' }) },
  { weight: 2, arbitrary: fc.constant({ type: 'end' }) },
  { weight: 1, arbitrary: fc.constant({ type: 'toggle' }) },
);
// The second shape plays enough songs in a row to reach the history cap, which mixed sequences rarely do.
const actions = fc.oneof(
  fc.array(action, { minLength: 1, maxLength: 150 }),
  fc.array(song.map((s) => ({ type: 'play', song: s })), { minLength: 52, maxLength: 80 }),
);

const current = (setlist) => Option.getOrUndefined(setlist.maybeNowPlaying);

// Only what the UI can do: the player bar's previous, toggle and next exist once a song is current,
// and only a current song's video can end.
function apply(setlist, a) {
  if (a.type === 'play') return S.play(setlist, a.song);
  if (a.type === 'enqueue') return S.enqueue(setlist, a.song);
  if (!current(setlist)) return setlist;
  if (a.type === 'next') return S.playNext(setlist);
  if (a.type === 'previous') return S.playPrevious(setlist);
  if (a.type === 'end') return S.advanceAfterEnd(setlist, archive);
  return S.togglePlaying(setlist);
}

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const fail = (msg) => { throw new Error(msg); };

const walk = (seq, onStep) => {
  let setlist = S.emptySetlist;
  for (const a of seq) {
    const after = apply(setlist, a);
    onStep(a, setlist, after);
    setlist = after;
  }
  return setlist;
};

const properties = {
  // A queued song plays in the order it was queued, and nothing drops one before it plays.
  'queue-is-fifo-and-lossless': (seq) => {
    const expectedQueue = [];
    walk(seq, (a, before, after) => {
      if (a.type === 'enqueue') expectedQueue.push(a.song);
      if ((a.type === 'next' || a.type === 'end') && current(before) && expectedQueue.length) {
        const expected = expectedQueue.shift();
        if (!same(current(after).song, expected)) fail(`${a.type} played ${current(after).song.id}, expected ${expected.id}`);
      }
      if (!same(after.queue, expectedQueue)) fail(`after ${a.type} queue is [${after.queue.map((s) => s.id)}], expected [${expectedQueue.map((s) => s.id)}]`);
    });
  },

  // History is capped at 50, and the song a new one replaces is the newest entry.
  'history-is-bounded-and-newest-first': (seq) => {
    walk(seq, (a, before, after) => {
      if (after.history.length > 50) fail(`history grew to ${after.history.length}`);
      if (a.type === 'play' && current(before) && !same(after.history[0], current(before).song)) {
        fail(`play did not record ${current(before).song.id} as newest history`);
      }
    });
  },

  // Each new play gets its own player, even when the same song plays twice in a row.
  'new-play-gets-a-new-player': (seq) => {
    walk(seq, (a, before, after) => {
      const replaced = a.type === 'play' || (a.type === 'previous' && before.history.length > 0);
      if (replaced && current(before) && current(after).playId <= current(before).playId) {
        fail(`${a.type} kept playId ${current(after).playId}`);
      }
      if (a.type === 'toggle' && current(before) && current(after).playId !== current(before).playId) {
        fail('toggling play and pause replaced the player');
      }
    });
  },

  // When a video ends with an empty queue, the archive's next song plays, and the last song pauses.
  'end-of-video-continues-the-archive': (seq) => {
    walk(seq, (a, before, after) => {
      if (a.type !== 'end' || !current(before) || before.queue.length) return;
      const index = archive.findIndex((s) => s.id === current(before).song.id);
      const next = archive[index + 1];
      if (next && !same(current(after).song, next)) fail(`end after ${current(before).song.id} played ${current(after).song.id}, expected ${next.id}`);
      if (next && current(after).status !== 'Playing') fail('end did not keep playing');
      if (!next && current(after).status !== 'Paused') fail('end of the archive did not pause');
    });
  },

  // A page reload restores queue and history, and nothing starts playing on its own.
  'reload-restores-queue-and-history': (seq) => {
    const before = walk(seq, () => {});
    const after = S.restoreSaved(S.emptySetlist, Option.some(S.toPersistedJson(before)));
    if (!same(after.queue, before.queue)) fail('reload changed the queue');
    if (!same(after.history, before.history)) fail('reload changed the history');
    if (Option.isSome(after.maybeNowPlaying)) fail('reload resumed playback');
  },

  // Previous must not make the song that was playing unreachable.
  'previous-keeps-current-song': (seq) => {
    walk(seq, (a, before, after) => {
      if (a.type === 'previous' && current(before) && before.history.length) {
        const id = current(before).song.id;
        const reachable = [current(after)?.song, ...after.queue, ...after.history].some((s) => s?.id === id);
        if (!reachable) fail(`Previous from ${id} left it nowhere: not current, queued or in history`);
      }
    });
  },
};

async function checkProperty(name) {
    const result = await fc.check(
    fc.property(actions, (seq) => properties[name](seq)),
    { numRuns: RUNS, seed: 20261101, endOnFailure: false },
  );
  if (!result.failed) return { name, failed: false, runs: RUNS };
  const steps = result.counterexample[0].map((a) => (a.song ? `${a.type} ${a.song.id}` : a.type)).join(', ');
  return { name, failed: true, runs: RUNS, steps, why: result.errorInstance?.message ?? String(result.error) };
}

const MUTANTS = [
  { property: 'queue-is-fifo-and-lossless', from: 'modifyFields(setlist, { queue: queue => Array.drop(queue, 1) })', to: 'setlist' },
  { property: 'queue-is-fifo-and-lossless', from: 'Option.match(Array.head(setlist.queue), {', to: 'Option.match(Array.last(setlist.queue), {' },
  { property: 'queue-is-fifo-and-lossless', from: 'queue => [...queue, song]', to: 'queue => [song, ...queue]' },
  { property: 'history-is-bounded-and-newest-first', from: 'Array.take([nowPlaying.song, ...history], HISTORY_LIMIT)', to: '[nowPlaying.song, ...history]' },
  { property: 'history-is-bounded-and-newest-first', from: '[nowPlaying.song, ...history]', to: '[...history, nowPlaying.song]' },
  { property: 'new-play-gets-a-new-player', from: 'playCount: count => count + 1,', to: 'playCount: count => count,' },
  { property: 'end-of-video-continues-the-archive', from: 'Array.get(allSongs, index + 1)', to: 'Array.get(allSongs, index)' },
  { property: 'end-of-video-continues-the-archive', from: "onNone: () => setStatus(setlist, 'Paused'),\n    onSome: nextSong => play(setlist, nextSong),", to: 'onNone: () => setlist,\n    onSome: nextSong => play(setlist, nextSong),' },
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
  const known = onlyAt === -1 && KNOWN_FINDINGS.has(name);
  if (!r.failed && known) {
    console.log(`FIXED? ${name}: passes now. Remove it from KNOWN_FINDINGS.`);
    exit = 1;
  } else if (!r.failed) {
    console.log(`PASS ${name} (${r.runs} sequences)`);
  } else if (known) {
    console.log(`KNOWN FINDING ${name}\n  steps: ${r.steps}\n  why: ${r.why}`);
  } else {
    console.log(`FAIL ${name}\n  steps: ${r.steps}\n  why: ${r.why}`);
    exit = 1;
  }
}
process.exit(exit);
