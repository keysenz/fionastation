import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, Update } from 'foldkit'
import { type Document, type Html, type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import * as Cover from './page/cover'
import * as Karaoke from './page/karaoke/karaoke'
import { view as karaokeView } from './page/karaoke/view'
import { aboutView, creditsView, homeView, notFoundView } from './page/static'
import { AppRoute, urlToAppRoute } from './route'

// MODEL

export const Model = Schema.Struct({
  route: AppRoute,
  karaoke: Karaoke.Model,
  cover: Cover.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  GotKaraokeMessage: { message: Karaoke.Message },
  GotCoverMessage: { message: Cover.Message },
})
export type Message = typeof Message.Type

// COMMAND

const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(
      Effect.andThen(Effect.sync(() => window.scrollTo(0, 0))),
      Effect.as(Message.CompletedNavigateInternal()),
    ),
})

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const karaokeChild = {
  read: (model: Model) => Option.some(model.karaoke),
  write: (model: Model, nextKaraoke: Karaoke.Model) =>
    modifyFields(model, { karaoke: () => nextKaraoke }),
  toParentMessage: (message: Karaoke.Message): Message =>
    Message.GotKaraokeMessage({ message }),
}

const coverChild = {
  read: (model: Model) => Option.some(model.cover),
  write: (model: Model, nextCover: Cover.Model) =>
    modifyFields(model, { cover: () => nextCover }),
  toParentMessage: (message: Cover.Message): Message =>
    Message.GotCoverMessage({ message }),
}

const foldKaraoke = Update.foldChild({
  update: Karaoke.update,
  ...karaokeChild,
})
const foldKaraokeEntered = Update.foldChildStep({
  update: Karaoke.entered,
  ...karaokeChild,
})
const foldCover = Update.foldChild({ update: Cover.update, ...coverChild })
const foldCoverEntered = Update.foldChildStep({
  update: Cover.entered,
  ...coverChild,
})

export const subscriptions = Subscription.lift(Karaoke.subscriptions)<
  Model,
  Message
>({
  read: karaokeChild.read,
  toParentMessage: karaokeChild.toParentMessage,
  when: model => model.route._tag === 'Karaoke',
})

const enterRoute = (model: Model): UpdateReturn =>
  AppRoute.match<UpdateReturn>(model.route, {
    Home: () => ({ model }),
    About: () => ({ model }),
    Credits: () => ({ model }),
    NotFound: () => ({ model }),
    Karaoke: () => foldKaraokeEntered(model),
    Cover: () => foldCoverEntered(model),
  })

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),

    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ href })],
        }),
      }),

    ChangedUrl: ({ url }) => {
      const nextRoute = urlToAppRoute(url)
      const nextModel = modifyFields(model, { route: () => nextRoute })
      return nextRoute._tag === model.route._tag
        ? { model: nextModel }
        : enterRoute(nextModel)
    },

    GotKaraokeMessage: ({ message }) => foldKaraoke(model, message),
    GotCoverMessage: ({ message }) => foldCover(model, message),
  })

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = url =>
  enterRoute({
    route: urlToAppRoute(url),
    karaoke: Karaoke.init(),
    cover: Cover.init(),
  })

// VIEW

const routeView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  AppRoute.match<ReadonlyArray<Html>>(model.route, {
    Home: () => [homeView(h)],
    About: () => aboutView(h),
    Credits: () => creditsView(h),
    NotFound: () => [notFoundView(h)],
    Karaoke: () => [
      h.submodel({
        slotId: 'karaoke',
        model: model.karaoke,
        view: karaokeView,
        toParentMessage: message => Message.GotKaraokeMessage({ message }),
      }),
    ],
    Cover: () => [
      h.submodel({
        slotId: 'cover',
        model: model.cover,
        view: Cover.view,
        toParentMessage: message => Message.GotCoverMessage({ message }),
      }),
    ],
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Fiona' Station ",
  body: h.div(
    [h.Class('relative flex min-h-screen flex-col overflow-x-hidden')],
    [
      h.img([
        h.Alt('Background'),
        h.Src('/pio_karaoke.webp'),
        h.Class(
          'absolute inset-0 -z-10 h-full w-full object-cover object-left lg:object-center',
        ),
      ]),
      ...routeView(model, h),
    ],
  ),
})
