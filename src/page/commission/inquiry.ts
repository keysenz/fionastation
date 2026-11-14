import { Array, Effect, Option, Result, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  INQUIRY_ROUTE,
  type InquiryKind,
  InquiryPayload,
  snapshotOf,
} from './inquiryPayload'
import { type Quote } from './pricing'

// DRAFT

export const Draft = Schema.Record(Schema.String, Schema.String)
export type Draft = typeof Draft.Type

const LIST_SEPARATOR = ','

export const listOf = (value: string): ReadonlyArray<string> =>
  value === '' ? [] : value.split(LIST_SEPARATOR)

const toggled = (value: string, choice: string): string => {
  const chosen = listOf(value)
  return (
    chosen.includes(choice)
      ? Array.filter(chosen, entry => entry !== choice)
      : [...chosen, choice]
  ).join(LIST_SEPARATOR)
}

export const answer = (draft: Draft, field: string): string =>
  draft[field] ?? ''

// FORM SPEC

export type Step = Readonly<{
  id: string
  title: string
  fields: ReadonlyArray<string>
}>

export type FormSpec = Readonly<{
  steps: ReadonlyArray<Step>
  rules: Readonly<Record<string, Schema.Codec<unknown, string>>>
  initialDraft: Draft
  kind: InquiryKind
  answers: (draft: Draft) => Draft
  quote: (draft: Draft) => Option.Option<Quote>
}>

export const NonEmpty = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()))

export const OptionalLink = Schema.Union([
  Schema.Literal(''),
  Schema.String.check(Schema.isPattern(/^https?:\/\/\S+\.\S+$/)),
])

export const Agreed = Schema.Literal('yes')

const stepAt = (spec: FormSpec, index: number): Step | undefined =>
  Option.getOrUndefined(Array.get(spec.steps, index))

export const stepIndex = (spec: FormSpec, id: string): number =>
  Math.max(
    0,
    spec.steps.findIndex(step => step.id === id),
  )

export const isReviewStep = (spec: FormSpec, id: string): boolean =>
  stepIndex(spec, id) === spec.steps.length - 1

const failingFields = (
  spec: FormSpec,
  draft: Draft,
  fields: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.filter(fields, field => {
    const rule = spec.rules[field]
    return (
      rule !== undefined &&
      Result.isFailure(Schema.decodeResult(rule)(answer(draft, field)))
    )
  })

// MODEL

export const Submission = defineTaggedUnion({
  Editing: {},
  Invalid: { fields: Schema.Array(Schema.String) },
  Sending: {},
  Sent: {},
  Failed: { error: Schema.String },
})
export type Submission = typeof Submission.Type

export const Model = Schema.Struct({
  step: Schema.String,
  draft: Draft,
  inquiryId: Schema.Option(Schema.String),
  submission: Submission,
})
export type Model = typeof Model.Type

export const init = (spec: FormSpec): Model => ({
  step: spec.steps[0]?.id ?? '',
  draft: spec.initialDraft,
  inquiryId: Option.none(),
  submission: Submission.Editing(),
})

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedField: { field: Schema.String, value: Schema.String },
  ToggledChoice: { field: Schema.String, value: Schema.String },
  ClickedNext: {},
  ClickedBack: {},
  ClickedSend: {},
  ClickedStartOver: {},
  SucceededSubmitInquiry: {},
  CompletedCreateInquiryId: { id: Schema.String },
  FailedSubmitInquiry: { error: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

const SEND_FAILED = "Couldn't send. Try again or DM Fio on Discord: fioyo.work"

export const CreateInquiryId = Command.define('CreateInquiryId', {
  messages: [Message.CompletedCreateInquiryId],
  execute: Effect.sync(() =>
    Message.CompletedCreateInquiryId({ id: crypto.randomUUID() }),
  ),
})

export const SubmitInquiry = Command.define('SubmitInquiry', {
  args: { payload: InquiryPayload },
  messages: [Message.SucceededSubmitInquiry, Message.FailedSubmitInquiry],
  execute: ({ payload }) =>
    Effect.tryPromise(() =>
      fetch(INQUIRY_ROUTE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    ).pipe(
      Effect.map(response =>
        response.ok
          ? Message.SucceededSubmitInquiry()
          : Message.FailedSubmitInquiry({ error: SEND_FAILED }),
      ),
      Effect.catch(() =>
        Effect.succeed(Message.FailedSubmitInquiry({ error: SEND_FAILED })),
      ),
    ),
})

// UPDATE

export type UpdateReturn = Update.Return<Model, Message>

const allFields = (spec: FormSpec): ReadonlyArray<string> =>
  Array.flatMap(spec.steps, step => step.fields)

const goTo = (model: Model, step: Step | undefined): Model =>
  step === undefined
    ? model
    : modifyFields(model, {
        step: () => step.id,
        submission: () => Submission.Editing(),
      })

const payloadOf = (
  spec: FormSpec,
  draft: Draft,
  id: string,
): InquiryPayload => ({
  id,
  kind: spec.kind,
  fields: spec.answers(draft),
  quote: Option.getOrNull(Option.map(spec.quote(draft), snapshotOf)),
})

const send = (spec: FormSpec, model: Model): UpdateReturn => {
  const failing = failingFields(spec, model.draft, allFields(spec))
  if (Array.isReadonlyArrayNonEmpty(failing)) {
    const firstBad = spec.steps.find(step =>
      step.fields.some(field => failing.includes(field)),
    )
    return {
      model: modifyFields(goTo(model, firstBad), {
        submission: () => Submission.Invalid({ fields: failing }),
      }),
    }
  }
  const sending = modifyFields(model, {
    submission: () => Submission.Sending(),
  })
  return Option.match(model.inquiryId, {
    onNone: () => ({ model: sending, commands: [CreateInquiryId()] }),
    onSome: id => ({
      model: sending,
      commands: [SubmitInquiry({ payload: payloadOf(spec, model.draft, id) })],
    }),
  })
}

const next = (spec: FormSpec, model: Model): UpdateReturn => {
  const index = stepIndex(spec, model.step)
  const current = stepAt(spec, index)
  const failing = failingFields(spec, model.draft, current?.fields ?? [])
  if (Array.isReadonlyArrayNonEmpty(failing)) {
    return {
      model: modifyFields(model, {
        submission: () => Submission.Invalid({ fields: failing }),
      }),
    }
  }
  return { model: goTo(model, stepAt(spec, index + 1)) }
}

const editDraft = (
  model: Model,
  field: string,
  change: (current: string) => string,
): UpdateReturn => ({
  model: modifyFields(model, {
    draft: draft => ({ ...draft, [field]: change(answer(draft, field)) }),
    submission: () => Submission.Editing(),
  }),
})

export const makeUpdate =
  (spec: FormSpec) =>
  (model: Model, message: Message): UpdateReturn =>
    Message.match<UpdateReturn>(message, {
      UpdatedField: ({ field, value }) =>
        model.submission._tag === 'Sending'
          ? { model }
          : editDraft(model, field, () => value),
      ToggledChoice: ({ field, value }) =>
        model.submission._tag === 'Sending'
          ? { model }
          : editDraft(model, field, current => toggled(current, value)),
      ClickedNext: () =>
        model.submission._tag === 'Sending' || isReviewStep(spec, model.step)
          ? { model }
          : next(spec, model),
      ClickedBack: () =>
        model.submission._tag === 'Sending'
          ? { model }
          : {
              model: goTo(model, stepAt(spec, stepIndex(spec, model.step) - 1)),
            },
      ClickedSend: () =>
        model.submission._tag === 'Sending' || !isReviewStep(spec, model.step)
          ? { model }
          : send(spec, model),
      CompletedCreateInquiryId: ({ id }) => ({
        model: modifyFields(model, { inquiryId: () => Option.some(id) }),
        commands: [
          SubmitInquiry({ payload: payloadOf(spec, model.draft, id) }),
        ],
      }),
      ClickedStartOver: () => ({ model: init(spec) }),
      SucceededSubmitInquiry: () => ({
        model: modifyFields(init(spec), {
          submission: () => Submission.Sent(),
        }),
      }),
      FailedSubmitInquiry: ({ error }) => ({
        model: modifyFields(model, {
          submission: () => Submission.Failed({ error }),
        }),
      }),
    })
