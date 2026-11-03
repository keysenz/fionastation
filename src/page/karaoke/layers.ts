import { Array, Option } from 'effect'

/** Overlays from the bottom of the stack to the top, which is the order the
 *  Back button closes them in: the info panel, then the player, then the queue. */
export const OVERLAYS = ['queue', 'player', 'info'] as const
export type Overlay = (typeof OVERLAYS)[number]

/** What the visitor has open, as the address bar shows it. */
export type Layers = {
  maybeVideoId: Option.Option<string>
  overlays: ReadonlyArray<Overlay>
}

export const parseLayers = (search: string): Layers => {
  const params = new URLSearchParams(search)
  const videoId = params.get('v')
  const named = (params.get('o') ?? '').split(',')
  return {
    maybeVideoId: Option.filter(Option.fromNullishOr(videoId), id => id !== ''),
    overlays: OVERLAYS.filter(overlay => named.includes(overlay)),
  }
}

/** The path and query for a state, always on the one page. */
export const layersToUrl = ({ maybeVideoId, overlays }: Layers): string => {
  const params = new URLSearchParams()
  Option.map(maybeVideoId, id => params.set('v', id))
  if (Array.isReadonlyArrayNonEmpty(overlays)) {
    params.set('o', overlays.join(','))
  }
  const query = params.toString()
  return query === '' ? '/' : `/?${query}`
}

export type LayerChange =
  | 'Unchanged'
  | 'OpenVideo'
  | 'OpenOverlay'
  | 'Replace'
  | 'Close'

/** Opening anything adds a history entry, so Back can undo it. Closing removes
 *  one. Choosing another video replaces the entry, so a desktop visitor who
 *  clicks through videos does not stack one entry per click. */
export const classifyChange = (before: Layers, after: Layers): LayerChange => {
  const openedOverlay = after.overlays.some(
    overlay => !before.overlays.includes(overlay),
  )
  const closedOverlay = before.overlays.some(
    overlay => !after.overlays.includes(overlay),
  )
  if (openedOverlay) {
    return 'OpenOverlay'
  }
  if (closedOverlay) {
    return 'Close'
  }
  return Option.match(before.maybeVideoId, {
    onNone: () =>
      Option.isSome(after.maybeVideoId) ? 'OpenVideo' : 'Unchanged',
    onSome: beforeId =>
      Option.match(after.maybeVideoId, {
        onNone: () => 'Close',
        onSome: afterId => (afterId === beforeId ? 'Unchanged' : 'Replace'),
      }),
  })
}
