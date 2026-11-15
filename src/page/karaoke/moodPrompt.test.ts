import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  HEARD_WHEN_ASKING,
  MoodPrompt,
  SECONDS_BEFORE_ASK,
  initialMoodPrompt,
  stepMoodPrompt,
} from './moodPrompt.ts'
import { PlayStat, type Standing } from './playStats.ts'

const standing = (overrides: Partial<Standing> = {}): Standing => ({
  playId: 4,
  origin: 'Visitor',
  isPlaying: true,
  hasFailedLoad: false,
  hasGoneStream: false,
  songId: 's4',
  maybeNextSongId: Option.none(),
  secondsIntoSong: 0,
  ...overrides,
})

const played = (count: number, origin: 'Visitor' | 'Autoplay' = 'Visitor') =>
  Array.from({ length: count }, (_, index) =>
    PlayStat.Played({ songId: `s${index}`, origin }),
  )

const late = Option.some(standing({ secondsIntoSong: SECONDS_BEFORE_ASK }))

describe('stepMoodPrompt', () => {
  test('starts by counting from zero', () => {
    expect(initialMoodPrompt()).toEqual(MoodPrompt.Counting({ heard: 0 }))
  })

  test('counts played songs of both origins and ignores other stats', () => {
    const stats = [
      ...played(1, 'Visitor'),
      ...played(1, 'Autoplay'),
      PlayStat.Clicked({ songId: 'x' }),
      PlayStat.Finished({ songId: 'x', origin: 'Visitor' }),
      PlayStat.Skipped({ songId: 'x', origin: 'Visitor', secondsIntoSong: 3 }),
    ]
    expect(stepMoodPrompt(initialMoodPrompt(), stats, Option.none())).toEqual(
      MoodPrompt.Counting({ heard: 2 }),
    )
  })

  test('does not ask before enough songs have played', () => {
    expect(
      stepMoodPrompt(
        MoodPrompt.Counting({ heard: 0 }),
        played(HEARD_WHEN_ASKING - 1),
        late,
      )._tag,
    ).toBe('Counting')
  })

  test('does not ask before the song has played a while', () => {
    const early = Option.some(
      standing({ secondsIntoSong: SECONDS_BEFORE_ASK - 1 }),
    )
    expect(
      stepMoodPrompt(
        MoodPrompt.Counting({ heard: HEARD_WHEN_ASKING }),
        [],
        early,
      )._tag,
    ).toBe('Counting')
  })

  test('does not ask while the song is not playing', () => {
    const paused = Option.some(
      standing({ isPlaying: false, secondsIntoSong: 90 }),
    )
    expect(
      stepMoodPrompt(
        MoodPrompt.Counting({ heard: HEARD_WHEN_ASKING }),
        [],
        paused,
      )._tag,
    ).toBe('Counting')
  })

  test('asks about the song standing once both thresholds are met', () => {
    expect(
      stepMoodPrompt(
        MoodPrompt.Counting({ heard: HEARD_WHEN_ASKING }),
        [],
        late,
      ),
    ).toEqual(MoodPrompt.Asking({ songId: 's4', playId: 4, picked: [] }))
  })

  test('keeps asking, with its picks, while the same play carries on', () => {
    const asking = MoodPrompt.Asking({
      songId: 's4',
      playId: 4,
      picked: ['ceria'],
    })
    expect(stepMoodPrompt(asking, [], late)).toEqual(asking)
  })

  test.each([
    ['another song', standing({ songId: 's5' })],
    ['another play of the song', standing({ playId: 5 })],
    ['a gone stream', standing({ hasGoneStream: true })],
    ['a failed load', standing({ hasFailedLoad: true })],
  ])('goes back to counting on %s, ready to ask again', (_label, next) => {
    const asking = MoodPrompt.Asking({
      songId: 's4',
      playId: 4,
      picked: ['ceria'],
    })
    const counting = stepMoodPrompt(asking, [], Option.some(next))
    expect(counting).toEqual(MoodPrompt.Counting({ heard: HEARD_WHEN_ASKING }))
    const healthy = standing({
      ...next,
      isPlaying: true,
      hasGoneStream: false,
      hasFailedLoad: false,
      secondsIntoSong: 60,
    })
    expect(stepMoodPrompt(counting, [], Option.some(healthy))._tag).toBe(
      'Asking',
    )
  })

  test('keeps asking, with its picks, through a pause and a resume', () => {
    const asking = MoodPrompt.Asking({
      songId: 's4',
      playId: 4,
      picked: ['ceria'],
    })
    const paused = Option.some(
      standing({ isPlaying: false, secondsIntoSong: 60 }),
    )
    expect(stepMoodPrompt(asking, [], paused)).toEqual(asking)
    expect(stepMoodPrompt(asking, [], late)).toEqual(asking)
  })

  test('goes back to counting when nothing is playing', () => {
    const asking = MoodPrompt.Asking({ songId: 's4', playId: 4, picked: [] })
    expect(stepMoodPrompt(asking, [], Option.none())._tag).toBe('Counting')
  })

  test('done is terminal', () => {
    expect(stepMoodPrompt(MoodPrompt.Done(), played(9), late)).toEqual(
      MoodPrompt.Done(),
    )
  })
})
