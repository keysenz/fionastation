import { Array, Effect, Option, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { FetchFailure, fetchJsonOrFailure } from '../../api'
import { endorseRouter, hireRouter, radioRouter } from '../../route'
import { InquiryKind } from './inquiryPayload'

// MODEL

const TrackedEvent = Schema.Struct({
  status: Schema.String,
  note: Schema.NullOr(Schema.String),
  at: Schema.String,
})

export const Tracked = Schema.Struct({
  id: Schema.String,
  kind: InquiryKind,
  createdAt: Schema.String,
  status: Schema.String,
  events: Schema.Array(TrackedEvent),
})
export type Tracked = typeof Tracked.Type

export const Lookup = defineTaggedUnion({
  Idle: {},
  Loading: {},
  Found: { tracked: Tracked },
  Missing: {},
  Failed: { error: Schema.String },
})
export type Lookup = typeof Lookup.Type

export const Model = Schema.Struct({
  id: Schema.String,
  token: Schema.Option(Schema.String),
  lookup: Lookup,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  id: '',
  token: Option.none(),
  lookup: Lookup.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededFetchCommission: { tracked: Tracked },
  MissedCommission: { id: Schema.String },
  FailedFetchCommission: { id: Schema.String, error: Schema.String },
  ClickedRetry: {},
})
export type Message = typeof Message.Type

// COMMAND

const failureText = (failure: FetchFailure): string =>
  FetchFailure.match(failure, {
    Unreachable: () => 'Could not reach the site. Check your connection.',
    Rejected: ({ status }) => `The site answered ${status}.`,
    Unreadable: () => 'The site sent something unreadable.',
  })

export const FetchCommission = Command.define('FetchCommission', {
  args: { id: Schema.String, token: Schema.String },
  messages: [
    Message.SucceededFetchCommission,
    Message.MissedCommission,
    Message.FailedFetchCommission,
  ],
  execute: ({ id, token }) =>
    fetchJsonOrFailure(
      `/api/commission/${id}?t=${encodeURIComponent(token)}`,
      Tracked,
    ).pipe(
      Effect.match({
        onSuccess: tracked => Message.SucceededFetchCommission({ tracked }),
        onFailure: failure =>
          failure._tag === 'Rejected' && failure.status === 404
            ? Message.MissedCommission({ id })
            : Message.FailedFetchCommission({
                id,
                error: failureText(failure),
              }),
      }),
    ),
})

// UPDATE

export type UpdateReturn = Update.Return<Model, Message>

export const entered = (
  model: Model,
  id: string,
  token: Option.Option<string>,
): UpdateReturn =>
  Option.match(token, {
    onNone: () => ({
      model: modifyFields(model, {
        id: () => id,
        token: () => token,
        lookup: () => Lookup.Missing(),
      }),
    }),
    onSome: value => ({
      model: modifyFields(model, {
        id: () => id,
        token: () => token,
        lookup: () => Lookup.Loading(),
      }),
      commands: [FetchCommission({ id, token: value })],
    }),
  })

const settle = (model: Model, id: string, lookup: Lookup): UpdateReturn => ({
  model:
    id === model.id ? modifyFields(model, { lookup: () => lookup }) : model,
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededFetchCommission: ({ tracked }) =>
      settle(model, tracked.id, Lookup.Found({ tracked })),
    MissedCommission: ({ id }) => settle(model, id, Lookup.Missing()),
    FailedFetchCommission: ({ id, error }) =>
      settle(model, id, Lookup.Failed({ error })),
    ClickedRetry: () => entered(model, model.id, model.token),
  })

// QUERIES

export const KIND_LABELS: Readonly<Record<InquiryKind, string>> = {
  voice: "Fio's voice",
  studio: 'Paopoa Studio',
  endorse: 'Brand endorsement',
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  received: 'Received',
  quoted: 'Quote sent',
  deposit_paid: 'Deposit paid',
  in_progress: 'In progress',
  preview: 'Preview ready',
  draft: 'Draft ready',
  revision: 'Revising',
  final: 'Final delivered',
  declined: 'Declined',
}

const STATUS_HINTS: Readonly<Record<string, string>> = {
  received: 'Fio has your inquiry and will reply with a quote.',
  quoted: 'Check the quote, then pay the deposit if you want to go ahead.',
  deposit_paid: 'Your deposit is in. Work starts soon.',
  in_progress: 'Fio is working on it.',
  preview: 'A short preview is ready for you to hear.',
  draft: 'The full draft is ready for your feedback.',
  revision: 'Fio is making the changes you asked for.',
  final: 'All done. Thank you!',
  declined: 'Fio could not take this one.',
}

export const statusLabel = (status: string): string =>
  STATUS_LABELS[status] ?? status

export const statusHint = (status: string): string => STATUS_HINTS[status] ?? ''

export const whenLabel = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at)
    ? `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`
    : at

// VIEW

const FRAME_CLASS =
  'mx-auto max-w-2xl space-y-5 rounded-xl border border-white/10 bg-black/75 p-5 text-white shadow-2xl backdrop-blur-xl'

const LINK_CLASS =
  'flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/10 px-5 text-sm font-semibold text-gray-100 transition hover:bg-white/20'

const notice = (h: HtmlBuilder<Message>, text: string): Html =>
  h.p([h.Role('status'), h.Class('text-sm text-gray-100')], [text])

const eventView = (
  event: Tracked['events'][number],
  isCurrent: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [
      ...(isCurrent ? [h.AriaCurrent('step')] : []),
      h.Class(
        `relative border-l-2 pb-4 pl-4 last:pb-0 ${isCurrent ? 'border-[#7fb0d8]' : 'border-white/20'}`,
      ),
    ],
    [
      h.span([
        h.AriaHidden(true),
        h.Class(
          `absolute -left-[0.4rem] top-1 size-3 rounded-full ${isCurrent ? 'bg-[#7fb0d8]' : 'bg-white/30'}`,
        ),
      ]),
      h.p(
        [
          h.Class(
            `text-sm font-bold ${isCurrent ? 'text-white' : 'text-gray-300'}`,
          ),
        ],
        [statusLabel(event.status)],
      ),
      h.p([h.Class('text-xs text-gray-400')], [whenLabel(event.at)]),
      event.note === null
        ? h.empty
        : h.p([h.Class('mt-1 text-sm text-gray-100')], [event.note]),
    ],
  )

const foundView = (tracked: Tracked, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('space-y-5')],
    [
      h.div(
        [h.Class('space-y-1')],
        [
          h.p(
            [h.Class('text-sm text-gray-300')],
            [
              `${KIND_LABELS[tracked.kind]}, sent ${whenLabel(tracked.createdAt)}`,
            ],
          ),
          h.p(
            [h.Class('text-xl font-black text-[#7fb0d8]')],
            [statusLabel(tracked.status)],
          ),
          h.p([h.Class('text-sm text-gray-100')], [statusHint(tracked.status)]),
        ],
      ),
      h.ol(
        [h.AriaLabel('Status history'), h.Class('ml-1.5')],
        Array.map(tracked.events, (event, index) =>
          eventView(event, index === tracked.events.length - 1, h),
        ),
      ),
    ],
  )

const missingView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('space-y-4')],
    [
      h.p(
        [h.Role('alert'), h.Class('text-sm text-gray-100')],
        [
          "We can't find a commission for this link. Open the whole link you got after sending your inquiry, including everything after the question mark.",
        ],
      ),
      h.div(
        [h.Class('flex flex-wrap gap-3')],
        [
          h.a(
            [h.Href(hireRouter()), h.Class(LINK_CLASS)],
            ["Hire Fio's voice"],
          ),
          h.a([h.Href(endorseRouter()), h.Class(LINK_CLASS)], ['Endorse Fio']),
        ],
      ),
    ],
  )

const failedView = (error: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('space-y-4')],
    [
      h.p(
        [
          h.Role('alert'),
          h.Class(
            'rounded-lg border border-red-400/60 bg-red-950/40 p-3 text-sm text-red-100',
          ),
        ],
        [`Couldn't load your commission. ${error}`],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedRetry()),
          h.Class(LINK_CLASS),
        ],
        ['Try again'],
      ),
    ],
  )

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  h.main(
    [h.Class('w-full grow px-4 py-4')],
    [
      h.div(
        [h.Class(FRAME_CLASS)],
        [
          h.div(
            [h.Class('flex flex-wrap items-center justify-between gap-3')],
            [
              h.h1(
                [
                  h.Class(
                    'text-2xl font-black uppercase tracking-tight text-[#7fb0d8]',
                  ),
                ],
                ['Your commission'],
              ),
              h.a([h.Href(radioRouter()), h.Class(LINK_CLASS)], ['Fio Radio']),
            ],
          ),
          Lookup.match(model.lookup, {
            Idle: () => notice(h, 'Loading your commission...'),
            Loading: () => notice(h, 'Loading your commission...'),
            Found: ({ tracked }) => foundView(tracked, h),
            Missing: () => missingView(h),
            Failed: ({ error }) => failedView(error, h),
          }),
        ],
      ),
    ],
  ),
)
