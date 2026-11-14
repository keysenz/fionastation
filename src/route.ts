import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion } from 'foldkit/route'

import { PlaylistId } from './playlist.ts'

export const AppRoute = defineRouteUnion({
  Radio: {},
  Playlist: { id: PlaylistId },
  Songs: {},
  Studio: {},
  Hire: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const radioRouter = pipe(Route.root, Route.mapTo(AppRoute.Radio))
export const playlistRouter = pipe(
  Route.literal('p'),
  Route.slash(Route.schemaSegment('id', PlaylistId)),
  Route.mapTo(AppRoute.Playlist),
)
export const songsRouter = pipe(
  Route.literal('songs'),
  Route.mapTo(AppRoute.Songs),
)

export const hireRouter = pipe(
  Route.literal('hire'),
  Route.mapTo(AppRoute.Hire),
)

export const studioRouter = pipe(
  Route.literal('studio'),
  Route.mapTo(AppRoute.Studio),
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(
    radioRouter,
    playlistRouter,
    songsRouter,
    hireRouter,
    studioRouter,
  ),
  AppRoute.NotFound,
)

export const isRadioRoute = AppRoute.isAnyOf(['Radio', 'Playlist'])
