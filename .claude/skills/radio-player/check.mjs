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

// ORACLE, worked out from the fixture alone, never from the module under test.
const songsOfVideo = (video) => ARCHIVE.filter((song) => song.video_url === video).sort((a, b) => startOf(a) - startOf(b));
const sungAt = (video, seconds) => songsOfVideo(video).filter((song) => startOf(song) <= seconds).at(-1);
const songAfter = (video, seconds) => songsOfVideo(video).find((song) => startOf(song) > seconds);
const songBefore = (song) => {
  const songs = songsOfVideo(song.video_url);
  return songs[songs.findIndex(({ id }) => id === song.id) - 1];
};
const lastStartOf = (video) => startOf(songsOfVideo(video).at(-1));
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
    now && [now.song.id, now.playId - base, now.status, now.player, now.maybeLoadError._tag],
  ]);
};
const hasFailed = (now) => now.maybeLoadError._tag === 'Some';
const goneOf = (model, env) => new Set([...model.goneVideoIds, ...env.failed]);
const named = (commands, name) => (commands ?? []).filter((command) => command.name === name);

// STATE. `pending` holds the Command results that change something when they arrive: random picks and
// toast timers. A timer knows whether it is the newest one, because two toasts can share a dismissId.
// Every other Command's result message returns the model unchanged in `update`.
// Lyrics, volume, layers and drags are left out: no setlist branch reads them.
const keyOf = ({ model, env, pending, config }) => {
  const base = model.setlist.playCount;
  const playhead = some(model.maybePlayhead);
  const toast = some(model.maybeSkipToast);
  return JSON.stringify([
    config, setlistKey(model, base), playhead && [playhead.playId - base, playhead.seconds],
    toast && [toast.firstSkippedTitle, toast.skippedCount, toast.dismissId - base],
    [...model.goneVideoIds].sort(), [...env.failed].sort(), env.phase, env.position, env.refetched,
    pending.map((item) => JSON.stringify(item.kind === 'pick'
      ? [item.kind, item.playId - base, item.cause, ids(item.candidates)]
      : [item.kind, item.dismissId - base, item.isNewest])).sort(),
  ]);
};

// TRANSITIONS: what the UI offers, what the YouTube player can report, and what Commands return.
const playerEvent = (playId, event, label) => ({ message: K.Message.ReceivedPlayerEvent({ playId, event }), label: `ReceivedPlayerEvent(playId ${playId}, ${label})`, kind: 'player', playId, event });

function transitions({ model, env, pending }) {
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
  if (now) {
    user(K.Message.ClickedPlayPause(), 'ClickedPlayPause');
    user(K.Message.ClickedNext(), 'ClickedNext');
    user(K.Message.ClickedPrevious(), 'ClickedPrevious');
  }
  if (some(model.maybeSkipToast)) user(K.Message.ClickedDismissToast(), 'ClickedDismissToast');
  if (!env.refetched && pending.some((item) => item.kind === 'pick')) {
    out.push({ message: K.Message.SucceededFetchSongs({ songs: ARCHIVE, goneVideoIds: REFETCH_GONE }), label: `SucceededFetchSongs(refetch, gone [${REFETCH_GONE}])`, kind: 'refetch' });
  }
  // The current play's events, in the order loadedVideoEvents in src/youtube.ts emits them: Ready first,
  // except that a failure can come before it. PlayerFailed is the only event of a player that never loaded.
  if (now && env.phase === 'fresh') {
    out.push(playerEvent(now.playId, PlayerEvent.Ready(), 'Ready'));
    out.push(playerEvent(now.playId, PlayerEvent.VideoFailed({ reason: 'x' }), 'VideoFailed'));
    out.push(playerEvent(now.playId, PlayerEvent.PlayerFailed({ reason: 'x' }), 'PlayerFailed'));
  }
  if (now && env.phase === 'loaded') {
    out.push(playerEvent(now.playId, PlayerEvent.Playing(), 'Playing'));
    out.push(playerEvent(now.playId, PlayerEvent.Paused(), 'Paused'));
    out.push(playerEvent(now.playId, PlayerEvent.VideoFailed({ reason: 'x' }), 'VideoFailed'));
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
    for (const [event, label] of [[PlayerEvent.Ready(), 'Ready'], [PlayerEvent.Playing(), 'Playing'], [PlayerEvent.Paused(), 'Paused'], [PlayerEvent.Ended(), 'Ended'], [PlayerEvent.VideoFailed({ reason: 'x' }), 'VideoFailed'], [PlayerEvent.PlayerFailed({ reason: 'x' }), 'PlayerFailed'], [PlayerEvent.Progressed({ seconds: 180 }), 'Progressed 180s']]) {
      out.push(playerEvent(stale, event, label));
    }
  }
  pending.forEach((item, index) => {
    if (item.kind === 'pick') {
      for (const song of item.candidates) {
        out.push({ message: K.Message.CompletedPickRandomVideo({ playId: item.playId, song, cause: item.cause }), label: `CompletedPickRandomVideo(playId ${item.playId}, ${song.id}, ${item.cause})`, kind: 'pick', playId: item.playId, song, consumes: index });
      }
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
  const pending = state.pending
    .filter((_, index) => index !== transition.consumes)
    .map((item) => (isNewTimer && item.kind === 'timer' ? { ...item, isNewest: false } : item));
  for (const command of commands) {
    if (command.name === 'PickRandomVideo') pending.push({ kind: 'pick', ...command.args });
    if (command.name === 'WaitBeforeDismissToast') pending.push({ kind: 'timer', dismissId: command.args.dismissId, isNewest: true });
  }
  const before = nowOf(state.model);
  const after = nowOf(model);
  let env = state.env;
  if (transition.kind === 'refetch') env = { ...env, refetched: true };
  if (transition.kind === 'player' && before && transition.playId === before.playId) {
    const tag = transition.event._tag;
    if (tag === 'Ready') env = { ...env, phase: 'loaded' };
    if (tag === 'Progressed') env = { ...env, position: transition.event.seconds };
    if (tag === 'PlayerFailed') env = { ...env, phase: 'dead' };
    if (tag === 'VideoFailed') env = { ...env, phase: 'dead', failed: [...new Set([...env.failed, before.song.video_url])] };
  }
  if (after && (!before || after.playId !== before.playId)) env = { ...env, phase: 'fresh', position: undefined };
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
    promise: 'A player event or random pick for a play that is no longer current changes nothing and sends nothing.',
    check(pre, t, post) {
      if ((t.kind !== 'player' && t.kind !== 'pick') || isCurrent(pre, t.playId)) return;
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
      const failed = hasFailed(now);
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
      const failed = hasFailed(now);
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
      if (ids(after.queue) !== ids([now.song, ...queue])) return `queue ${ids(after.queue)}, expected ${ids([now.song, ...queue])}`;
      if (ids(after.history) !== ids(history.slice(1))) return 'history did not drop its newest song';
    },
  },
  'next-and-previous-with-unknown-playhead': {
    promise: 'Before a progress report, or with the playhead before the first song, Next and Previous still move within the stream from the song on the bar.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if ((t.label !== 'ClickedNext' && t.label !== 'ClickedPrevious') || !now || hasFailed(now)) return;
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
  'failed-video-leaves-queue-and-history': {
    promise: 'Once a video fails to play, none of its songs stays in the queue or history, so nothing plays it again.',
    check(pre, t, post) {
      const failed = new Set(post.env.failed);
      const { queue, history } = post.model.setlist;
      const bad = [...queue, ...history].find((song) => failed.has(song.video_url));
      if (bad) return `${bad.id} of failed video ${bad.video_url} is in the ${queue.includes(bad) ? 'queue' : 'history'} after ${t.label}`;
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
    promise: "The player's own Playing, Paused, Progressed and PlayerFailed reports send no ApplyPlayback back, and Ready sends only a pause, for a paused play.",
    check(pre, t, post) {
      if (t.kind !== 'player' || !isCurrent(pre, t.playId)) return;
      const applied = named(post.commands, 'ApplyPlayback');
      const tag = t.event._tag;
      if (['Playing', 'Paused', 'Progressed', 'PlayerFailed'].includes(tag) && applied.length) return `${tag} sent ApplyPlayback(${applied[0].args.isPlaying})`;
      if (tag === 'Ready') {
        const shouldPause = nowOf(pre.model).status === 'Paused';
        if (applied.length !== (shouldPause ? 1 : 0) || applied.some((c) => c.args.isPlaying)) return `Ready on a ${nowOf(pre.model).status} play sent ${JSON.stringify(applied.map((c) => c.args))}`;
      }
    },
  },
  'play-pause-reaches-the-player': {
    promise: 'Play/Pause flips the status and tells the player the new state.',
    check(pre, t, post) {
      const before = nowOf(pre.model);
      if (t.label !== 'ClickedPlayPause' || !before) return;
      const after = nowOf(post.model);
      const applied = named(post.commands, 'ApplyPlayback');
      if (after.status === before.status) return 'the status did not change';
      if (applied.length !== 1 || applied[0].args.isPlaying !== (after.status === 'Playing')) return `sent ${JSON.stringify(applied.map((c) => c.args))} for ${after.status}`;
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
    promise: 'After the current video ends, a new play starts or a random pick is on its way; it pauses only when nothing may follow.',
    check(pre, t, post) {
      const now = nowOf(pre.model);
      if (t.kind !== 'player' || t.event._tag !== 'Ended' || !isCurrent(pre, t.playId)) return;
      if (startedNewPlay(pre, post)) return;
      const picks = named(post.commands, 'PickRandomVideo');
      if (picks.length === 1 && picks[0].args.playId === now.playId) return;
      const after = nowOf(post.model);
      const others = otherLiveFirstSongs(now.song.video_url, goneOf(pre.model, pre.env));
      const nothingFollows = pre.config.repeat === 'Off' && pre.model.setlist.queue.length === 0 && (!pre.config.isAutoplay || others.length === 0);
      if (after.status !== 'Paused') return 'nothing new started and it did not pause';
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
const KNOWN_FINDINGS = new Set([
  'failed-video-leaves-queue-and-history',
  'pick-rechecks-gone-at-delivery',
]);

const CONFIGS = [true, false].flatMap((isAutoplay) => ['Off', 'All', 'One'].map((repeat) => ({ isAutoplay, repeat })));
const configLabel = ({ isAutoplay, repeat }) => `autoplay ${isAutoplay ? 'on' : 'off'}, repeat ${repeat}`;

function initialState(config) {
  const fetched = K.update(K.init(), K.Message.SucceededFetchSongs({ songs: ARCHIVE, goneVideoIds: SERVER_GONE })).model;
  return { model: { ...fetched, ...config }, env: { phase: 'none', position: undefined, failed: [], refetched: false }, pending: [], config };
}

const checkStep = (names, found, pre, transition, post, traceOf) => {
  for (const name of names) {
    if (found.has(name)) continue;
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
  for (let depth = 0; depth < DEPTH && frontier.length && found.size < names.length; depth++) {
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
  for (let w = 0; w < WALKS && found.size < names.length; w++) {
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
  { property: 'stale-results-never-act', file: 'src/page/karaoke/karaoke.ts', from: 'CompletedPickRandomVideo: ({ playId, song, cause }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          nowPlaying => nowPlaying.playId === playId,', to: 'CompletedPickRandomVideo: ({ playId, song, cause }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          () => true,' },
  { property: 'stale-results-never-act', file: 'src/page/karaoke/karaoke.ts', from: 'ReceivedPlayerEvent: ({ playId, event }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          nowPlaying => nowPlaying.playId === playId,', to: 'ReceivedPlayerEvent: ({ playId, event }) =>\n      Option.match(\n        Option.filter(\n          model.setlist.maybeNowPlaying,\n          () => true,' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/karaoke.ts', from: 'ClickedNext: () =>\n      Array.isReadonlyArrayNonEmpty(model.setlist.queue)\n        ? changeSetlist(model, playNext(model.setlist, model.repeat))\n        : seekBeside(model, 1, () => pickAnotherVideo(model)),', to: 'ClickedNext: () =>\n      seekBeside(model, 1, () =>\n        Array.isReadonlyArrayNonEmpty(model.setlist.queue)\n          ? changeSetlist(model, playNext(model.setlist, model.repeat))\n          : pickAnotherVideo(model),\n      ),' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/setlist.ts', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => !isGone(song),' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/karaoke.ts', from: 'seekBeside(model, 1, () => pickAnotherVideo(model))', to: 'seekBeside(model, -1, () => pickAnotherVideo(model))' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/karaoke.ts', from: 'commands: [PickRandomVideo({ playId, candidates, cause: \'Ended\' })],', to: 'commands: [PickRandomVideo({ playId: playId + 1, candidates, cause: \'Ended\' })],' },
  { property: 'previous-seeks-in-stream-then-history', file: 'src/page/karaoke/karaoke.ts', from: 'seekBeside(model, -1, () =>', to: 'seekBeside(model, 1, () =>' },
  { property: 'previous-seeks-in-stream-then-history', file: 'src/page/karaoke/karaoke.ts', from: 'ClickedPrevious: () =>\n      seekBeside(model, -1, () =>\n        changeSetlist(model, playPrevious(model.setlist)),\n      ),', to: 'ClickedPrevious: () => changeSetlist(model, playPrevious(model.setlist)),' },
  { property: 'next-and-previous-with-unknown-playhead', file: 'src/lyrics.ts', from: 'onNone: () =>\n      Array.findFirstIndex(spans, ({ song }) => song.id === playing.id),', to: 'onNone: () => Option.none(),' },
  { property: 'next-and-previous-with-unknown-playhead', file: 'src/lyrics.ts', from: '        () => -1,\n', to: '        () => -2,\n' },
  { property: 'next-plays-queue-then-stream-then-other-video', file: 'src/page/karaoke/karaoke.ts', from: '        Option.isNone(maybeLoadError),', to: '        true,' },
  { property: 'seek-never-reloads', file: 'src/page/karaoke/karaoke.ts', from: '          model: moved.model,\n          commands: [...(moved.commands ?? []), SeekPlayer({ seconds })],', to: '          model: modifyFields(moved.model, { setlist: setlist => play(setlist, song) }),\n          commands: [...(moved.commands ?? []), SeekPlayer({ seconds })],' },
  { property: 'seek-never-reloads', file: 'src/page/karaoke/karaoke.ts', from: 'const moved = progressed(model, nowPlaying.playId, seconds)', to: 'const moved = { model }' },
  { property: 'gone-video-never-auto-starts', file: 'src/page/karaoke/setlist.ts', from: 'song => !isGone(song) && song.video_url !== current.video_url,', to: 'song => song.video_url !== current.video_url,' },
  { property: 'gone-video-never-auto-starts', file: 'src/page/karaoke/karaoke.ts', from: 'isGone: song => goneIds.has(song.video_url),', to: 'isGone: () => false,' },
  { property: 'gone-video-never-auto-starts', file: 'src/page/karaoke/karaoke.ts', from: 'goneVideoIds: known =>\n                    Array.dedupe([...known, nowPlayingSong.video_url]),', to: 'goneVideoIds: known => known,' },
  { property: 'player-reports-never-echo', file: 'src/page/karaoke/karaoke.ts', from: "Playing: () =>\n                recordFromPlayer(model, setStatus(model.setlist, 'Playing')),", to: "Playing: () =>\n                changeSetlist(model, setStatus(model.setlist, 'Playing'))," },
  { property: 'player-reports-never-echo', file: 'src/page/karaoke/karaoke.ts', from: "Paused: () =>\n                recordFromPlayer(model, setStatus(model.setlist, 'Paused')),", to: "Paused: () =>\n                changeSetlist(model, setStatus(model.setlist, 'Paused'))," },
  { property: 'player-reports-never-echo', file: 'src/page/karaoke/karaoke.ts', from: "status === 'Paused'\n                    ? [\n                        ApplyPlayback({ isPlaying: false }),", to: "status === 'Playing'\n                    ? [\n                        ApplyPlayback({ isPlaying: false })," },
  { property: 'play-pause-reaches-the-player', file: 'src/page/karaoke/karaoke.ts', from: 'before.playId === after.playId && before.status !== after.status', to: 'false' },
  { property: 'end-of-stream-does-not-replay-it', file: 'src/page/karaoke/setlist.ts', from: 'onSome: ({ song }) => planFromArchive(continuation, song),', to: 'onSome: () => Advance.Replay(),' },
  { property: 'ended-never-stalls', file: 'src/page/karaoke/karaoke.ts', from: "                      commands: [\n                        PickRandomVideo({\n                          playId,\n                          candidates,\n                          cause: 'Ended',\n                        }),\n                      ],", to: '                      commands: [],' },
  { property: 'ended-never-stalls', file: 'src/page/karaoke/setlist.ts', from: '  continuation.isAutoplay\n    ? Array.match(', to: '  !continuation.isAutoplay\n    ? Array.match(' },
  { property: 'skip-toast-always-clears', file: 'src/page/karaoke/karaoke.ts', from: 'Option.filter(maybeToast, toast => toast.dismissId !== dismissId)', to: 'Option.none()' },
  { property: 'skip-toast-always-clears', file: 'src/page/karaoke/karaoke.ts', from: 'const dismissId = setlist.playCount\n', to: 'const dismissId = setlist.playCount - 1\n' },
  { property: 'skip-toast-always-clears', file: 'src/page/karaoke/karaoke.ts', from: '                  commands: [\n                    saveSetlist,\n                    WaitBeforeDismissToast({ dismissId }),\n                  ],', to: '                  commands: [saveSetlist],' },
  { property: 'setlist-change-is-saved', file: 'src/page/karaoke/karaoke.ts', from: '                      commands: [\n                        SaveSetlist({ json: toPersistedJson(cleaned) }),', to: '                      commands: [' },
  { property: 'setlist-change-is-saved', file: 'src/page/karaoke/karaoke.ts', from: "            return cause === 'Ended'\n              ? {\n                  model: modifyFields(model, { setlist: () => setlist }),\n                  commands: [saveSetlist],", to: "            return cause === 'Ended'\n              ? {\n                  model: modifyFields(model, { setlist: () => setlist }),\n                  commands: []," },
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
    const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--only', m.property, '--depth', String(DEPTH)], {
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
  const results = await Promise.all(CONFIGS.map((_, index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: index, argv: args });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  const total = (key) => results.reduce((sum, result) => sum + result[key], 0);
  console.log(`explored ${total('states')} states and ${total('steps')} steps to depth ${DEPTH}, then ${total('walkSteps')} steps of random walks, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
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
