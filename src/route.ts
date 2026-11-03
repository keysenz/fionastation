import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, literal } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Home: {},
  About: {},
  Radio: {},
  Cover: {},
  Credits: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home))
export const aboutRouter = pipe(literal('about'), Route.mapTo(AppRoute.About))
export const radioRouter = pipe(literal('radio'), Route.mapTo(AppRoute.Radio))
export const karaokeRouter = pipe(
  literal('karaoke'),
  Route.mapTo(AppRoute.Radio),
)
export const coverRouter = pipe(literal('cover'), Route.mapTo(AppRoute.Cover))
export const creditsRouter = pipe(
  literal('credits'),
  Route.mapTo(AppRoute.Credits),
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(
    aboutRouter,
    radioRouter,
    karaokeRouter,
    coverRouter,
    creditsRouter,
    homeRouter,
  ),
  AppRoute.NotFound,
)
