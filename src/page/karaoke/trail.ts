import { BrowserCrypto } from '@effect/platform-browser'
import { Array, Effect, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'

import { PlayStat } from './playStats.ts'

export const AUTOPLAY_POLICY = 'uniform-v1'

export const TrailSession = Schema.Struct({
  sessionId: Schema.String,
  seq: Schema.Number,
  maybeCurrentSongId: Schema.Option(Schema.String),
  maybePreviousSongId: Schema.Option(Schema.String),
})
export type TrailSession = typeof TrailSession.Type

export const TrailTag = Schema.Struct({
  sessionId: Schema.String,
  seq: Schema.Number,
  maybePrevSongId: Schema.Option(Schema.String),
})
export type TrailTag = typeof TrailTag.Type

export const TrailDecision = Schema.Struct({
  tag: TrailTag,
  songId: Schema.String,
  policy: Schema.String,
  poolSize: Schema.Number,
})
export type TrailDecision = typeof TrailDecision.Type

export const startedTrail = (sessionId: string): TrailSession => ({
  sessionId,
  seq: 0,
  maybeCurrentSongId: Option.none(),
  maybePreviousSongId: Option.none(),
})

const tagFor = (
  session: TrailSession,
  maybePrevSongId: Option.Option<string>,
): TrailTag => ({
  sessionId: session.sessionId,
  seq: session.seq + 1,
  maybePrevSongId,
})

type Step = Readonly<{ session: TrailSession; tag: TrailTag }>

const stepTrail = (session: TrailSession, stat: PlayStat): Step => {
  const counted = { ...session, seq: session.seq + 1 }
  const tag = (maybePrevSongId: Option.Option<string>) =>
    tagFor(session, maybePrevSongId)
  const leftBehind = (songId: string) =>
    Option.contains(session.maybeCurrentSongId, songId)
      ? session.maybePreviousSongId
      : session.maybeCurrentSongId
  return PlayStat.match<Step>(stat, {
    Clicked: () => ({
      session: counted,
      tag: tag(session.maybeCurrentSongId),
    }),
    Played: ({ songId }) => ({
      session: {
        ...counted,
        maybeCurrentSongId: Option.some(songId),
        maybePreviousSongId: session.maybeCurrentSongId,
      },
      tag: tag(session.maybeCurrentSongId),
    }),
    Finished: ({ songId }) => ({
      session: counted,
      tag: tag(leftBehind(songId)),
    }),
    Skipped: ({ songId }) => ({
      session: counted,
      tag: tag(leftBehind(songId)),
    }),
  })
}

export type TaggedStat = Readonly<{
  stat: PlayStat
  maybeTag: Option.Option<TrailTag>
}>

export const tagStats = (
  maybeTrail: Option.Option<TrailSession>,
  stats: ReadonlyArray<PlayStat>,
): Readonly<{
  maybeTrail: Option.Option<TrailSession>
  tagged: ReadonlyArray<TaggedStat>
}> =>
  Option.match(maybeTrail, {
    onNone: () => ({
      maybeTrail,
      tagged: Array.map(stats, stat => ({ stat, maybeTag: Option.none() })),
    }),
    onSome: first => {
      const tagged: Array<TaggedStat> = []
      const last = Array.reduce(stats, first, (session, stat) => {
        const step = stepTrail(session, stat)
        tagged.push({ stat, maybeTag: Option.some(step.tag) })
        return step.session
      })
      return { maybeTrail: Option.some(last), tagged }
    },
  })

export const decidedPick = (
  maybeTrail: Option.Option<TrailSession>,
  songId: string,
  poolSize: number,
): Readonly<{
  maybeTrail: Option.Option<TrailSession>
  maybeDecision: Option.Option<TrailDecision>
}> =>
  Option.match(maybeTrail, {
    onNone: () => ({ maybeTrail, maybeDecision: Option.none() }),
    onSome: session => ({
      maybeTrail: Option.some({ ...session, seq: session.seq + 1 }),
      maybeDecision: Option.some({
        tag: tagFor(session, session.maybeCurrentSongId),
        songId,
        policy: AUTOPLAY_POLICY,
        poolSize,
      }),
    }),
  })

export const trailFields = (maybeTag: Option.Option<TrailTag>) =>
  Option.match(maybeTag, {
    onNone: () => ({}),
    onSome: ({ sessionId, seq, maybePrevSongId }) => ({
      sessionId,
      seq,
      ...Option.match(maybePrevSongId, {
        onNone: () => ({}),
        onSome: prevSongId => ({ prevSongId }),
      }),
    }),
  })

export const newSessionId: Effect.Effect<string> =
  SecureRandom.SecureRandom.use(random => random.uuidV4()).pipe(
    Effect.provide(BrowserCrypto.layerSecureRandom),
  )
