import { DateTime, Effect, Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import type { PlayableSong } from '../../domain.ts'
import { PlayerEvent } from '../../youtube'
import {
  CreateSessionId,
  Message,
  type Model,
  RecordDecision,
  RecordStat,
  entered,
  init,
  update,
} from './karaoke.ts'
import { PlayStat } from './playStats.ts'
import {
  TrailDecision,
  TrailTag,
  claimSeqs,
  newSessionId,
  startedTrail,
} from './trail.ts'

const song = (id: string, video: string, timestamp: string): PlayableSong => ({
  id,
  song_title: `Song ${id}`,
  artist: '',
  original_title: '',
  version: '',
  note: '',
  timestamp,
  created_at: 'x',
  video_url: video,
  title_text: 'Stream',
  membership: false,
  published_at: DateTime.makeUnsafe('2026-09-29T12:24:01Z'),
  kind: 'karaoke',
})

const s1 = song('s1', 'stream', '00:01:00')
const s2 = song('s2', 'stream', '00:05:00')
const solo = song('solo', 'single', '00:00:30')
const SESSION = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b'

const decodeStat = Schema.decodeUnknownSync(PlayStat)
const decodeDecision = Schema.decodeUnknownSync(TrailDecision)

type Posted = Readonly<{
  kind: string
  songId: string
  seq: number
  prev: string | undefined
}>

type Session = Readonly<{ model: Model; posted: ReadonlyArray<Posted> }>

const prevOf = (tag: TrailTag) => Option.getOrUndefined(tag.maybePrevSongId)

const send = (session: Session, message: Message): Session => {
  const result = update(session.model, message)
  const posted = (result.commands ?? []).flatMap((command): Posted[] => {
    if (command.name === RecordStat.name) {
      const stat = decodeStat(command.args?.['stat'])
      const tag = Option.getOrUndefined(
        Schema.decodeUnknownSync(Schema.Option(TrailTag))(
          command.args?.['maybeTag'],
        ),
      )
      return tag
        ? [{ kind: stat._tag, songId: stat.songId, seq: tag.seq, prev: prevOf(tag) }]
        : []
    }
    if (command.name === RecordDecision.name) {
      const decision = decodeDecision(command.args?.['decision'])
      return [
        {
          kind: 'Decision',
          songId: decision.songId,
          seq: decision.tag.seq,
          prev: prevOf(decision.tag),
        },
      ]
    }
    return []
  })
  return { model: result.model, posted: [...session.posted, ...posted] }
}

const loaded = (): Model =>
  update(
    init(),
    Message.SucceededFetchSongs({ songs: [s1, s2, solo], goneVideoIds: [] }),
  ).model

const run = (...messages: ReadonlyArray<Message>): Session =>
  messages.reduce(send, {
    model: update(
      loaded(),
      Message.CompletedCreateSessionId({ sessionId: SESSION }),
    ).model,
    posted: [],
  })

const event = (playId: number, playerEvent: PlayerEvent) =>
  Message.ReceivedPlayerEvent({ playId, event: playerEvent })
const playing = (playId: number) => event(playId, PlayerEvent.Playing())
const at = (playId: number, seconds: number) =>
  event(playId, PlayerEvent.Progressed({ seconds }))
const ready = (playId: number) => event(playId, PlayerEvent.Ready())

const trace = (session: Session) =>
  session.posted.map(({ kind, songId, seq, prev }) => `${seq} ${kind} ${songId} <- ${prev}`)

describe('session', () => {
  test('entering the radio asks for a session id once, and the first answer wins', () => {
    const first = entered(init())
    expect(first.commands?.some(({ name }) => name === CreateSessionId.name)).toBe(true)
    const started = update(
      first.model,
      Message.CompletedCreateSessionId({ sessionId: SESSION }),
    ).model
    const later = update(
      started,
      Message.CompletedCreateSessionId({ sessionId: 'someone-else' }),
    ).model
    expect(Option.getOrUndefined(later.maybeTrail)?.sessionId).toBe(SESSION)
    expect(
      entered(started).commands?.some(({ name }) => name === CreateSessionId.name),
    ).toBe(false)
  })

  test('the id is a UUID v4 and differs between page loads', async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => Effect.runPromise(newSessionId)),
    )
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
    expect(new Set(ids).size).toBe(20)
  })

  test('before an id exists the stats are still recorded, without a tag', () => {
    const result = update(loaded(), Message.ClickedSong({ song: s1 }))
    const stat = result.commands?.find(({ name }) => name === RecordStat.name)
    expect(stat).toBeDefined()
    expect(
      Option.isNone(
        Schema.decodeUnknownSync(Schema.Option(TrailTag))(stat?.args?.['maybeTag']),
      ),
    ).toBe(true)
  })
})

describe('trail', () => {
  test('each event takes the next seq, and a play names the play before it', () => {
    const session = run(
      Message.ClickedSong({ song: s1 }),
      ready(1),
      playing(1),
      at(1, 10),
      at(1, 301),
    )
    expect(trace(session)).toEqual([
      '1 Clicked s1 <- undefined',
      '2 Played s1 <- undefined',
      '3 Finished s1 <- undefined',
      '4 Played s2 <- s1',
    ])
  })

  test('the finish and skip of a play carry the play before it', () => {
    const session = run(
      Message.ClickedSong({ song: s1 }),
      playing(1),
      at(1, 301),
      Message.ClickedNext(),
    )
    expect(trace(session)).toEqual([
      '1 Clicked s1 <- undefined',
      '2 Played s1 <- undefined',
      '3 Finished s1 <- undefined',
      '4 Played s2 <- s1',
      '5 Skipped s2 <- s1',
    ])
  })

  test('seq is strictly increasing by one across stats and decisions', () => {
    const session = run(
      Message.ClickedSong({ song: s1 }),
      playing(1),
      at(1, 10),
      Message.ClickedNext(),
    )
    const picked = send(
      session,
      Message.CompletedPickRandomVideo({ playId: 1, song: solo, poolSize: 4 }),
    )
    const seqs = picked.posted.map(({ seq }) => seq)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
  })
})

describe('autoplay decisions', () => {
  const afterNext = () =>
    run(
      Message.ClickedSong({ song: s1 }),
      playing(1),
      at(1, 10),
      Message.ClickedNext(),
    )

  test('the pick is posted before the play it causes, with the pool and policy', () => {
    const picked = send(
      afterNext(),
      Message.CompletedPickRandomVideo({ playId: 1, song: solo, poolSize: 4 }),
    )
    const played = send(picked, playing(2))
    expect(trace(played)).toEqual([
      '1 Clicked s1 <- undefined',
      '2 Played s1 <- undefined',
      '3 Skipped s1 <- undefined',
      '4 Decision solo <- s1',
      '5 Played solo <- s1',
    ])
    const command = update(
      afterNext().model,
      Message.CompletedPickRandomVideo({ playId: 1, song: solo, poolSize: 4 }),
    ).commands?.find(({ name }) => name === RecordDecision.name)
    expect(decodeDecision(command?.args?.['decision'])).toMatchObject({
      songId: 'solo',
      policy: 'uniform-v1',
      poolSize: 4,
    })
  })

  test('a pick the visitor overtook, or one drawn again, logs no decision', () => {
    const overtaken = send(
      afterNext(),
      Message.CompletedPickRandomVideo({ playId: 99, song: solo, poolSize: 4 }),
    )
    expect(trace(overtaken).some(line => line.includes('Decision'))).toBe(false)
    const gone = update(
      afterNext().model,
      Message.SucceededFetchSongs({ songs: [s1, s2, solo], goneVideoIds: ['single'] }),
    ).model
    const redrawn = send(
      { model: gone, posted: [] },
      Message.CompletedPickRandomVideo({ playId: 1, song: solo, poolSize: 4 }),
    )
    expect(trace(redrawn).some(line => line.includes('Decision'))).toBe(false)
  })
})

describe('claimSeqs', () => {
  test('the decision takes a lower seq than the stats claimed in the same update', () => {
    const claimed = claimSeqs(
      Option.some(startedTrail(SESSION)),
      Option.some({ songId: 'solo', poolSize: 4 }),
      [PlayStat.Played({ songId: 'solo', origin: 'Autoplay' })],
    )
    expect(Option.getOrUndefined(claimed.maybeDecision)?.tag.seq).toBe(1)
    expect(
      claimed.tagged.map(({ maybeTag }) => Option.getOrUndefined(maybeTag)?.seq),
    ).toEqual([2])
  })
})
