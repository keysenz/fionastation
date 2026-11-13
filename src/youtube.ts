import {
  Duration,
  Effect,
  Option,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

type YouTubePlayer = Readonly<{
  playVideo: () => void
  pauseVideo: () => void
  setVolume: (level: number) => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  mute: () => void
  unMute: () => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  loadVideoById: (
    video: Readonly<{ videoId: string; startSeconds: number }>,
  ) => void
  destroy: () => void
}>

type YouTubeApi = Readonly<{
  Player: new (
    target: HTMLElement,
    options: Readonly<{
      width: string
      height: string
      playerVars: PlayerVars
      events: Readonly<{
        onReady: () => void
        onStateChange: (event: Readonly<{ data: number }>) => void
        onError: (event: Readonly<{ data: number }>) => void
      }>
    }>,
  ) => YouTubePlayer
}>

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

export type PlayerVars = Readonly<Record<string, number>>

export type ThumbnailSize = 'default' | 'mqdefault' | 'hqdefault'

export const thumbnailUrl = (
  videoId: string,
  size: ThumbnailSize = 'default',
): string => `https://img.youtube.com/vi/${videoId}/${size}.jpg`

/** Why a video did not load, when YouTube may still have it. */
export const LoadFailure = Schema.Literals([
  'PlayerUnavailable',
  'VideoUnplayable',
])
export type LoadFailure = typeof LoadFailure.Type

export const PlayerEvent = defineTaggedUnion({
  Ready: {},
  Playing: {},
  Paused: {},
  Ended: {},
  VideoGone: {},
  LoadFailed: { reason: LoadFailure },
  Progressed: { seconds: Schema.Number },
})
export type PlayerEvent = typeof PlayerEvent.Type

const PROGRESS_INTERVAL = Duration.millis(250)
const PROGRESS_EPSILON_SECONDS = 0.05

// NOTE: an embedded YouTube Short never reports its end. It jumps back to its start and plays again, so a jump from this close to the end to this close to the start counts as the end.
const WRAP_MARGIN_SECONDS = 1.5

// NOTE: YouTube's onError codes for a video that is removed, private or not embeddable. Every other code can pass on a later load.
const GONE_ERROR_CODES: ReadonlySet<number> = new Set([100, 101, 150])

const STATE_UNSTARTED = -1
const STATE_ENDED = 0
const STATE_PLAYING = 1
const STATE_PAUSED = 2
const STATE_CUED = 5

// NOTE: a browser that blocks autoplay leaves the video unstarted and says nothing, so a video that sits there this long counts as paused.
const BLOCKED_AFTER_TICKS =
  Duration.toMillis(Duration.seconds(3)) / Duration.toMillis(PROGRESS_INTERVAL)

const loadApiScript = (): Promise<YouTubeApi> =>
  new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) {
        resolve(window.YT)
      } else {
        reject(new Error('YouTube loaded without its player API'))
      }
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      script.remove()
      reject(new Error('Could not load the YouTube player'))
    }
    document.head.append(script)
  })

const apiRef = Effect.runSync(SubscriptionRef.make(Option.none<YouTubeApi>()))

const apiLoad = { maybeAttempt: Option.none<Promise<YouTubeApi>>() }

// NOTE: the page loads YouTube's script once, however many players mount. A failed attempt is forgotten, so the next play asks for the script again.
const attemptApi = (): Promise<YouTubeApi> =>
  Option.getOrElse(apiLoad.maybeAttempt, () => {
    const attempt = loadApiScript()
    apiLoad.maybeAttempt = Option.some(attempt)
    attempt.then(
      api => Effect.runSync(SubscriptionRef.set(apiRef, Option.some(api))),
      () => {
        apiLoad.maybeAttempt = Option.none()
      },
    )
    return attempt
  })

const loadApi = Effect.tryPromise(attemptApi)

/** The API once any attempt has loaded it. A player that mounts while the
 *  script is failing waits here, and the play that retries the script wakes it. */
const loadedApi: Effect.Effect<YouTubeApi> = loadApi.pipe(
  Effect.ignore,
  Effect.andThen(
    SubscriptionRef.changes(apiRef).pipe(
      Stream.filter(Option.isSome),
      Stream.runHead,
    ),
  ),
  Effect.flatMap(maybeApi =>
    Option.match(Option.flatten(maybeApi), {
      onNone: () => Effect.never,
      onSome: api => Effect.succeed(api),
    }),
  ),
)

type PlayerReport =
  | Readonly<{ kind: 'StateChanged'; state: number }>
  | Readonly<{ kind: 'Failed'; code: number }>
  | Readonly<{ kind: 'PlayRequested' }>

type Host = Readonly<{
  player: YouTubePlayer
  listeners: Set<(report: PlayerReport) => void>
}>

const hostsById = new Map<
  string,
  SubscriptionRef.SubscriptionRef<Option.Option<Host>>
>()

const hostRef = (hostId: string) => {
  const known = hostsById.get(hostId)
  if (known) {
    return known
  }
  const ref = Effect.runSync(SubscriptionRef.make(Option.none<Host>()))
  hostsById.set(hostId, ref)
  return ref
}

const currentHost = (hostId: string): Host | undefined =>
  Option.getOrUndefined(Effect.runSync(SubscriptionRef.get(hostRef(hostId))))

const stateChangeToEvent = (state: number): Option.Option<PlayerEvent> => {
  if (state === STATE_PLAYING) {
    return Option.some(PlayerEvent.Playing())
  }
  if (state === STATE_PAUSED) {
    return Option.some(PlayerEvent.Paused())
  }
  if (state === STATE_ENDED) {
    return Option.some(PlayerEvent.Ended())
  }
  return Option.none()
}

/** Runs one empty YouTube player inside `element` until the scope closes, so
 *  removing the element from the view destroys the player. The player replaces
 *  the node it gets, so it gets a child the renderer does not own. Videos play
 *  in it through `videoEvents`. */
export const runPlayer = (
  element: Element,
  options: Readonly<{ hostId: string; playerVars: PlayerVars }>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const api = yield* loadedApi
    const ref = hostRef(options.hostId)
    const listeners = new Set<(report: PlayerReport) => void>()
    const report = (playerReport: PlayerReport) =>
      listeners.forEach(listener => listener(playerReport))
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const target = document.createElement('div')
        element.append(target)
        const player: YouTubePlayer = new api.Player(target, {
          width: '100%',
          height: '100%',
          playerVars: options.playerVars,
          events: {
            onReady: () =>
              Effect.runSync(
                SubscriptionRef.set(ref, Option.some({ player, listeners })),
              ),
            onStateChange: ({ data }) =>
              report({ kind: 'StateChanged', state: data }),
            onError: ({ data }) => report({ kind: 'Failed', code: data }),
          },
        })
        return player
      }),
      player =>
        Effect.gen(function* () {
          yield* SubscriptionRef.update(ref, maybeHost =>
            Option.filter(maybeHost, host => host.player !== player),
          )
          player.destroy()
        }),
    )
  })

/** How a load stands toward its end. It waits for its own first play, so the
 *  previous video's end time cannot read as a wrap. After a wrap it swallows
 *  reports until the pause it asked for lands, so the wrap looks like an end. */
type Ending = 'WaitingToPlay' | 'Watching' | 'PausingAtWrap' | 'Ended'

const loadedVideoEvents = (
  host: Host,
  video: Readonly<{ videoId: string; startSeconds: number }>,
): Stream.Stream<PlayerEvent> =>
  Stream.callback<PlayerEvent>(queue =>
    Effect.gen(function* () {
      const progress: {
        isLoaded: boolean
        lastSeconds: number
        unstartedTicks: number
        ending: Ending
      } = {
        isLoaded: false,
        lastSeconds: Number.NEGATIVE_INFINITY,
        unstartedTicks: 0,
        ending: 'WaitingToPlay',
      }
      const isNearEnd = (seconds: number) => {
        const duration = host.player.getDuration()
        return (
          duration > 2 * WRAP_MARGIN_SECONDS &&
          seconds >= duration - WRAP_MARGIN_SECONDS
        )
      }
      const offerProgress = (isForced: boolean) => {
        const seconds = host.player.getCurrentTime()
        if (
          !progress.isLoaded ||
          !Number.isFinite(seconds) ||
          progress.ending === 'PausingAtWrap'
        ) {
          return
        }
        if (
          progress.ending === 'Watching' &&
          seconds <= WRAP_MARGIN_SECONDS &&
          isNearEnd(progress.lastSeconds)
        ) {
          progress.ending = 'PausingAtWrap'
          progress.lastSeconds = seconds
          host.player.pauseVideo()
          Queue.offerUnsafe(queue, PlayerEvent.Ended())
          return
        }
        if (progress.ending === 'Ended' && !isNearEnd(seconds)) {
          progress.ending = 'Watching'
        }
        if (
          isForced ||
          Math.abs(seconds - progress.lastSeconds) >= PROGRESS_EPSILON_SECONDS
        ) {
          progress.lastSeconds = seconds
          Queue.offerUnsafe(queue, PlayerEvent.Progressed({ seconds }))
        }
      }
      const reportIfBlocked = () => {
        const state = host.player.getPlayerState()
        const isUnstarted = state === STATE_UNSTARTED || state === STATE_CUED
        progress.unstartedTicks =
          progress.isLoaded && isUnstarted ? progress.unstartedTicks + 1 : 0
        if (progress.unstartedTicks === BLOCKED_AFTER_TICKS) {
          Queue.offerUnsafe(queue, PlayerEvent.Paused())
        }
      }
      const listener = (report: PlayerReport) => {
        if (report.kind === 'PlayRequested') {
          progress.unstartedTicks = 0
          if (progress.ending === 'PausingAtWrap') {
            progress.ending = 'Ended'
          }
          return
        }
        if (report.kind === 'Failed') {
          Queue.offerUnsafe(
            queue,
            GONE_ERROR_CODES.has(report.code)
              ? PlayerEvent.VideoGone()
              : PlayerEvent.LoadFailed({ reason: 'VideoUnplayable' }),
          )
          return
        }
        // NOTE: loading over a playing video first reports that video's pause, and an end can still be on its way.
        if (!progress.isLoaded) {
          if (report.state === STATE_PAUSED || report.state === STATE_ENDED) {
            return
          }
          progress.isLoaded = true
          Queue.offerUnsafe(queue, PlayerEvent.Ready())
        }
        // NOTE: a seek made with YouTube's own controls changes the state, so this reports it before the next tick.
        offerProgress(true)
        if (progress.ending === 'PausingAtWrap') {
          if (report.state === STATE_PAUSED) {
            progress.ending = 'Ended'
          }
          return
        }
        if (
          report.state === STATE_PLAYING &&
          progress.ending === 'WaitingToPlay'
        ) {
          progress.ending = 'Watching'
        }
        if (report.state === STATE_ENDED) {
          progress.ending = 'Ended'
        }
        Option.match(stateChangeToEvent(report.state), {
          onNone: () => false,
          onSome: event => Queue.offerUnsafe(queue, event),
        })
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          host.listeners.add(listener)
          host.player.loadVideoById(video)
        }),
        () => Effect.sync(() => host.listeners.delete(listener)),
      )
      yield* Effect.forkScoped(
        Effect.sync(() => {
          offerProgress(false)
          reportIfBlocked()
        }).pipe(Effect.repeat(Schedule.spaced(PROGRESS_INTERVAL))),
      )
      return yield* Effect.never
    }),
  )

/** Plays one video in the player that `runPlayer` runs for `hostId`, waiting
 *  for that player when it is not ready yet. Ending the stream stops listening,
 *  and the next `videoEvents` call replaces the video in the same player, which
 *  keeps the play permission a browser gave that player. */
export const videoEvents = (
  hostId: string,
  video: Readonly<{ videoId: string; startSeconds: number }>,
): Stream.Stream<PlayerEvent> =>
  Stream.unwrap(
    loadApi.pipe(
      Effect.as(
        SubscriptionRef.changes(hostRef(hostId)).pipe(
          Stream.switchMap(maybeHost =>
            Option.match(maybeHost, {
              onNone: () => Stream.empty,
              onSome: host => loadedVideoEvents(host, video),
            }),
          ),
        ),
      ),
      Effect.catch(() =>
        Effect.succeed(
          Stream.make(PlayerEvent.LoadFailed({ reason: 'PlayerUnavailable' })),
        ),
      ),
    ),
  )

export const setPlaying = (
  hostId: string,
  isPlaying: boolean,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const host = currentHost(hostId)
    if (isPlaying) {
      host?.player.playVideo()
      host?.listeners.forEach(listener => listener({ kind: 'PlayRequested' }))
    } else {
      host?.player.pauseVideo()
    }
  })

export const seekTo = (hostId: string, seconds: number): Effect.Effect<void> =>
  Effect.sync(() => {
    currentHost(hostId)?.player.seekTo(seconds, true)
  })

/** iOS Safari ignores a page's volume, so there only mute has an effect. */
export const setVolume = (
  hostId: string,
  level: number,
  isMuted: boolean,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const player = currentHost(hostId)?.player
    player?.setVolume(level)
    if (isMuted) {
      player?.mute()
    } else {
      player?.unMute()
    }
  })
