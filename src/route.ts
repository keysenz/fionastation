import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Radio: {},
  Songs: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const radioRouter = pipe(Route.root, Route.mapTo(AppRoute.Radio))
export const songsRouter = pipe(
  Route.literal('songs'),
  Route.mapTo(AppRoute.Songs),
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(radioRouter, songsRouter),
  AppRoute.NotFound,
)
