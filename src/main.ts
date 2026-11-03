import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, Update } from 'foldkit'
import { type Document, type Html, type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import * as Karaoke from './page/karaoke/karaoke'
import { view as karaokeView } from './page/karaoke/view'
import { notFoundView } from './page/static'
import { AppRoute, urlToAppRoute } from './route'

// MODEL

export const Model = Schema.Struct({
  route: AppRoute,
  karaoke: Karaoke.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  GotKaraokeMessage: { message: Karaoke.Message },
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

const searchOf = (url: Url): string => Option.getOrElse(url.search, () => '')

type UpdateReturn = Update.Return<Model, Message>

const karaokeChild = {
  read: (model: Model) => Option.some(model.karaoke),
  write: (model: Model, nextKaraoke: Karaoke.Model) =>
    modifyFields(model, { karaoke: () => nextKaraoke }),
  toParentMessage: (message: Karaoke.Message): Message =>
    Message.GotKaraokeMessage({ message }),
}

const foldKaraoke = Update.foldChild({
  update: Karaoke.update,
  ...karaokeChild,
})
const foldKaraokeStep = (
  update: (model: Karaoke.Model) => Karaoke.UpdateReturn,
) => Update.foldChildStep({ update, ...karaokeChild })
const foldKaraokeEntered = Update.foldChildStep({
  update: Karaoke.entered,
  ...karaokeChild,
})

export const subscriptions = Subscription.lift(Karaoke.subscriptions)<
  Model,
  Message
>({
  read: karaokeChild.read,
  toParentMessage: karaokeChild.toParentMessage,
  when: model => model.route._tag === 'Radio',
})

const enterRoute = (model: Model): UpdateReturn =>
  AppRoute.match<UpdateReturn>(model.route, {
    NotFound: () => ({ model }),
    Radio: () => foldKaraokeEntered(model),
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
      const layers = foldKaraokeStep(model =>
        Karaoke.changedLayers(model, searchOf(url)),
      )
      return nextRoute._tag === 'Radio'
        ? Update.combine(nextModel, [
            nextRoute._tag === model.route._tag
              ? (next: Model) => ({ model: next })
              : enterRoute,
            layers,
          ])
        : { model: nextModel }
    },

    GotKaraokeMessage: ({ message }) => foldKaraoke(model, message),
  })

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = url => {
  const start = {
    route: urlToAppRoute(url),
    karaoke: Karaoke.init(),
  }
  return start.route._tag === 'Radio'
    ? Update.combine(start, [
        enterRoute,
        foldKaraokeStep(model => Karaoke.openedFromUrl(model, searchOf(url))),
      ])
    : enterRoute(start)
}

// VIEW

const routeView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  AppRoute.match<ReadonlyArray<Html>>(model.route, {
    NotFound: () => [notFoundView(h)],
    Radio: () => [
      h.submodel({
        slotId: 'karaoke',
        model: model.karaoke,
        view: karaokeView,
        toParentMessage: message => Message.GotKaraokeMessage({ message }),
      }),
    ],
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Fio Radio',
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
