import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Radio: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const radioRouter = pipe(Route.root, Route.mapTo(AppRoute.Radio))

export const urlToAppRoute = Route.parseUrlWithFallback(
  radioRouter,
  AppRoute.NotFound,
)
