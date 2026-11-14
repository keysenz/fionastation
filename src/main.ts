import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, Update } from 'foldkit'
import { type Document, type Html, type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import * as Endorse from './page/commission/endorse'
import * as Hire from './page/commission/hire'
import * as Studio from './page/commission/studio'
import * as Karaoke from './page/karaoke/karaoke'
import { editTokenOfHash } from './page/karaoke/playlists'
import { view as karaokeView } from './page/karaoke/view'
import * as Songs from './page/songs/songs'
import { view as songsView } from './page/songs/view'
import { notFoundView } from './page/static'
import { AppRoute, isRadioRoute, urlToAppRoute } from './route'

// MODEL

export const Model = Schema.Struct({
  route: AppRoute,
  karaoke: Karaoke.Model,
  songs: Songs.Model,
  endorse: Endorse.Model,
  studio: Studio.Model,
  hire: Hire.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  GotKaraokeMessage: { message: Karaoke.Message },
  GotSongsMessage: { message: Songs.Message },
  GotEndorseMessage: { message: Endorse.Message },
  GotStudioMessage: { message: Studio.Message },
  GotHireMessage: { message: Hire.Message },
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

const songsChild = {
  read: (model: Model) => Option.some(model.songs),
  write: (model: Model, nextSongs: Songs.Model) =>
    modifyFields(model, { songs: () => nextSongs }),
  toParentMessage: (message: Songs.Message): Message =>
    Message.GotSongsMessage({ message }),
}

const foldSongs = Update.foldChild({ update: Songs.update, ...songsChild })
const foldSongsEntered = Update.foldChildStep({
  update: Songs.entered,
  ...songsChild,
})

const hireChild = {
  read: (model: Model) => Option.some(model.hire),
  write: (model: Model, nextHire: Hire.Model) =>
    modifyFields(model, { hire: () => nextHire }),
  toParentMessage: (message: Hire.Message): Message =>
    Message.GotHireMessage({ message }),
}

const foldHire = Update.foldChild({ update: Hire.update, ...hireChild })

const studioChild = {
  read: (model: Model) => Option.some(model.studio),
  write: (model: Model, nextStudio: Studio.Model) =>
    modifyFields(model, { studio: () => nextStudio }),
  toParentMessage: (message: Studio.Message): Message =>
    Message.GotStudioMessage({ message }),
}

const foldStudio = Update.foldChild({ update: Studio.update, ...studioChild })

const endorseChild = {
  read: (model: Model) => Option.some(model.endorse),
  write: (model: Model, nextEndorse: Endorse.Model) =>
    modifyFields(model, { endorse: () => nextEndorse }),
  toParentMessage: (message: Endorse.Message): Message =>
    Message.GotEndorseMessage({ message }),
}

const foldEndorse = Update.foldChild({
  update: Endorse.update,
  ...endorseChild,
})

export const subscriptions = Subscription.lift(Karaoke.subscriptions)<
  Model,
  Message
>({
  read: karaokeChild.read,
  toParentMessage: karaokeChild.toParentMessage,
  when: model => isRadioRoute(model.route),
})

const isSameRoute = (previous: AppRoute, next: AppRoute): boolean =>
  previous._tag === next._tag &&
  (previous._tag !== 'Playlist' ||
    (next._tag === 'Playlist' && previous.id === next.id))

const enterRoute =
  (url: Url) =>
  (model: Model): UpdateReturn =>
    AppRoute.match<UpdateReturn>(model.route, {
      NotFound: () => ({ model }),
      Radio: () => foldKaraokeEntered(model),
      Playlist: ({ id }) =>
        Update.combine(model, [
          foldKaraokeStep(karaoke =>
            Karaoke.openedPlaylist(karaoke, id, editTokenOfHash(url.hash)),
          ),
          foldKaraokeEntered,
        ]),
      Songs: () => foldSongsEntered(model),
      Endorse: () => ({ model }),
      Studio: () => ({ model }),
      Hire: () => ({ model }),
    })

const pickUpEditToken =
  (url: Url) =>
  (model: Model): UpdateReturn =>
    AppRoute.match<UpdateReturn>(model.route, {
      Playlist: ({ id }) =>
        Option.match(editTokenOfHash(url.hash), {
          onNone: () => ({ model }),
          onSome: editToken =>
            foldKaraokeStep(karaoke =>
              Karaoke.pickedUpEditToken(karaoke, id, editToken),
            )(model),
        }),
      Radio: () => ({ model }),
      Songs: () => ({ model }),
      Endorse: () => ({ model }),
      Studio: () => ({ model }),
      Hire: () => ({ model }),
      NotFound: () => ({ model }),
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
      const isStaying = isSameRoute(model.route, nextRoute)
      const leftPlaylist =
        model.route._tag === 'Playlist' && nextRoute._tag !== 'Playlist'
          ? foldKaraokeStep(Karaoke.leftPlaylist)
          : (next: Model) => ({ model: next })
      const enter = (next: Model): UpdateReturn =>
        isRadioRoute(nextRoute)
          ? Update.combine(next, [
              isStaying ? pickUpEditToken(url) : enterRoute(url),
              layers,
            ])
          : isStaying
            ? { model: next }
            : enterRoute(url)(next)
      return Update.combine(nextModel, [leftPlaylist, enter])
    },

    GotKaraokeMessage: ({ message }) => foldKaraoke(model, message),
    GotSongsMessage: ({ message }) => foldSongs(model, message),
    GotEndorseMessage: ({ message }) => foldEndorse(model, message),
    GotStudioMessage: ({ message }) => foldStudio(model, message),
    GotHireMessage: ({ message }) => foldHire(model, message),
  })

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = url => {
  const start = {
    route: urlToAppRoute(url),
    karaoke: Karaoke.init(),
    songs: Songs.init(),
    endorse: Endorse.init(),
    studio: Studio.init(),
    hire: Hire.init(),
  }
  return isRadioRoute(start.route)
    ? Update.combine(start, [
        enterRoute(url),
        foldKaraokeStep(model => Karaoke.openedFromUrl(model, searchOf(url))),
      ])
    : enterRoute(url)(start)
}

// VIEW

const radioView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'karaoke',
    model: model.karaoke,
    view: karaokeView,
    toParentMessage: message => Message.GotKaraokeMessage({ message }),
  })

const routeView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  AppRoute.match<ReadonlyArray<Html>>(model.route, {
    NotFound: () => [notFoundView(h)],
    Radio: () => [radioView(model, h)],
    Playlist: () => [radioView(model, h)],
    Songs: () => [
      h.submodel({
        slotId: 'songs',
        model: model.songs,
        view: songsView,
        toParentMessage: message => Message.GotSongsMessage({ message }),
      }),
    ],
    Endorse: () => [
      h.submodel({
        slotId: 'endorse',
        model: model.endorse,
        view: Endorse.view,
        toParentMessage: message => Message.GotEndorseMessage({ message }),
      }),
    ],
    Studio: () => [
      h.submodel({
        slotId: 'studio',
        model: model.studio,
        view: Studio.view,
        toParentMessage: message => Message.GotStudioMessage({ message }),
      }),
    ],
    Hire: () => [
      h.submodel({
        slotId: 'hire',
        model: model.hire,
        view: Hire.view,
        toParentMessage: message => Message.GotHireMessage({ message }),
      }),
    ],
  })

const titleOf = (model: Model): string =>
  AppRoute.match<string>(model.route, {
    Songs: () => 'Songs | Fio Radio',
    Endorse: () => 'Endorse Fio | Fio Radio',
    Studio: () => 'Paopoa Studio | Fio Radio',
    Hire: () => "Hire Fio's voice | Fio Radio",
    Playlist: () =>
      Option.match(Karaoke.openedPlaylistNameOf(model.karaoke), {
        onNone: () => 'Fio Radio',
        onSome: name => `${name} | Fio Radio`,
      }),
    Radio: () => 'Fio Radio',
    NotFound: () => 'Fio Radio',
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
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
