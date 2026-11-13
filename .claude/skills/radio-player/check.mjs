#!/usr/bin/env node
// Exhaustive, bounded exploration of the real Fio Radio `update` in src/page/karaoke/karaoke.ts.
// A state is the page Model plus the Command results still on their way and what the YouTube player
// has done for the current play. Each step delivers one message the browser could deliver next.
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const KARAOKE = new URL('src/page/karaoke/karaoke.ts', root).href;
const YOUTUBE = new URL('src/youtube.ts', root).href;
const mutant = process.env.RADIO_MUTANT ? JSON.parse(process.env.RADIO_MUTANT) : undefined;

// karaoke.ts imports '../../api' and '../../youtube' without an extension, which Vite resolves and
// Node does not. The load hook swaps in a mutant's text at the real URL, so its imports resolve as usual.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, next) {
    const loaded = next(url, context);
    if (!mutant || url !== new URL(mutant.file, root).href) return loaded;
    return { ...loaded, source: String(loaded.source).replace(mutant.from, mutant.to) };
  },
});

const K = await import(KARAOKE);
const { PlayerEvent } = await import(YOUTUBE);
const { DateTime } = await import('effect');

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at > -1 ? args[at + 1] : undefined;
};
const DEPTH = Number(flag('--depth') ?? 6);
const LYRIC_DEPTH = Number(flag('--lyrics-depth') ?? 8);
const ONLY = flag('--only');
const QUEUE_MAX = 1;
const WALKS = Number(flag('--walks') ?? 300);
const WALK_LENGTH = 40;

// FIXTURE. One live stream with three songs, one live single-song video, one video the server
// already reports gone. Songs come in the server's order: by video, then by timestamp (server/db.ts).
const makeSong = (id, video, timestamp) => ({
  id, song_title: id, artist: '', original_title: '', version: '', note: '', timestamp, created_at: 'x',
  video_url: video, title_text: video, membership: false, published_at: DateTime.makeUnsafe(0), kind: 'karaoke',
});
const ARCHIVE = [
  makeSong('s1', 'stream', '00:01:00'),
  makeSong('s2', 'stream', '00:03:00'),
  makeSong('s3', 'stream', '00:05:00'),
  makeSong('solo', 'single', '00:00:30'),
  makeSong('duet', 'duet', '00:00:30'),
  makeSong('lost', 'gone', '00:00:30'),
];
const SERVER_GONE = ['gone'];
// A revisit refetches the archive, and this one learns that the single video was taken down.
const REFETCH_GONE = ['gone', 'single'];
const startOf = (song) => song.timestamp.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
// Each song's start and a point inside it, plus second 0, before the stream's first song.
const PLAYHEADS = { stream: [0, 60, 120, 180, 240, 300, 360], single: [30, 90], duet: [30, 90], gone: [30] };
// The lyrics scope needs a point inside each song and a point past the last song's end, which is its
// start plus six minutes because songs carry no duration: 660 for s3 and 390 for solo.
const LYRIC_PLAYHEADS = { stream: [70, 200, 400, 700], single: [40, 400], duet: [40], gone: [40] };
const LAST_SONG_SECONDS = 360;
const LYRIC_CLICKS = ['s1', 's3', 'solo'];

// ORACLE, worked out from the fixture alone, never from the module under test.
const songsOfVideo = (video) => ARCHIVE.filter((song) => song.video_url === video).sort((a, b) => startOf(a) - startOf(b));
const sungAt = (video, seconds) => songsOfVideo(video).filter((song) => startOf(song) <= seconds).at(-1);
const songAfter = (video, seconds) => songsOfVideo(video).find((song) => startOf(song) > seconds);
const songBefore = (song) => {
  const songs = songsOfVideo(song.video_url);
  return songs[songs.findIndex(({ id }) => id === song.id) - 1];
};
const lastStartOf = (video) => startOf(songsOfVideo(video).at(-1));
const endOf = (song) => {
  const next = songAfter(song.video_url, startOf(song));
  return next ? startOf(next) : startOf(song) + LAST_SONG_SECONDS;
};
const otherLiveFirstSongs = (video, gone) => {
  const seen = new Set();
  return ARCHIVE.filter((song) => {
    if (song.video_url === video || gone.has(song.video_url) || seen.has(song.video_url)) return false;
    seen.add(song.video_url);
    return true;
  });
};

// READING THE MODEL
const some = (option) => (option._tag === 'Some' ? option.value : undefined);
const nowOf = (model) => some(model.setlist.maybeNowPlaying);
const playheadOf = (model) => {
  const now = nowOf(model);
  const playhead = some(model.maybePlayhead);
  return now && playhead && playhead.playId === now.playId ? playhead.seconds : undefined;
};
const ids = (songs) => songs.map((song) => song.id).join(',');
const setlistKey = (model, base) => {
  const now = nowOf(model);
  return JSON.stringify([
    ids(model.setlist.queue), ids(model.setlist.history),
    now && [now.song.id, now.playId - base, now.phase, now.attempt],
  ]);
};
// A live play has a video that can sound. A gone play's stream is gone, and a failed load is neither.
const tagOf = (now) => now.phase._tag;
const isLive = (now) => ['Loading', 'Playing', 'Paused'].includes(tagOf(now));
const isGonePlay = (now) => ['MovingOn', 'Gone'].includes(tagOf(now));
const intentOf = (now) => (tagOf(now) === 'Loading' ? now.phase.intent : isLive(now) ? tagOf(now) : undefined);
const cannotSeek = (now) => !isLive(now);
// The song the bar names: the one sung at the playhead, or the clicked one.
const barSongOf = (model) => {
  const now = nowOf(model);
  const seconds = playheadOf(model);
  return (seconds === undefined ? undefined : sungAt(now.song.video_url, seconds)) ?? now.song;
};
const WAITS = [2, 4, 8];
// Where the play is: its last position, or the clicked song's start before the first one.
const positionOf = (model) => playheadOf(model) ?? startOf(nowOf(model).song);
const isBeforeEnd = (model, songId) => {
  const now = nowOf(model);
  const song = ARCHIVE.find(({ id }) => id === songId);
  return Boolean(now) && song.video_url === now.song.video_url && positionOf(model) < endOf(song);
};
// The song sung at the playhead and the one after it, the two whose lyrics the page wants.
const lyricWindowOf = (model) => {
  const seconds = playheadOf(model);
  const sung = seconds === undefined ? undefined : sungAt(nowOf(model).song.video_url, seconds);
  if (!sung) return [];
  const next = songAfter(sung.video_url, startOf(sung));
  return next ? [sung.id, next.id] : [sung.id];
};
const lyricsTagOf = (model, songId) => model.lyricsBySongId[songId]?._tag;
const goneOf = (model, env) => new Set([...model.goneVideoIds, ...env.failed]);
const named = (commands, name) => (commands ?? []).filter((command) => command.name === name);

// STATE. `pending` holds the Command results that change something when they arrive: random picks,
// toast timers, retry timers and load timeouts. A toast timer knows whether it is the newest one,
// because two toasts can share a dismissId. `env.loads` is the explorer's own count of the loads of the
// song on the bar since it last played.
// Every other Command's result message returns the model unchanged in `update`.
// Volume, layers and drags are left out: no setlist branch reads them. Lyrics fetches and their waits
// are pending only in the lyrics scope.
const keyOf = ({ model, env, pending, config }) => {
  const base = model.setlist.playCount;
  const waits = model.lyricsWaitCount;
  const lyrics = config.lyrics && Object.entries(model.lyricsBySongId).sort().map(([id, fetch]) => [id, fetch._tag, fetch.autoRetriesSpent, fetch.waitId === undefined ? null : waits - fetch.waitId]);
  const playhead = some(model.maybePlayhead);
  const toast = some(model.maybeSkipToast);
  return JSON.stringify([
    config, setlistKey(model, base), playhead && [playhead.playId - base, playhead.seconds],
    toast && [toast.firstSkippedTitle, toast.skippedCount, toast.dismissId - base],
    [...model.goneVideoIds].sort(), [...env.failed].sort(), env.phase, env.position, env.refetched, env.loads,
    pending.map((item) => JSON.stringify(item.kind === 'pick'
      ? [item.kind, item.playId - base, ids(item.candidates)]
      : item.kind === 'timer' ? [item.kind, item.dismissId - base, item.isNewest]
      : item.kind === 'lyricsFetch' ? [item.kind, item.songId]
      : item.kind === 'lyricsWait' ? [item.kind, item.songId, waits - item.waitId, item.isLive, item.wasPastEnd]
      : [item.kind, item.playId - base, item.delaySeconds])).sort(),
    lyrics,
  ]);
};

// TRANSITIONS: what the UI offers, what the YouTube player can report, and what Commands return.
const playerEvent = (playId, event, label) => ({ message: K.Message.ReceivedPlayerEvent({ playId, event }), label: `ReceivedPlayerEvent(playId ${playId}, ${label})`, kind: 'player', playId, event });

const MISSING_LYRICS = { _tag: 'Missing', reason: 'NotFound' };

// The lyrics scope keeps only what moves lyrics: plays of a few songs, seeks, position reports, the
// lyrics fetches and their waits, and the retry button, which the panel shows for a song that failed.
function lyricTransitions({ model, env, pending }) {
  const out = [];
  const now = nowOf(model);
  const user = (message, label) => out.push({ message, label, kind: 'user' });
  for (const id of LYRIC_CLICKS) user(K.Message.ClickedSong({ song: ARCHIVE.find((song) => song.id === id) }), `ClickedSong(${id})`);
  user(K.Message.ClickedNext(), 'ClickedNext');
  user(K.Message.ClickedPrevious(), 'ClickedPrevious');
  const sung = lyricWindowOf(model)[0];
  if (sung && ['Failed', 'GaveUp'].includes(lyricsTagOf(model, sung))) user(K.Message.ClickedRetryLyrics({ songId: sung }), `ClickedRetryLyrics(${sung})`);
  if (env.phase === 'fresh') out.push(playerEvent(now.playId, PlayerEvent.Ready(), 'Ready'));
  if (env.phase === 'loaded') {
    for (const seconds of LYRIC_PLAYHEADS[now.song.video_url]) {
      out.push(playerEvent(now.playId, PlayerEvent.Progressed({ seconds }), `Progressed ${seconds}s`));
    }
  }
  pending.forEach((item, index) => {
    if (item.kind === 'lyricsFetch') {
      out.push({ message: K.Message.SucceededFetchLyrics({ songId: item.songId, lyrics: MISSING_LYRICS }), label: `SucceededFetchLyrics(${item.songId})`, kind: 'lyricsResult', songId: item.songId, consumes: index });
      out.push({ message: K.Message.FailedFetchLyrics({ songId: item.songId, error: 'down' }), label: `FailedFetchLyrics(${item.songId})`, kind: 'lyricsResult', songId: item.songId, consumes: index });
    } else if (item.kind === 'lyricsWait') {
      out.push({ message: K.Message.CompletedWaitBeforeRetryLyrics({ songId: item.songId, waitId: item.waitId }), label: `CompletedWaitBeforeRetryLyrics(${item.songId}, wait ${item.waitId})`, kind: 'lyricsWait', wait: item, consumes: index });
    }
  });
  return out;
}

function transitions(state) {
  if (state.config.lyrics) return lyricTransitions(state);
  const { model, env, pending } = state;
  const out = [];
  const now = nowOf(model);
  const gone = new Set(model.goneVideoIds);
  const clickable = ARCHIVE.filter((song) => !gone.has(song.video_url));
  const user = (message, label) => out.push({ message, label, kind: 'user' });
  for (const song of clickable) user(K.Message.ClickedSong({ song }), `ClickedSong(${song.id})`);
  if (model.setlist.queue.length < QUEUE_MAX) {
    for (const song of clickable) user(K.Message.ClickedAddToQueue({ song }), `ClickedAddToQueue(${song.id})`);
  }
  if (model.setlist.queue.length > 0) {
    user(K.Message.ClickedQueuedSong({ index: 0 }), 'ClickedQueuedSong(0)');
    user(K.Message.ClickedRemoveFromQueue({ index: 0 }), 'ClickedRemoveFromQueue(0)');
  }
  // The middle button is Play/Pause for a live play and Retry for a failed load. A gone play has neither.
  if (now && isLive(now)) user(K.Message.ClickedPlayPause(), 'ClickedPlayPause');
  if (now && tagOf(now) === 'LoadFailed') user(K.Message.ClickedRetryLoad(), 'ClickedRetryLoad');
  if (now) {
    user(K.Message.ClickedNext(), 'ClickedNext');
    user(K.Message.ClickedPrevious(), 'ClickedPrevious');
  }
  if (some(model.maybeSkipToast)) user(K.Message.ClickedDismissToast(), 'ClickedDismissToast');
  if (!env.refetched && pending.some((item) => item.kind === 'pick')) {
    out.push({ message: K.Message.SucceededFetchSongs({ songs: ARCHIVE, goneVideoIds: REFETCH_GONE }), label: `SucceededFetchSongs(refetch, gone [${REFETCH_GONE}])`, kind: 'refetch' });
  }
  // The current play's events, in the order loadedVideoEvents in src/youtube.ts emits them: Ready first,
  // except that an error can come before it. The listener and its tick keep running after an error, so
  // a play that failed or is gone can still get every later event, and update must ignore them.
  const videoGone = () => playerEvent(now.playId, PlayerEvent.VideoGone(), 'VideoGone');
  const loadFailed = () => playerEvent(now.playId, PlayerEvent.LoadFailed({ reason: 'VideoUnplayable' }), 'LoadFailed');
  if (now && env.phase === 'fresh') {
    out.push(playerEvent(now.playId, PlayerEvent.Ready(), 'Ready'));
    out.push(videoGone());
    out.push(loadFailed());
  }
  if (now && env.phase === 'loaded') {
    out.push(playerEvent(now.playId, PlayerEvent.Playing(), 'Playing'));
    out.push(playerEvent(now.playId, PlayerEvent.Paused(), 'Paused'));
    out.push(videoGone());
    out.push(loadFailed());
    for (const seconds of PLAYHEADS[now.song.video_url]) {
      out.push(playerEvent(now.playId, PlayerEvent.Progressed({ seconds }), `Progressed ${seconds}s`));
    }
    // YouTube ends a video at its end, past the start of its last song.
    if (env.position !== undefined && env.position >= lastStartOf(now.song.video_url)) {
      out.push(playerEvent(now.playId, PlayerEvent.Ended(), 'Ended'));
    }
  }
  // A replaced player can still have any event on its way. Every older playId is treated alike by
  // update, which compares only with the current one, so one older playId stands for all of them.
  const stale = model.setlist.playCount - 1;
  if (stale >= 1) {
    for (const [event, label] of [[PlayerEvent.Ready(), 'Ready'], [PlayerEvent.Playing(), 'Playing'], [PlayerEvent.Paused(), 'Paused'], [PlayerEvent.Ended(), 'Ended'], [PlayerEvent.VideoGone(), 'VideoGone'], [PlayerEvent.LoadFailed({ reason: 'VideoUnplayable' }), 'LoadFailed'], [PlayerEvent.Progressed({ seconds: 180 }), 'Progressed 180s']]) {
      out.push(playerEvent(stale, event, label));
    }
  }
  pending.forEach((item, index) => {
    if (item.kind === 'pick') {
      for (const song of item.candidates) {
        out.push({ message: K.Message.CompletedPickRandomVideo({ playId: item.playId, song }), label: `CompletedPickRandomVideo(playId ${item.playId}, ${song.id})`, kind: 'pick', playId: item.playId, song, consumes: index });
      }
    } else if (item.kind === 'retry') {
      out.push({ message: K.Message.CompletedWaitBeforeRetryLoad({ playId: item.playId }), label: `CompletedWaitBeforeRetryLoad(playId ${item.playId})`, kind: 'retry', playId: item.playId, consumes: index });
    } else if (item.kind === 'loadTimeout') {
      out.push({ message: K.Message.CompletedWaitBeforeLoadTimeout({ playId: item.playId }), label: `CompletedWaitBeforeLoadTimeout(playId ${item.playId})`, kind: 'loadTimeout', playId: item.playId, consumes: index });
    } else {
      out.push({ message: K.Message.CompletedWaitBeforeDismissToast({ dismissId: item.dismissId }), label: `CompletedWaitBeforeDismissToast(${item.dismissId})`, kind: 'timer', dismissId: item.dismissId, isNewest: item.isNewest, consumes: index });
    }
  });
  return out;
}

function step(state, transition) {
  const result = K.update(state.model, transition.message);
  const model = result.model;
  const commands = result.commands ?? [];
  const isNewTimer = commands.some((command) => command.name === 'WaitBeforeDismissToast');
  let pending = state.pending
    .filter((_, index) => index !== transition.consumes)
    .map((item) => (isNewTimer && item.kind === 'timer' ? { ...item, isNewest: false } : item));
  if (state.config.lyrics) {
    // A wait stays live while no fetch or newer wait for its song has started and its song has never
    // been past its end since it started. Only a live wait may fetch.
    const restarted = new Set(commands.filter((command) => ['FetchLyrics', 'WaitBeforeRetryLyrics'].includes(command.name)).map((command) => command.args.songId));
    pending = pending.map((item) => {
      if (item.kind !== 'lyricsWait') return item;
      const wasPastEnd = item.wasPastEnd || !isBeforeEnd(model, item.songId);
      return { ...item, isLive: item.isLive && !restarted.has(item.songId) && !wasPastEnd, wasPastEnd };
    });
  }
  for (const command of commands) {
    if (command.name === 'FetchLyrics' && state.config.lyrics) pending.push({ kind: 'lyricsFetch', songId: command.args.songId });
    if (command.name === 'WaitBeforeRetryLyrics' && state.config.lyrics) pending.push({ kind: 'lyricsWait', ...command.args, isLive: true, wasPastEnd: false });
    if (state.config.lyrics) continue;
    if (command.name === 'PickRandomVideo') pending.push({ kind: 'pick', ...command.args });
    if (command.name === 'WaitBeforeDismissToast') pending.push({ kind: 'timer', dismissId: command.args.dismissId, isNewest: true });
    if (command.name === 'WaitBeforeRetryLoad') pending.push({ kind: 'retry', ...command.args });
    if (command.name === 'WaitBeforeLoadTimeout') pending.push({ kind: 'loadTimeout', ...command.args });
  }
  const before = nowOf(state.model);
  const after = nowOf(model);
  // update compares a timer's playId only with the current one, so the newest timer of an older play
  // stands for all of them. Without this, every play would leave its own load timeout in the state.
  for (const kind of ['retry', 'loadTimeout']) {
    const newestStale = pending.filter((item) => item.kind === kind && item.playId !== after?.playId).at(-1);
    pending = pending.filter((item) => item.kind !== kind || item.playId === after?.playId || item === newestStale);
  }
  let env = state.env;
  if (transition.kind === 'refetch') env = { ...env, refetched: true };
  if (transition.kind === 'player' && before && transition.playId === before.playId) {
    const tag = transition.event._tag;
    if (tag === 'Ready') env = { ...env, phase: 'loaded' };
    if (tag === 'Progressed') env = { ...env, position: transition.event.seconds };
    if (tag === 'VideoGone' && !isGonePlay(before)) env = { ...env, failed: [...new Set([...env.failed, before.song.video_url])] };
    // Sound proves the load worked, unless the stream is gone, where the page ignores the report.
    if (tag === 'Playing' && !isGonePlay(before)) env = { ...env, loads: 1 };
  }
  if (after && (!before || after.playId !== before.playId)) {
    const isRetry = transition.kind === 'retry' || transition.label === 'ClickedRetryLoad' || (transition.kind === 'user' && before && tagOf(before) === 'LoadFailed' && transition.label === `ClickedSong(${before.song.id})`);
    env = { ...env, phase: 'fresh', position: undefined, loads: isRetry ? env.loads + 1 : 1 };
  }
  return { model, env, pending, config: state.config, commands };
}

// PROPERTIES. Each looks at one step: the state before, the message, the state after and the Commands.
const isCurrent = (state, playId) => nowOf(state.model)?.playId === playId;
const startedNewPlay = (pre, post) => {
  const after = nowOf(post.model);
  return after && after.playId !== nowOf(pre.model)?.playId ? after : undefined;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSetlist = (pre, post) => setlistKey(pre.model, 0) === setlistKey(post.model, 0);

const PROPERTIES = {
  'stale-results-never-act': {
    promise: 'A player event, random pick, retry timer or load timeout for a play that is no longer current changes nothing and sends nothing.',
    check(pre, t, post) {
      if (!['player', 'pick', 'retry', 'loadTimeout'].includes(t.kind) || isCurrent(pre, t.playId)) return;
      if (!sameSetlist(pre, post)) return 'the setlist changed';
      if (!same(post.model.maybePlayhead, pre.model.maybePlayhead)) return 'the playhead moved';
      if (!same(post.model.goneVideoIds, pre.model.goneVideoIds)) return 'a video was marked gone';
      if (!same(post.model.maybeSkipToast, pre.model.maybeSkipToast)) return 'the skip toast changed';
      if (post.commands.length > 0) return `it sent ${post.commands.map((c) => c.name)}`;
    },
  },
  'next-plays-queue-then-stream-then-other-video': {
    promise: 'Next plays the queue head; with an empty queue it seeks to the next song of the stream after the playhead; with none, or when the play failed, it asks for a random first song of another live video.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (t.label !== 'ClickedNext' || !now) return;
      const queue = pre.model.setlist.queue;
      const seeks = named(post.commands, 'SeekPlayer');
      const picks = named(post.commands, 'PickRandomVideo');
      if (queue.length > 0) {
        const started = startedNewPlay(pre, post);
        if (started?.song.id !== queue[0].id) return `played ${started?.song.id ?? 'nothing new'}, not the queue head ${queue[0].id}`;
        if (seeks.length || picks.length) return 'it also sought or picked';
        return;
      }
      const seconds = playheadOf(pre.model);
      const failed = cannotSeek(now);
      if (!failed && (seconds === undefined || !sungAt(now.song.video_url, seconds))) return; // see next-and-previous-with-unknown-playhead
      const next = failed ? undefined : songAfter(now.song.video_url, seconds);
      if (!sameSetlist(pre, post)) return 'the setlist changed, so the video reloaded or the queue moved';
      if (next) {
        if (seeks.length !== 1 || seeks[0].args.seconds !== startOf(next)) return `expected SeekPlayer(${startOf(next)}) to ${next.id}, got ${JSON.stringify(seeks.map((c) => c.args))}`;
        if (picks.length) return 'it asked for a random video while the stream had a next song';
        return;
      }
      const expected = otherLiveFirstSongs(now.song.video_url, goneOf(pre.model, pre.env));
      if (seeks.length) return failed ? 'it sought in a video that failed' : 'it sought past the last song of the stream';
      if (expected.length === 0) return picks.length ? 'it asked for a random video with none left' : undefined;
      if (picks.length !== 1) return `expected one PickRandomVideo among ${ids(expected)}, got ${picks.length}`;
      const { playId, candidates } = picks[0].args;
      if (playId !== now.playId) return `the pick carries playId ${playId}, not the current ${now.playId}`;
      if (ids(candidates) !== ids(expected)) return `candidates ${ids(candidates)}, expected ${ids(expected)}`;
    },
  },
  'previous-seeks-in-stream-then-history': {
    promise: 'Previous seeks to the song before the one at the playhead in the same video, and otherwise, or when the play failed, plays the newest history song.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (t.label !== 'ClickedPrevious' || !now) return;
      const seconds = playheadOf(pre.model);
      const sung = seconds === undefined ? undefined : sungAt(now.song.video_url, seconds);
      const failed = cannotSeek(now);
      if (!sung && !failed) return; // see next-and-previous-with-unknown-playhead
      const seeks = named(post.commands, 'SeekPlayer');
      const before = failed ? undefined : songBefore(sung);
      if (before) {
        if (!sameSetlist(pre, post)) return 'the setlist changed, so the video reloaded';
        if (seeks.length !== 1 || seeks[0].args.seconds !== startOf(before)) return `expected SeekPlayer(${startOf(before)}) to ${before.id}`;
        return;
      }
      if (seeks.length) return failed ? 'it sought in a video that failed' : 'it sought before the first song of the video';
      const { history, queue } = pre.model.setlist;
      if (history.length === 0) return sameSetlist(pre, post) ? undefined : 'it changed the setlist with no history';
      const after = post.model.setlist;
      if (startedNewPlay(pre, post)?.song.id !== history[0].id) return `expected a new play of ${history[0].id}`;
      const expectedQueue = isGonePlay(now) ? queue : [now.song, ...queue];
      if (ids(after.queue) !== ids(expectedQueue)) return `queue ${ids(after.queue)}, expected ${ids(expectedQueue)}`;
      if (ids(after.history) !== ids(history.slice(1))) return 'history did not drop its newest song';
    },
  },
  'next-and-previous-with-unknown-playhead': {
    promise: 'Before a progress report, or with the playhead before the first song, Next and Previous still move within the stream from the song on the bar.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if ((t.label !== 'ClickedNext' && t.label !== 'ClickedPrevious') || !now || cannotSeek(now)) return;
      const seconds = playheadOf(pre.model);
      if (seconds !== undefined && sungAt(now.song.video_url, seconds)) return;
      if (t.label === 'ClickedNext' && pre.model.setlist.queue.length > 0) return;
      const from = seconds ?? startOf(now.song);
      const target = t.label === 'ClickedNext' ? songAfter(now.song.video_url, from) : seconds === undefined ? songBefore(now.song) : undefined;
      if (!target) return;
      const seeks = named(post.commands, 'SeekPlayer');
      if (seeks.length !== 1 || seeks[0].args.seconds !== startOf(target)) {
        const did = named(post.commands, 'PickRandomVideo').length ? 'asked for a random other video' : startedNewPlay(pre, post) ? `started ${startedNewPlay(pre, post).song.id}` : 'did not seek';
        return `the bar shows ${now.song.id} with the playhead ${seconds === undefined ? 'unknown' : `at ${seconds}s`}, and it ${did} instead of seeking to ${target.id}`;
      }
    },
  },
  'seek-never-reloads': {
    promise: 'A seek keeps the play and its video, and the playhead and sung song match the seek target.',
    check(pre, t, post) {
      const seeks = named(post.commands, 'SeekPlayer');
      if (seeks.length === 0) return;
      const before = nowOf(pre.model);
      const after = nowOf(post.model);
      if (!before || !after) return 'a seek with nothing playing';
      // The nowPlayingVideo subscription reloads the video when playId, video or start changes.
      if (after.playId !== before.playId || after.song.id !== before.song.id) return `the play changed from ${before.song.id}#${before.playId} to ${after.song.id}#${after.playId}, so the video reloads`;
      const seconds = seeks.at(-1).args.seconds;
      const playhead = some(post.model.maybePlayhead);
      if (!playhead || playhead.playId !== after.playId || playhead.seconds !== seconds) return `playhead ${JSON.stringify(playhead)}, expected ${seconds}s on play ${after.playId}`;
      const singing = some(K.nowSingingOf(post.model));
      if (singing?.segment.song.id !== sungAt(after.song.video_url, seconds)?.id) return `the bar names ${singing?.segment.song.id}, not the song at ${seconds}s`;
    },
  },
  'gone-video-never-auto-starts': {
    promise: 'A random pick never offers a gone or the current video, and an archive advance never starts a gone video.',
    check(pre, t, post) {
      const gone = goneOf(post.model, post.env);
      for (const pick of named(post.commands, 'PickRandomVideo')) {
        const video = nowOf(pre.model)?.song.video_url;
        const bad = pick.args.candidates.find((song) => gone.has(song.video_url) || song.video_url === video);
        if (bad) return `PickRandomVideo offers ${bad.id} of ${gone.has(bad.video_url) ? 'gone' : 'the current'} video ${bad.video_url}`;
      }
      // A queued song plays whatever its video, and a story test covers a queued gone song being skipped.
      // Repeat One and All replay the current song by the visitor's choice. Neither is an archive advance.
      const started = startedNewPlay(pre, post);
      // A failed video's songs leave the queue first, so the song played need not be the old head.
      const fromQueue = started && pre.model.setlist.queue.some((song) => song.id === started.song.id);
      const repeated = started && pre.config.repeat !== 'Off' && started.song.id === nowOf(pre.model)?.song.id;
      if (t.kind === 'player' && started && !fromQueue && !repeated && gone.has(started.song.video_url)) return `${t.label} started ${started.song.id} of gone video ${started.song.video_url}`;
    },
  },
  'gone-video-leaves-queue-and-history': {
    promise: 'Once YouTube reports a video gone, none of its songs stays in the queue or history, so nothing plays it again.',
    check(pre, t, post) {
      const failed = new Set(post.env.failed);
      const { queue, history } = post.model.setlist;
      const bad = [...queue, ...history].find((song) => failed.has(song.video_url));
      if (bad) return `${bad.id} of gone video ${bad.video_url} is in the ${queue.includes(bad) ? 'queue' : 'history'} after ${t.label}`;
    },
  },
  'pick-rechecks-gone-at-delivery': {
    promise: 'A random pick that arrives after its video became known gone does not start it.',
    check(pre, t, post) {
      const started = startedNewPlay(pre, post);
      if (t.kind === 'pick' && started && goneOf(pre.model, pre.env).has(started.song.video_url)) return `started ${started.song.id}, whose video ${started.song.video_url} was already known gone`;
    },
  },
  'player-reports-never-echo': {
    promise: "The player's own Playing, Paused, Progressed and LoadFailed reports send no ApplyPlayback back, and Ready sends only a pause, for a live play the visitor paused.",
    check(pre, t, post) {
      if (t.kind !== 'player' || !isCurrent(pre, t.playId)) return;
      const applied = named(post.commands, 'ApplyPlayback');
      const tag = t.event._tag;
      if (['Playing', 'Paused', 'Progressed', 'LoadFailed'].includes(tag) && applied.length) return `${tag} sent ApplyPlayback(${applied[0].args.isPlaying})`;
      if (tag === 'Ready') {
        const shouldPause = intentOf(nowOf(pre.model)) === 'Paused';
        if (applied.length !== (shouldPause ? 1 : 0) || applied.some((c) => c.args.isPlaying)) return `Ready on a ${tagOf(nowOf(pre.model))} play sent ${JSON.stringify(applied.map((c) => c.args))}`;
      }
    },
  },
  'play-pause-reaches-the-player': {
    promise: 'Play/Pause on a live play flips what the visitor wants and tells the player the new state.',
    check(pre, t, post) {
      const before = nowOf(pre.model);
      if (t.label !== 'ClickedPlayPause' || !before) return;
      const after = nowOf(post.model);
      const applied = named(post.commands, 'ApplyPlayback');
      if (intentOf(after) === intentOf(before)) return 'what the visitor wants did not change';
      if (applied.length !== 1 || applied[0].args.isPlaying !== (intentOf(after) === 'Playing')) return `sent ${JSON.stringify(applied.map((c) => c.args))} for ${intentOf(after)}`;
    },
  },
  'end-of-stream-does-not-replay-it': {
    promise: 'When a video ends, with nothing queued and repeat off, the radio does not start that video again.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (t.kind !== 'player' || t.event._tag !== 'Ended' || !isCurrent(pre, t.playId)) return;
      if (pre.config.repeat !== 'Off' || pre.model.setlist.queue.length > 0) return;
      const started = startedNewPlay(pre, post);
      if (started?.song.video_url === now.song.video_url) return `the video ${now.song.video_url} ended at ${pre.env.position}s, past ${sungAt(now.song.video_url, pre.env.position).id}, and the radio started ${started.song.id} of it again`;
    },
  },
  'ended-never-stalls': {
    promise: 'After the video of a live play ends, a new play starts or a random pick is on its way; it pauses only when nothing may follow.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (t.kind !== 'player' || t.event._tag !== 'Ended' || !isCurrent(pre, t.playId) || !isLive(now)) return;
      if (startedNewPlay(pre, post)) return;
      const picks = named(post.commands, 'PickRandomVideo');
      if (picks.length === 1 && picks[0].args.playId === now.playId) return;
      const after = nowOf(post.model);
      const others = otherLiveFirstSongs(now.song.video_url, goneOf(pre.model, pre.env));
      const nothingFollows = pre.config.repeat === 'Off' && pre.model.setlist.queue.length === 0 && (!pre.config.isAutoplay || others.length === 0);
      if (intentOf(after) !== 'Paused') return 'nothing new started and it did not pause';
      if (!nothingFollows) return `it paused, though ${pre.model.setlist.queue.length ? 'the queue' : others.length ? `other live videos (${ids(others)})` : 'repeat'} could follow`;
    },
  },
  'skip-toast-always-clears': {
    promise: 'A skip toast always has its own timer on the way, and an older timer never hides a newer toast.',
    check(pre, t, post) {
      const toast = some(post.model.maybeSkipToast);
      const changed = !same(post.model.maybeSkipToast, pre.model.maybeSkipToast);
      if (toast && changed && !named(post.commands, 'WaitBeforeDismissToast').some((c) => c.args.dismissId === toast.dismissId)) return `${t.label} showed toast ${JSON.stringify(toast)} without starting its timer`;
      if (toast && !post.pending.some((item) => item.kind === 'timer' && item.isNewest && item.dismissId === toast.dismissId)) return `toast ${JSON.stringify(toast)} has no timer of its own on the way, so it never clears`;
      if (t.kind === 'timer' && !t.isNewest && some(pre.model.maybeSkipToast) && changed) return `an older timer (${t.dismissId}) hid the newer toast ${JSON.stringify(some(pre.model.maybeSkipToast))}`;
    },
  },
  'load-failure-never-marks-a-stream-gone': {
    promise: 'A load that failed, by an error or by its timeout, stays on its song and changes nothing else: no video is marked gone, and the queue, the history and the toast stay.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      const isFailure = (t.kind === 'player' && t.event._tag === 'LoadFailed') || t.kind === 'loadTimeout';
      if (!isFailure || !now || !isCurrent(pre, t.playId)) return;
      const after = nowOf(post.model);
      if (!same(post.model.goneVideoIds, pre.model.goneVideoIds)) return `it marked ${post.model.goneVideoIds.filter((id) => !pre.model.goneVideoIds.includes(id))} gone`;
      if (after.playId !== now.playId || after.song.id !== now.song.id) return `the play changed to ${after.song.id}#${after.playId}`;
      if (ids(post.model.setlist.queue) !== ids(pre.model.setlist.queue) || ids(post.model.setlist.history) !== ids(pre.model.setlist.history)) return 'the queue or history changed';
      if (!same(post.model.maybeSkipToast, pre.model.maybeSkipToast)) return 'a skip toast appeared';
      if (named(post.commands, 'PickRandomVideo').length) return 'it asked for another video';
      const fails = isLive(now) && (t.kind === 'player' || tagOf(now) === 'Loading');
      if (fails && tagOf(after) !== 'LoadFailed') return `the play is ${tagOf(after)}, not LoadFailed`;
      if (!fails && !same(after, now)) return `a ${tagOf(now)} play changed`;
    },
  },
  'retry-reloads-the-song-on-the-bar': {
    promise: 'A retry of a failed load, by its timer, the Retry button or a click on the song, starts a new play of the song the bar names, or of the clicked song, as the next attempt, with its own load timeout, and leaves the queue and history alone. A timer for a play that is no longer failed does nothing.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (!now) return;
      const isRetry = (t.kind === 'retry' && isCurrent(pre, t.playId)) || t.label === 'ClickedRetryLoad' || (tagOf(now) === 'LoadFailed' && t.label === `ClickedSong(${now.song.id})`);
      if (!isRetry) return;
      const after = nowOf(post.model);
      if (tagOf(now) !== 'LoadFailed') {
        if (!sameSetlist(pre, post) || post.commands.length) return `a retry timer changed a ${tagOf(now)} play`;
        return;
      }
      const expected = t.label.startsWith('ClickedSong') ? now.song : barSongOf(pre.model);
      if (after.playId <= now.playId) return 'the playId stayed, so the video does not reload';
      if (after.song.id !== expected.id) return `it loaded ${after.song.id}, and the bar named ${expected.id}`;
      if (tagOf(after) !== 'Loading') return `the new play is ${tagOf(after)}`;
      if (after.attempt !== now.attempt + 1) return `attempt went from ${now.attempt} to ${after.attempt}`;
      if (ids(post.model.setlist.queue) !== ids(pre.model.setlist.queue) || ids(post.model.setlist.history) !== ids(pre.model.setlist.history)) return 'the queue or history changed';
      const timeouts = named(post.commands, 'WaitBeforeLoadTimeout');
      if (timeouts.length !== 1 || timeouts[0].args.playId !== after.playId) return 'the new play has no load timeout of its own';
    },
  },
  'manual-retry-never-shortens-the-next-automatic-wait': {
    promise: 'A failed load waits 2, 4, then 8 seconds by the count of loads since the song last played, whoever started them, and then waits for nothing. A retry itself starts no wait, so a manual Retry neither restarts nor shortens the schedule.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      const waits = named(post.commands, 'WaitBeforeRetryLoad');
      const after = nowOf(post.model);
      const failedNow = now && after && isLive(now) && after.playId === now.playId && tagOf(after) === 'LoadFailed';
      if (!failedNow) return waits.length ? `${t.label} started a retry wait of ${waits[0].args.delaySeconds}s without a failed load` : undefined;
      const expected = WAITS[pre.env.loads - 1];
      const got = waits.map((c) => c.args.delaySeconds);
      if (expected === undefined) return got.length ? `load ${pre.env.loads} failed and still waits ${got}s to retry` : undefined;
      if (got.length !== 1 || got[0] !== expected || waits[0].args.playId !== now.playId) return `load ${pre.env.loads} failed and waits [${got}]s for play ${waits[0]?.args.playId}, expected ${expected}s for play ${now.playId}`;
    },
  },
  'moving-on-always-resolves': {
    promise: 'A gone stream that is moving on always has a random pick for it on the way, and that pick starts another video or leaves the stream Gone. A gone play never becomes playable again.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      const after = nowOf(post.model);
      if (after && tagOf(after) === 'MovingOn' && !post.pending.some((item) => item.kind === 'pick' && item.playId === after.playId)) return `${t.label} left the play moving on with no pick on the way`;
      if (now && after && isGonePlay(now) && after.playId === now.playId && !isGonePlay(after)) return `${t.label} turned a ${tagOf(now)} play into ${tagOf(after)}`;
    },
  },
  'loading-always-ends': {
    promise: 'A play that is loading always has its load timeout on the way, and that timeout fails the load.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      const after = nowOf(post.model);
      if (after && tagOf(after) === 'Loading' && !post.pending.some((item) => item.kind === 'loadTimeout' && item.playId === after.playId)) return `${t.label} left play ${after.playId} loading with no load timeout on the way`;
      if (t.kind === 'loadTimeout' && now && isCurrent(pre, t.playId) && tagOf(now) === 'Loading' && tagOf(after) !== 'LoadFailed') return `the timeout left the play ${tagOf(after)}`;
    },
  },
  'failed-play-ignores-player-reports': {
    promise: 'A gone play ignores everything its player still reports. A failed load ignores everything but a gone video and a video that starts playing late.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (t.kind !== 'player' || !now || !isCurrent(pre, t.playId) || isLive(now)) return;
      const tag = t.event._tag;
      if (tagOf(now) === 'LoadFailed' && (tag === 'VideoGone' || tag === 'Playing')) return;
      if (!sameSetlist(pre, post)) return `${tag} changed a ${tagOf(now)} play`;
      if (!same(post.model.maybePlayhead, pre.model.maybePlayhead)) return `${tag} moved the playhead of a ${tagOf(now)} play`;
      if (!same(post.model.goneVideoIds, pre.model.goneVideoIds) || !same(post.model.maybeSkipToast, pre.model.maybeSkipToast)) return `${tag} on a ${tagOf(now)} play marked a video gone or showed a toast`;
      if (post.commands.length) return `${tag} on a ${tagOf(now)} play sent ${post.commands.map((c) => c.name)}`;
    },
  },
  'no-lyrics-retry-after-the-songs-end': {
    promise: "Automatic lyrics retries stop once the playhead passes the song's end in video time, or another video plays. A wait for such a song never fetches, even if the song comes back, and no failed song is left waiting past its end.",
    check(pre, t, post) {
      const fetched = named(post.commands, 'FetchLyrics').map((command) => command.args.songId);
      const waited = named(post.commands, 'WaitBeforeRetryLyrics').map((command) => command.args.songId);
      if (t.kind === 'lyricsWait' && t.wait.wasPastEnd && fetched.length) return `a wait for ${t.wait.songId}, whose song went past its end, fetched ${fetched}`;
      const late = waited.find((songId) => !isBeforeEnd(post.model, songId));
      if (late) return `a failed fetch of ${late} started a wait past its end`;
      const stuck = Object.keys(post.model.lyricsBySongId).find((songId) => lyricsTagOf(post.model, songId) === 'Failed' && !isBeforeEnd(post.model, songId));
      if (stuck) return `${stuck} is still waiting to retry past its end`;
    },
  },
  'lyrics-retry-continues-until-the-songs-end': {
    promise: "Every failed song has its own retry wait on the way, and that wait fetches again while the playhead is before the song's end, whether or not the song is sung or next.",
    check(pre, t, post) {
      if (t.kind === 'lyricsWait' && t.wait.isLive) {
        const fetched = named(post.commands, 'FetchLyrics').map((command) => command.args.songId);
        if (fetched.join() !== t.wait.songId) return `the live wait for ${t.wait.songId} fetched [${fetched}]`;
      }
      const orphan = Object.keys(post.model.lyricsBySongId).find((songId) => lyricsTagOf(post.model, songId) === 'Failed' && !post.pending.some((item) => item.kind === 'lyricsWait' && item.songId === songId && item.isLive));
      if (orphan) return `${orphan} failed with no live wait on the way, so it never retries`;
    },
  },
  'replaying-a-song-fetches-its-lyrics-again': {
    promise: 'A song that comes back into the sung-or-next pair, by a position report, a seek or a new play, has its lyrics loaded or being fetched, even after its retries gave up.',
    check(pre, t, post) {
      const before = nowOf(pre.model)?.playId === nowOf(post.model)?.playId ? lyricWindowOf(pre.model) : [];
      const entered = lyricWindowOf(post.model).filter((songId) => !before.includes(songId));
      const left = entered.find((songId) => !['Loading', 'Loaded'].includes(lyricsTagOf(post.model, songId)));
      if (left) return `${left} came back into the window as ${lyricsTagOf(post.model, left) ?? 'never fetched'}`;
    },
  },
  'stale-lyrics-timer-changes-nothing': {
    promise: 'A lyrics retry wait that a retry, a newer failure or a give-up replaced changes no lyrics and sends nothing.',
    check(pre, t, post) {
      if (t.kind !== 'lyricsWait' || t.wait.isLive) return;
      if (post.commands.length) return `the stale wait for ${t.wait.songId} sent ${post.commands.map((c) => c.name)}`;
      if (!same(post.model.lyricsBySongId, pre.model.lyricsBySongId) || post.model.lyricsWaitCount !== pre.model.lyricsWaitCount) return `the stale wait for ${t.wait.songId} changed the lyrics`;
    },
  },
  'setlist-change-is-saved': {
    promise: 'Every change to the queue or history saves exactly what the page now shows, so a reload restores it.',
    check(pre, t, post) {
      const { queue, history } = post.model.setlist;
      if (ids(queue) === ids(pre.model.setlist.queue) && ids(history) === ids(pre.model.setlist.history)) return;
      const saves = named(post.commands, 'SaveSetlist');
      const saved = saves.length ? JSON.parse(saves.at(-1).args.json).state : undefined;
      if (!saved || ids(saved.queue) !== ids(queue) || ids(saved.history) !== ids(history)) return `queue [${ids(queue)}] history [${ids(history)}] but saved ${saved ? `[${ids(saved.queue)}] [${ids(saved.history)}]` : 'nothing'}`;
    },
  },
};

// Properties the current code breaks. Each is a finding, reported on every run, and does not fail the run.
// Remove a name once the code is fixed and the property passes.
const KNOWN_FINDINGS = new Set();

// The last config is the lyrics scope. Lyrics read no setting, so it runs with one.
const CONFIGS = [
  ...[true, false].flatMap((isAutoplay) => ['Off', 'All', 'One'].map((repeat) => ({ isAutoplay, repeat }))),
  { isAutoplay: false, repeat: 'Off', lyrics: true },
];
const configLabel = ({ isAutoplay, repeat, lyrics }) => `${lyrics ? 'lyrics scope, ' : ''}autoplay ${isAutoplay ? 'on' : 'off'}, repeat ${repeat}`;

function initialState(config) {
  const { isAutoplay, repeat } = config;
  const fetched = K.update(K.init(), K.Message.SucceededFetchSongs({ songs: ARCHIVE, goneVideoIds: SERVER_GONE })).model;
  const state = { model: { ...fetched, isAutoplay, repeat }, env: { phase: 'none', position: undefined, failed: [], refetched: false, loads: 1 }, pending: [], config };
  if (!config.lyrics) return state;
  // The lyrics scope starts with s1 clicked and its video ready, so its depth goes to lyrics.
  const clicked = step(state, { message: K.Message.ClickedSong({ song: ARCHIVE[0] }), label: 'ClickedSong(s1)', kind: 'user' });
  return step(clicked, playerEvent(1, PlayerEvent.Ready(), 'Ready'));
}

const LYRIC_PROPERTIES = new Set(['no-lyrics-retry-after-the-songs-end', 'lyrics-retry-continues-until-the-songs-end', 'replaying-a-song-fetches-its-lyrics-again', 'stale-lyrics-timer-changes-nothing']);
const belongsTo = (name, config) => LYRIC_PROPERTIES.has(name) === Boolean(config.lyrics);

const checkStep = (names, found, pre, transition, post, traceOf) => {
  for (const name of names) {
    if (found.has(name) || !belongsTo(name, pre.config)) continue;
    const why = PROPERTIES[name].check(pre, transition, post);
    if (why) found.set(name, { why, steps: traceOf() });
  }
};

// Breadth-first over every reachable state of one config up to DEPTH steps, so each trace is a shortest one.
function explore(config, names) {
  const keys = new Set();
  const parent = [-1];
  const label = [configLabel(config)];
  const found = new Map();
  const state = initialState(config);
  keys.add(keyOf(state));
  let frontier = [{ state, id: 0 }];
  let steps = 0;
  const traceOf = (id) => {
    const trace = [];
    for (let at = id; at !== -1; at = parent[at]) trace.unshift(label[at]);
    return trace;
  };
  const scoped = names.filter((name) => belongsTo(name, config));
  const bound = config.lyrics ? LYRIC_DEPTH : DEPTH;
  for (let depth = 0; depth < bound && frontier.length && found.size < scoped.length; depth++) {
    const next = [];
    for (const { state: pre, id } of frontier) {
      for (const transition of transitions(pre)) {
        const post = step(pre, transition);
        steps++;
        checkStep(names, found, pre, transition, post, () => [...traceOf(id), transition.label]);
        const key = keyOf(post);
        if (keys.has(key)) continue;
        keys.add(key);
        parent.push(id);
        label.push(transition.label);
        next.push({ state: post, id: parent.length - 1 });
      }
    }
    frontier = next;
  }
  return { found, states: keys.size, steps };
}

// Past the exhaustive bound, seeded random walks reach long histories and repeated skips. They sample;
// they do not cover. A walk's trace is not the shortest.
function walk(config, names, seed) {
  let x = seed >>> 0;
  const random = () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const found = new Map();
  let steps = 0;
  const scoped = names.filter((name) => belongsTo(name, config));
  for (let w = 0; w < WALKS && found.size < scoped.length; w++) {
    let state = initialState(config);
    const trace = [configLabel(config)];
    for (let i = 0; i < WALK_LENGTH; i++) {
      const options = transitions(state);
      const transition = options[Math.floor(random() * options.length)];
      const post = step(state, transition);
      steps++;
      trace.push(transition.label);
      checkStep(names, found, state, transition, post, () => [...trace]);
      state = post;
    }
  }
  return { found, steps };
}

// MUTANTS: broken copies of the real code. Each must make its property fail.
const MUTANTS = [
  { property: "stale-results-never-act", file: "src/page/karaoke/karaoke.ts", from: "CompletedPickRandomVideo: ({ playId, song }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          nowPlaying => nowPlaying.playId === playId,", to: "CompletedPickRandomVideo: ({ playId, song }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          () => true," },
  { property: 'stale-results-never-act', file: 'src/page/karaoke/karaoke.ts', from: 'ReceivedPlayerEvent: ({ playId, event }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          nowPlaying => nowPlaying.playId === playId,', to: 'ReceivedPlayerEvent: ({ playId, event }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          () => true,' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/karaoke.ts', from: 'ClickedNext: () =>\n      Array.isReadonlyArrayNonEmpty(model.setlist.queue)\n        ? changeSetlist(model, playNext(model.setlist, model.repeat))\n        : seekBeside(model, 1, () =>', to: 'ClickedNext: () =>\n      false\n        ? changeSetlist(model, playNext(model.setlist, model.repeat))\n        : seekBeside(model, 1, () =>' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/setlist.ts', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => !isGone(song),' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/karaoke.ts', from: ': seekBeside(model, 1, () =>', to: ': seekBeside(model, -1, () =>' },
  { property: "next-plays-queue-then-stream-then-other-video", file: "src/page/karaoke/karaoke.ts", from: "onNonEmpty: candidates => ({\n          model,\n          commands: [PickRandomVideo({ playId, candidates })],", to: "onNonEmpty: candidates => ({\n          model,\n          commands: [PickRandomVideo({ playId: playId + 1, candidates })]," },
  { property: 'previous-seeks-in-stream-then-history', file: 'src/page/karaoke/karaoke.ts', from: 'seekBeside(model, -1, () =>', to: 'seekBeside(model, 1, () =>' },
  { property: 'previous-seeks-in-stream-then-history', file: 'src/page/karaoke/karaoke.ts', from: 'ClickedPrevious: () =>\n      seekBeside(model, -1, () =>\n        changeSetlist(model, playPrevious(model.setlist)),\n      ),', to: 'ClickedPrevious: () => changeSetlist(model, playPrevious(model.setlist)),' },
  { property: 'next-and-previous-with-unknown-playhead', file: 'src/lyrics.ts', from: 'onNone: () =>\n      Array.findFirstIndex(spans, ({ song }) => song.id === playing.id),', to: 'onNone: () => Option.none(),' },
  { property: 'next-and-previous-with-unknown-playhead', file: 'src/lyrics.ts', from: '        () => -1,\n', to: '        () => -2,\n' },
  { property: "next-plays-queue-then-stream-then-other-video", file: "src/page/karaoke/karaoke.ts", from: "        Option.isSome(intentOf(phase)),\n      ),\n      nowPlaying =>", to: "        true,\n      ),\n      nowPlaying =>" },
  { property: 'seek-never-reloads', file: 'src/page/karaoke/karaoke.ts', from: '          model: moved.model,\n          commands: [...(moved.commands ?? []), SeekPlayer({ seconds })],', to: '          model: modifyFields(moved.model, { setlist: setlist => play(setlist, song) }),\n          commands: [...(moved.commands ?? []), SeekPlayer({ seconds })],' },
  { property: 'seek-never-reloads', file: 'src/page/karaoke/karaoke.ts', from: 'const moved = progressed(model, nowPlaying.playId, seconds)', to: 'const moved = { model }' },
  { property: 'gone-video-never-auto-starts', file: 'src/page/karaoke/setlist.ts', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => song.video_url !== current.video_url,' },
  { property: 'gone-video-never-auto-starts', file: 'src/page/karaoke/karaoke.ts', from: 'isGone: song => goneIds.has(song.video_url),', to: 'isGone: () => false,' },
  { property: "gone-video-never-auto-starts", file: "src/page/karaoke/karaoke.ts", from: "goneVideoIds: known => Array.dedupe([...known, goneSong.video_url]),", to: "goneVideoIds: known => known," },
  { property: "gone-video-leaves-queue-and-history", file: "src/page/karaoke/setlist.ts", from: "isStreamGone(phase) ? Option.none() : Option.some(song),", to: "Option.some(song)," },
  { property: "gone-video-leaves-queue-and-history", file: "src/page/karaoke/setlist.ts", from: "const cleaned = changePhase(", to: "const cleaned = (setlist => setlist)(" },
  { property: 'pick-rechecks-gone-at-delivery', file: 'src/page/karaoke/karaoke.ts', from: 'if (continuationOf(model).isGone(song)) {', to: 'if (false) {' },
  { property: "player-reports-never-echo", file: "src/page/karaoke/karaoke.ts", from: "Playing: () =>\n                    recordFromPlayer(model, reportPlaying(model.setlist)),", to: "Playing: () =>\n                    changeSetlist(model, reportPlaying(model.setlist))," },
  { property: "player-reports-never-echo", file: "src/page/karaoke/karaoke.ts", from: "Paused: () =>\n                    recordFromPlayer(model, reportPaused(model.setlist)),", to: "Paused: () =>\n                    changeSetlist(model, reportPaused(model.setlist))," },
  { property: "player-reports-never-echo", file: "src/page/karaoke/karaoke.ts", from: "intent === 'Paused'\n                        ? [\n                            ApplyPlayback({ isPlaying: false }),", to: "intent === 'Playing'\n                        ? [\n                            ApplyPlayback({ isPlaying: false })," },
  { property: "play-pause-reaches-the-player", file: "src/page/karaoke/karaoke.ts", from: "Option.contains(intentOf(before.phase), intent)\n              ? Option.none()", to: "true\n              ? Option.none()" },
  { property: 'end-of-stream-does-not-replay-it', file: 'src/page/karaoke/setlist.ts', from: 'onSome: ({ song }) => planFromArchive(continuation, song),', to: 'onSome: () => Advance.Replay(),' },
  { property: "ended-never-stalls", file: "src/page/karaoke/karaoke.ts", from: "PickRandomVideo: ({ candidates }) => ({\n                          model,\n                          commands: [PickRandomVideo({ playId, candidates })],", to: "PickRandomVideo: ({ candidates }) => ({\n                          model,\n                          commands: []," },
  { property: 'ended-never-stalls', file: 'src/page/karaoke/setlist.ts', from: '  continuation.isAutoplay\n    ? Array.match(', to: '  !continuation.isAutoplay\n    ? Array.match(' },
  { property: 'skip-toast-always-clears', file: 'src/page/karaoke/karaoke.ts', from: 'Option.filter(maybeToast, toast => toast.dismissId !== dismissId)', to: 'Option.none()' },
  { property: 'skip-toast-always-clears', file: 'src/page/karaoke/karaoke.ts', from: 'const dismissId = setlist.playCount\n', to: 'const dismissId = setlist.playCount - 1\n' },
  { property: 'skip-toast-always-clears', file: 'src/page/karaoke/karaoke.ts', from: '                  commands: [\n                    saveSetlist,\n                    WaitBeforeDismissToast({ dismissId }),\n                  ],', to: '                  commands: [saveSetlist],' },
  { property: "setlist-change-is-saved", file: "src/page/karaoke/karaoke.ts", from: "commands: [saveSetlist, PickRandomVideo({ playId, candidates })],", to: "commands: [PickRandomVideo({ playId, candidates })]," },
  { property: "setlist-change-is-saved", file: "src/page/karaoke/karaoke.ts", from: ": {\n                  model: modifyFields(model, { setlist: () => setlist }),\n                  commands: [saveSetlist],", to: ": {\n                  model: modifyFields(model, { setlist: () => setlist }),\n                  commands: []," },
  { property: "stale-results-never-act", file: "src/page/karaoke/karaoke.ts", from: "CompletedWaitBeforeRetryLoad: ({ playId }) =>\n      Option.match(currentPlay(model, playId), {", to: "CompletedWaitBeforeRetryLoad: ({ playId }) =>\n      Option.match(model.setlist.maybeNowPlaying, {" },
  { property: "stale-results-never-act", file: "src/page/karaoke/karaoke.ts", from: "CompletedWaitBeforeLoadTimeout: ({ playId }) =>\n      Option.match(currentPlay(model, playId), {", to: "CompletedWaitBeforeLoadTimeout: ({ playId }) =>\n      Option.match(model.setlist.maybeNowPlaying, {" },
  { property: "load-failure-never-marks-a-stream-gone", file: "src/page/karaoke/karaoke.ts", from: "LoadFailed: ({ reason }) =>\n                    failCurrentLoad(model, nowPlaying, reason),", to: "LoadFailed: () => skipGoneVideo(model, nowPlaying)," },
  { property: "load-failure-never-marks-a-stream-gone", file: "src/page/karaoke/karaoke.ts", from: "? failCurrentLoad(model, nowPlaying, 'PlayerUnavailable')", to: "? skipGoneVideo(model, nowPlaying)" },
  { property: "load-failure-never-marks-a-stream-gone", file: "src/page/karaoke/setlist.ts", from: "onSome: intent => Phase.LoadFailed({ reason, intent }),", to: "onSome: () => Phase.Gone()," },
  { property: "retry-reloads-the-song-on-the-bar", file: "src/page/karaoke/karaoke.ts", from: "retryLoad(setlist, songOnBar(model, nowPlaying), by),", to: "retryLoad(setlist, nowPlaying.song, by)," },
  { property: "retry-reloads-the-song-on-the-bar", file: "src/page/karaoke/setlist.ts", from: "playId: setlist.playCount + 1,\n                  phase: Phase.Loading({", to: "playId: setlist.playCount,\n                  phase: Phase.Loading({" },
  { property: "retry-reloads-the-song-on-the-bar", file: "src/page/karaoke/setlist.ts", from: "LoadFailed: ({ intent }) =>\n            modifyFields(setlist, {", to: "LoadFailed: ({ intent }) =>\n            modifyFields(play(setlist, song), {" },
  { property: "manual-retry-never-shortens-the-next-automatic-wait", file: "src/page/karaoke/karaoke.ts", from: "ClickedRetryLoad: () => retryCurrentLoad(model, 'Visitor'),", to: "ClickedRetryLoad: () => {\n      const retried = retryCurrentLoad(model, 'Visitor')\n      return { model: modifyFields(retried.model, { setlist: setlist => modifyFields(setlist, { maybeNowPlaying: Option.map(nowPlaying => ({ ...nowPlaying, attempt: 1 })) }) }) }\n    }," },
  { property: "manual-retry-never-shortens-the-next-automatic-wait", file: "src/page/karaoke/setlist.ts", from: "attempt: attempt + 1,", to: "attempt: 1," },
  { property: "manual-retry-never-shortens-the-next-automatic-wait", file: "src/page/karaoke/setlist.ts", from: "attempt <= MAX_AUTO_LOAD_RETRIES ? Option.some", to: "true ? Option.some" },
  { property: "manual-retry-never-shortens-the-next-automatic-wait", file: "src/page/karaoke/karaoke.ts", from: "Option.map(loadRetryDelaySeconds(attempt), delaySeconds =>", to: "Option.map(loadRetryDelaySeconds(1), delaySeconds =>" },
  { property: "moving-on-always-resolves", file: "src/page/karaoke/karaoke.ts", from: ": { model: modifyFields(model, { setlist: settleGone }) },", to: ": { model }," },
  { property: "moving-on-always-resolves", file: "src/page/karaoke/karaoke.ts", from: "commands: [saveSetlist, PickRandomVideo({ playId, candidates })],", to: "commands: [saveSetlist]," },
  { property: "loading-always-ends", file: "src/page/karaoke/karaoke.ts", from: "          WaitBeforeLoadTimeout({ playId }),\n        ],", to: "        ]," },
  { property: "loading-always-ends", file: "src/page/karaoke/karaoke.ts", from: "nowPlaying.phase._tag === 'Loading'\n            ? failCurrentLoad", to: "false\n            ? failCurrentLoad" },
  { property: "failed-play-ignores-player-reports", file: "src/page/karaoke/karaoke.ts", from: "                      () => ({ model }),\n                    )\n                  : { model },", to: "                      () => progressed(model, playId, 0),\n                    )\n                  : { model }," },
  { property: "failed-play-ignores-player-reports", file: "src/page/karaoke/karaoke.ts", from: "                      () => ({ model }),\n                    )\n                  : { model },", to: "                      () => ({ model }),\n                    )\n                  : progressed(model, playId, 0)," },
  { property: "no-lyrics-retry-after-the-songs-end", file: "src/page/karaoke/karaoke.ts", from: "LyricsFetch.guards.Failed(fetch) && !isBeforeSongEnd(model, songId)", to: "LyricsFetch.guards.Failed(fetch) && false" },
  { property: "no-lyrics-retry-after-the-songs-end", file: "src/page/karaoke/karaoke.ts", from: "autoRetriesSpent >= MAX_AUTO_LYRICS_RETRIES ||\n    !isBeforeSongEnd(model, songId)", to: "autoRetriesSpent >= MAX_AUTO_LYRICS_RETRIES" },
  { property: "no-lyrics-retry-after-the-songs-end", file: "src/lyrics.ts", from: "() => segment.startSeconds + LAST_SONG_SECONDS,", to: "() => Infinity," },
  { property: "lyrics-retry-continues-until-the-songs-end", file: "src/page/karaoke/karaoke.ts", from: "onSome: ({ autoRetriesSpent }) =>\n            fetchLyrics(model, songId, autoRetriesSpent + 1),", to: "onSome: ({ autoRetriesSpent }) =>\n            currentAndNextSongIds(model).includes(songId) ? fetchLyrics(model, songId, autoRetriesSpent + 1) : { model }," },
  { property: "lyrics-retry-continues-until-the-songs-end", file: "src/page/karaoke/karaoke.ts", from: "onSome: ({ autoRetriesSpent }) =>\n            fetchLyrics(model, songId, autoRetriesSpent + 1),", to: "onSome: () => ({ model })," },
  { property: "replaying-a-song-fetches-its-lyrics-again", file: "src/page/karaoke/karaoke.ts", from: "!previousIds.includes(id) &&", to: "false &&" },
  { property: "stale-lyrics-timer-changes-nothing", file: "src/page/karaoke/karaoke.ts", from: "failed => failed.waitId === waitId,", to: "() => true," },
];

function runMutants() {
  let wrong = 0;
  for (const m of MUTANTS) {
    const source = readFileSync(new URL(m.file, root), 'utf8');
    if (source.split(m.from).length !== 2) {
      console.log(`MUTANT STALE ${m.property}: its text is no longer in ${m.file} exactly once. Update MUTANTS.`);
      wrong++;
      continue;
    }
    const started = Date.now();
    const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--only', m.property, '--depth', String(DEPTH), '--lyrics-depth', String(LYRIC_DEPTH)], {
      env: { ...process.env, RADIO_MUTANT: JSON.stringify(m) }, encoding: 'utf8',
    });
    // A mutant that crashes the module also exits 1, so only the property's own FAIL line counts.
    const caught = run.status === 1 && run.stdout.includes(`FAIL ${m.property}`);
    const firstLine = m.from.trim().split('\n')[0];
    const tier = run.stdout.includes('found by a random walk') ? 'by a random walk' : 'exhaustively';
    console.log(`${caught ? `CAUGHT ${tier}` : 'MISSED'} ${m.property} (${((Date.now() - started) / 1000).toFixed(1)}s): ${m.file}: ${firstLine} ...`);
    if (!caught) {
      wrong++;
      console.log(run.stdout + run.stderr);
    }
  }
  console.log(wrong ? `${wrong} of ${MUTANTS.length} mutants were not caught` : `all ${MUTANTS.length} mutants caught`);
  process.exit(wrong ? 2 : 0);
}

const names = ONLY ? [ONLY] : Object.keys(PROPERTIES);
if (names.some((name) => !PROPERTIES[name])) {
  console.log(`unknown property ${ONLY}; known: ${Object.keys(PROPERTIES).join(', ')}`);
  process.exit(2);
}

if (!isMainThread) {
  const config = CONFIGS[workerData];
  const bfs = explore(config, names);
  const walks = walk(config, names.filter((name) => !bfs.found.has(name)), 20261113 + workerData);
  parentPort.postMessage({ states: bfs.states, steps: bfs.steps, walkSteps: walks.steps, found: [...bfs.found], walkFound: [...walks.found] });
} else if (args.includes('--mutants')) {
  runMutants();
} else {
  const started = Date.now();
  // One worker per autoplay and repeat setting, because no step changes either.
  // A run starts a worker only for a scope that holds one of its properties.
  const indexes = CONFIGS.flatMap((config, index) => (names.some((name) => belongsTo(name, config)) ? [index] : []));
  const results = await Promise.all(indexes.map((index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: index, argv: args });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  const total = (key) => results.reduce((sum, result) => sum + result[key], 0);
  console.log(`explored ${total('states')} states and ${total('steps')} steps to depth ${DEPTH} (lyrics scope ${LYRIC_DEPTH}), then ${total('walkSteps')} steps of random walks, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const shortest = (key, name) => results.map((result) => new Map(result[key]).get(name)).filter(Boolean).sort((a, b) => a.steps.length - b.steps.length)[0];
  let exit = 0;
  for (const name of names) {
    const exhaustive = shortest('found', name);
    const failure = exhaustive ?? shortest('walkFound', name);
    // Under --only, a known finding counts as a failure, so a mutant of its code can still be caught.
    const known = KNOWN_FINDINGS.has(name) && !ONLY;
    if (!failure) {
      console.log(`PASS ${name}${KNOWN_FINDINGS.has(name) ? '  (listed as a known finding but passes now: remove it from KNOWN_FINDINGS)' : ''}`);
      continue;
    }
    console.log(`${known ? 'FINDING' : 'FAIL'} ${name}${exhaustive ? '' : ' (found by a random walk, beyond the exhaustive depth)'}\n  promise: ${PROPERTIES[name].promise}\n  steps: ${failure.steps.join(' -> ')}\n  why: ${failure.why}`);
    if (!known) exit = 1;
  }
  process.exit(exit);
}
