import {
  Deferred,
  Duration,
  Effect,
  Option,
  Queue,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

type YouTubePlayer = Readonly<{
  playVideo: () => void
  pauseVideo: () => void
  setVolume: (level: number) => void
  mute: () => void
  unMute: () => void
  getCurrentTime: () => number
  destroy: () => void
}>

type YouTubeApi = Readonly<{
  Player: new (
    target: HTMLElement,
    options: Readonly<{
      videoId: string
      width: string
      height: string
      playerVars: PlayerVars
      events: Readonly<{
        onReady: () => void
        onStateChange: (event: Readonly<{ data: number }>) => void
        onError: () => void
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

export const PlayerEvent = defineTaggedUnion({
  Ready: {},
  Playing: {},
  Paused: {},
  Ended: {},
  VideoFailed: { reason: Schema.String },
  PlayerFailed: { reason: Schema.String },
  Progressed: { seconds: Schema.Number },
})
export type PlayerEvent = typeof PlayerEvent.Type

const PROGRESS_INTERVAL = Duration.millis(250)
// NOTE: a paused player stays under this, so it sends nothing and the page does not re-render for it.
const PROGRESS_EPSILON_SECONDS = 0.05

const VIDEO_UNAVAILABLE = 'This video is not available on YouTube'
const PLAYER_UNAVAILABLE = 'Could not load the YouTube player'

const STATE_ENDED = 0
const STATE_PLAYING = 1
const STATE_PAUSED = 2

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
    script.onerror = () =>
      reject(new Error('Could not load the YouTube player'))
    document.head.append(script)
  })

// NOTE: the page loads YouTube's script once, however many players mount.
const loadApi = Effect.runSync(Effect.cached(Effect.tryPromise(loadApiScript)))

const playersByHostId = new Map<string, YouTubePlayer>()

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

/** Runs one YouTube player inside `element` for as long as the stream runs, so
 *  removing the element from the view destroys the player. The player replaces
 *  the node it gets, so it gets a child the renderer does not own. */
export const playerEvents = (
  element: Element,
  options: Readonly<{
    hostId: string
    videoId: string
    playerVars: PlayerVars
  }>,
): Stream.Stream<PlayerEvent> =>
  Stream.callback<PlayerEvent>(queue =>
    Effect.gen(function* () {
      const api = yield* loadApi
      const ready = yield* Deferred.make<YouTubePlayer>()
      const lastSeen = { seconds: Number.NEGATIVE_INFINITY }
      const offerProgress = (player: YouTubePlayer, isForced: boolean) => {
        const seconds = player.getCurrentTime()
        if (
          Number.isFinite(seconds) &&
          (isForced ||
            Math.abs(seconds - lastSeen.seconds) >= PROGRESS_EPSILON_SECONDS)
        ) {
          lastSeen.seconds = seconds
          Queue.offerUnsafe(queue, PlayerEvent.Progressed({ seconds }))
        }
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const target = document.createElement('div')
          element.append(target)
          const player: YouTubePlayer = new api.Player(target, {
            videoId: options.videoId,
            width: '100%',
            height: '100%',
            playerVars: options.playerVars,
            events: {
              onReady: () => {
                playersByHostId.set(options.hostId, player)
                Deferred.doneUnsafe(ready, Effect.succeed(player))
                Queue.offerUnsafe(queue, PlayerEvent.Ready())
              },
              onStateChange: ({ data }) => {
                // NOTE: a seek made with YouTube's own controls changes the state, so this reports it before the next tick.
                offerProgress(player, true)
                Option.match(stateChangeToEvent(data), {
                  onNone: () => false,
                  onSome: event => Queue.offerUnsafe(queue, event),
                })
              },
              onError: () => {
                Queue.offerUnsafe(
                  queue,
                  PlayerEvent.VideoFailed({ reason: VIDEO_UNAVAILABLE }),
                )
              },
            },
          })
          return player
        }),
        player =>
          Effect.sync(() => {
            if (playersByHostId.get(options.hostId) === player) {
              playersByHostId.delete(options.hostId)
            }
            player.destroy()
          }),
      )
      yield* Effect.forkScoped(
        Deferred.await(ready).pipe(
          Effect.flatMap(player =>
            Effect.sync(() => offerProgress(player, false)).pipe(
              Effect.repeat(Schedule.spaced(PROGRESS_INTERVAL)),
            ),
          ),
        ),
      )
      return yield* Effect.never
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() =>
          Queue.offerUnsafe(
            queue,
            PlayerEvent.PlayerFailed({ reason: PLAYER_UNAVAILABLE }),
          ),
        ),
      ),
    ),
  )

export const setPlaying = (
  hostId: string,
  isPlaying: boolean,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const player = playersByHostId.get(hostId)
    if (isPlaying) {
      player?.playVideo()
    } else {
      player?.pauseVideo()
    }
  })

/** iOS Safari ignores a page's volume, so there only mute has an effect. */
export const setVolume = (
  hostId: string,
  level: number,
  isMuted: boolean,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const player = playersByHostId.get(hostId)
    player?.setVolume(level)
    if (isMuted) {
      player?.mute()
    } else {
      player?.unMute()
    }
  })
