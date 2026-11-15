import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { PlayStat, type Standing } from './playStats.ts'

export const MOODS = [
  'ceria',
  'galau',
  'hype',
  'chill',
  'romantis',
  'sendu',
] as const
export const Mood = Schema.Literals(MOODS)
export type Mood = typeof Mood.Type

export const MAX_PICKED_MOODS = 2
export const SONGS_BEFORE_ASK = 3
/** `Played` fires when a song starts, so the current song is already counted. */
export const HEARD_WHEN_ASKING = SONGS_BEFORE_ASK + 1
export const SECONDS_BEFORE_ASK = 45

export const MoodPrompt = defineTaggedUnion({
  Counting: { heard: Schema.Number },
  Asking: {
    songId: Schema.String,
    playId: Schema.Number,
    picked: Schema.Array(Mood),
  },
  Done: {},
})
export type MoodPrompt = typeof MoodPrompt.Type

export const initialMoodPrompt = (): MoodPrompt =>
  MoodPrompt.Counting({ heard: 0 })

const isStillAsking = (
  asking: { songId: string; playId: number },
  standing: Standing,
): boolean =>
  !standing.hasGoneStream &&
  !standing.hasFailedLoad &&
  standing.songId === asking.songId &&
  standing.playId === asking.playId

export const stepMoodPrompt = (
  prompt: MoodPrompt,
  playedStats: ReadonlyArray<PlayStat>,
  maybeStanding: Option.Option<Standing>,
): MoodPrompt =>
  MoodPrompt.match(prompt, {
    Done: () => prompt,
    Counting: ({ heard }) => {
      const nowHeard =
        heard + Array.filter(playedStats, PlayStat.guards.Played).length
      return Option.match(
        Option.filter(
          maybeStanding,
          standing =>
            nowHeard >= HEARD_WHEN_ASKING &&
            standing.isPlaying &&
            standing.secondsIntoSong >= SECONDS_BEFORE_ASK,
        ),
        {
          onNone: () => MoodPrompt.Counting({ heard: nowHeard }),
          onSome: ({ songId, playId }) =>
            MoodPrompt.Asking({ songId, playId, picked: [] }),
        },
      )
    },
    Asking: asking =>
      Option.exists(maybeStanding, standing => isStillAsking(asking, standing))
        ? prompt
        : stepMoodPrompt(
            MoodPrompt.Counting({ heard: HEARD_WHEN_ASKING }),
            playedStats,
            maybeStanding,
          ),
  })
