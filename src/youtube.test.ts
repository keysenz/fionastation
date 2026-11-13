import { Effect, Fiber, Stream } from 'effect'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { PlayerEvent } from './youtube'

type PlayerEvents = Readonly<{
  onReady: () => void
  onStateChange: (event: Readonly<{ data: number }>) => void
  onError: (event: Readonly<{ data: number }>) => void
}>

const VIDEO = { videoId: 'abc', startSeconds: 60 }
const HOST_ID = 'test-host'
const ENDED = 0
const PLAYING = 1
const PAUSED = 2
const BUFFERING = 3
const DURATION = 58.2

const makeYouTube = () => {
  const loadedVideos: Array<typeof VIDEO> = []
  const players: Array<PlayerEvents> = []
  const clock = { seconds: 0, duration: DURATION, pauses: 0 }
  class Player {
    constructor(_target: HTMLElement, options: { events: PlayerEvents }) {
      players.push(options.events)
      queueMicrotask(options.events.onReady)
    }
    loadVideoById(video: typeof VIDEO) {
      loadedVideos.push(video)
    }
    getCurrentTime() {
      return clock.seconds
    }
    getDuration() {
      return clock.duration
    }
    pauseVideo() {
      clock.pauses += 1
    }
    getPlayerState() {
      return BUFFERING
    }
    destroy() {}
  }
  return { api: { Player }, loadedVideos, players, clock }
}

const scriptRequests: Array<HTMLScriptElement> = []
const running: Array<Fiber.Fiber<unknown, unknown>> = []

/** Stands in for the network: the script either arrives with the API or errors. */
const answerScript = (
  script: HTMLScriptElement | undefined,
  answer: 'Arrives' | 'Fails',
  youTube = makeYouTube(),
) => {
  if (answer === 'Fails') {
    script?.onerror?.(new Event('error'))
    return youTube
  }
  Object.assign(window, { YT: youTube.api })
  window.onYouTubeIframeAPIReady?.()
  return youTube
}

const start = async () => {
  const { runPlayer, videoEvents } = await import('./youtube')
  const mount = () =>
    running.push(
      Effect.runFork(
        Effect.scoped(
          runPlayer(document.createElement('div'), {
            hostId: HOST_ID,
            playerVars: {},
          }).pipe(Effect.andThen(Effect.never)),
        ),
      ),
    )
  const play = () => {
    const events: Array<PlayerEvent> = []
    running.push(
      Effect.runFork(
        Stream.runForEach(videoEvents(HOST_ID, VIDEO), event =>
          Effect.sync(() => events.push(event)),
        ),
      ),
    )
    return events
  }
  return { mount, play }
}

const tagsOf = (events: ReadonlyArray<PlayerEvent>) =>
  events.map(({ _tag }) => _tag)

beforeEach(() => {
  vi.resetModules()
  scriptRequests.length = 0
  Reflect.deleteProperty(window, 'YT')
  vi.spyOn(document.head, 'append').mockImplementation(node => {
    if (node instanceof HTMLScriptElement) {
      scriptRequests.push(node)
    }
  })
})

afterEach(async () => {
  await Effect.runPromise(Fiber.interruptAll(running.splice(0)))
  vi.restoreAllMocks()
})

const errorOnLoadedVideo = async (code: number) => {
  const { mount, play } = await start()
  mount()
  const events = play()
  const { loadedVideos, players } = answerScript(scriptRequests[0], 'Arrives')
  await vi.waitFor(() => expect(loadedVideos).toEqual([VIDEO]))
  players[0]?.onError({ data: code })
  await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))
  return events
}

test.each([100, 101, 150])(
  'YouTube error %i reports the video gone',
  async code => {
    expect(await errorOnLoadedVideo(code)).toEqual([{ _tag: 'VideoGone' }])
  },
)

test.each([2, 5, 153, 999])(
  'YouTube error %i reports a load that failed, and not a gone video',
  async code => {
    expect(await errorOnLoadedVideo(code)).toEqual([
      { _tag: 'LoadFailed', reason: 'VideoUnplayable' },
    ])
  },
)

test('a script that did not load is asked for again by the next play, which then loads its video in the player that was waiting', async () => {
  const { mount, play } = await start()
  mount()
  const firstPlay = play()
  expect(scriptRequests).toHaveLength(1)
  answerScript(scriptRequests[0], 'Fails')
  await vi.waitFor(() =>
    expect(firstPlay).toEqual([
      { _tag: 'LoadFailed', reason: 'PlayerUnavailable' },
    ]),
  )

  const secondPlay = play()
  await vi.waitFor(() => expect(scriptRequests).toHaveLength(2))
  answerScript(scriptRequests[1], 'Fails')
  await vi.waitFor(() =>
    expect(secondPlay).toEqual([
      { _tag: 'LoadFailed', reason: 'PlayerUnavailable' },
    ]),
  )

  const thirdPlay = play()
  await vi.waitFor(() => expect(scriptRequests).toHaveLength(3))
  const { loadedVideos, players } = answerScript(scriptRequests[2], 'Arrives')
  await vi.waitFor(() => expect(loadedVideos).toEqual([VIDEO]))
  players[0]?.onStateChange({ data: BUFFERING })
  await vi.waitFor(() => expect(tagsOf(thirdPlay)).toContain('Ready'))
  expect(players).toHaveLength(1)
})

test('a script that loaded is not asked for again by later plays', async () => {
  const { mount, play } = await start()
  mount()
  play()
  const { loadedVideos } = answerScript(scriptRequests[0], 'Arrives')
  await vi.waitFor(() => expect(loadedVideos).toHaveLength(1))
  play()
  await vi.waitFor(() => expect(loadedVideos).toHaveLength(2))
  expect(scriptRequests).toHaveLength(1)
})

const playLoaded = async () => {
  const { mount, play } = await start()
  mount()
  const events = play()
  const youTube = answerScript(scriptRequests[0], 'Arrives')
  await vi.waitFor(() => expect(youTube.loadedVideos).toEqual([VIDEO]))
  const { clock } = youTube
  const report = (state: number, seconds: number) => {
    clock.seconds = seconds
    youTube.players[0]?.onStateChange({ data: state })
  }
  return { events, clock, report }
}

const progressedTo = (events: ReadonlyArray<PlayerEvent>, seconds: number) =>
  events.some(event => event._tag === 'Progressed' && event.seconds === seconds)

const tagsAfterFirstEnd = (events: ReadonlyArray<PlayerEvent>) =>
  tagsOf(events).slice(tagsOf(events).indexOf('Ended'))

test('a video that wraps to its start on its own ends once, and is paused there', async () => {
  const { events, clock, report } = await playLoaded()
  report(PLAYING, 40)
  report(BUFFERING, DURATION - 0.1)
  report(PLAYING, DURATION - 0.05)
  report(BUFFERING, 0)
  report(PLAYING, 0.1)
  report(PAUSED, 0.1)
  report(BUFFERING, 7)
  await vi.waitFor(() => expect(progressedTo(events, 7)).toBe(true))
  const afterEnd = tagsAfterFirstEnd(events)
  expect(afterEnd.filter(tag => tag === 'Ended')).toHaveLength(1)
  expect(afterEnd).not.toContain('Playing')
  expect(afterEnd).not.toContain('Paused')
  expect(clock.pauses).toBe(1)
})

test('dragging back to the start after a video ended does not end it again', async () => {
  const { events, clock, report } = await playLoaded()
  report(PLAYING, 40)
  report(PLAYING, DURATION - 0.5)
  report(ENDED, DURATION)
  report(BUFFERING, 0)
  report(PLAYING, 0.2)
  await vi.waitFor(() => expect(progressedTo(events, 0.2)).toBe(true))
  expect(tagsOf(events).filter(tag => tag === 'Ended')).toHaveLength(1)
  expect(clock.pauses).toBe(0)
})

test('seeking back to the start from the middle of a video does not end it', async () => {
  const { events, clock, report } = await playLoaded()
  report(PLAYING, 20)
  report(BUFFERING, 0)
  report(PLAYING, 0.2)
  await vi.waitFor(() => expect(progressedTo(events, 0.2)).toBe(true))
  expect(tagsOf(events)).not.toContain('Ended')
  expect(clock.pauses).toBe(0)
})

test('a new load that first reads the previous video at its end does not end', async () => {
  const { events, clock, report } = await playLoaded()
  report(BUFFERING, DURATION - 0.1)
  report(BUFFERING, 0)
  report(PLAYING, 0.2)
  await vi.waitFor(() => expect(progressedTo(events, 0.2)).toBe(true))
  expect(tagsOf(events)).not.toContain('Ended')
  expect(clock.pauses).toBe(0)
})
