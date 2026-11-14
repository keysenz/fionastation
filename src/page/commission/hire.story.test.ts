import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { init, spec, update, voiceSelectionOf } from './hire'
import { CreateInquiryId, Message, SubmitInquiry, stepIndex } from './inquiry'
import { InquiryPayload } from './inquiryPayload'

const fill = (field: string, value: string) =>
  message(Message.UpdatedField({ field, value }))

const toLicenseStep = [
  fill('name', 'Mika'),
  fill('contact', 'mika#0001'),
  message(Message.ClickedNext()),
]

const toReview = [
  ...toLicenseStep,
  fill('usage', 'Commercial'),
  fill('length', 'Full'),
  message(Message.ClickedNext()),
  fill('brief', 'Homura, about 4:30'),
  message(Message.ClickedNext()),
  fill('agree', 'yes'),
  message(Message.ClickedNext()),
]

const SubmitArgs = Schema.Struct({ payload: InquiryPayload })

const payloadOf = (result: ReturnType<typeof update>) =>
  Schema.decodeUnknownSync(SubmitArgs)(result.commands?.[0]?.args).payload

const reviewModel = () => {
  const steps = [
    Message.UpdatedField({ field: 'name', value: 'Mika' }),
    Message.UpdatedField({ field: 'contact', value: 'mika#0001' }),
    Message.ClickedNext(),
    Message.UpdatedField({ field: 'usage', value: 'Commercial' }),
    Message.UpdatedField({ field: 'length', value: 'Full' }),
    Message.ClickedNext(),
    Message.UpdatedField({ field: 'brief', value: 'Homura, about 4:30' }),
    Message.ClickedNext(),
    Message.UpdatedField({ field: 'agree', value: 'yes' }),
    Message.ClickedNext(),
  ]
  return steps.reduce((current, step) => update(current, step).model, init())
}

test('Next is blocked until the current step is valid', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedNext()),
    model(current => {
      expect(current.step).toBe('you')
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['name', 'contact'],
      })
    }),
    fill('name', 'Mika'),
    message(Message.ClickedNext()),
    model(current =>
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['contact'],
      }),
    ),
    fill('contact', 'mika#0001'),
    message(Message.ClickedNext()),
    model(current => {
      expect(current.step).toBe('license')
      expect(current.submission._tag).toBe('Editing')
    }),
  )
})

test('Next checks only the current step, not later ones', () => {
  story(
    update,
    given(init()),
    ...toLicenseStep,
    message(Message.ClickedNext()),
    model(current =>
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['usage', 'length'],
      }),
    ),
  )
})

test('Back never validates and keeps every answer', () => {
  story(
    update,
    given(init()),
    ...toLicenseStep,
    fill('usage', 'Personal'),
    message(Message.ClickedBack()),
    model(current => {
      expect(current.step).toBe('you')
      expect(current.submission._tag).toBe('Editing')
      expect(current.draft['name']).toBe('Mika')
      expect(current.draft['usage']).toBe('Personal')
    }),
    fill('name', ''),
    message(Message.ClickedBack()),
    model(current => expect(current.step).toBe('you')),
  )
})

test('the quote follows the draft and is not stored in the model', () => {
  story(
    update,
    given(init()),
    model(current =>
      expect(Option.isNone(voiceSelectionOf(current.draft))).toBe(true),
    ),
    fill('usage', 'Personal'),
    fill('length', 'Short'),
    model(current =>
      expect(voiceSelectionOf(current.draft)).toEqual(
        Option.some({ usage: 'Personal', length: 'Short' }),
      ),
    ),
    fill('length', 'Full'),
    model(current => {
      expect(voiceSelectionOf(current.draft)).toEqual(
        Option.some({ usage: 'Personal', length: 'Full' }),
      )
      expect(Object.keys(current).sort()).toEqual([
        'draft',
        'inquiryId',
        'step',
        'submission',
      ])
    }),
  )
})

test('the review step sends the answers and the quote text', () => {
  story(
    update,
    given(init()),
    ...toReview,
    model(current => expect(stepIndex(spec, current.step)).toBe(4)),
    message(Message.ClickedSend()),
    Command.resolve(
      CreateInquiryId,
      Message.CompletedCreateInquiryId({ id: 'id-1' }),
    ),
    Command.resolve(SubmitInquiry, Message.SucceededSubmitInquiry()),
    model(current => {
      expect(current.submission._tag).toBe('Sent')
      expect(current.draft['name']).toBe('')
      expect(current.step).toBe('you')
    }),
  )
})

test('the payload carries the id, kind, answers and a structured quote', () => {
  const sending = update(reviewModel(), Message.ClickedSend())
  expect(sending.commands?.[0]?.name).toBe('CreateInquiryId')
  const submitted = update(
    sending.model,
    Message.CompletedCreateInquiryId({ id: 'id-1' }),
  )
  const payload = payloadOf(submitted)
  expect(payload).toEqual({
    id: 'id-1',
    kind: 'voice',
    fields: expect.objectContaining({
      name: 'Mika',
      usage: 'Commercial (exclusive)',
      length: 'Full',
    }),
    quote: {
      _tag: 'Priced',
      lines: [
        {
          label: 'Commercial licence, full song',
          idr: 600_000,
          usd: 120,
        },
      ],
      total: { idr: 600_000, usd: 120 },
      deposit: null,
    },
  })
  expect(Schema.decodeResult(InquiryPayload)(payload)._tag).toBe('Success')
})

test('a retry after a failure sends the same id', () => {
  const first = update(reviewModel(), Message.ClickedSend())
  const created = update(
    first.model,
    Message.CompletedCreateInquiryId({ id: 'id-1' }),
  )
  const failed = update(
    created.model,
    Message.FailedSubmitInquiry({ error: 'x' }),
  )
  const retry = update(failed.model, Message.ClickedSend())
  expect(retry.commands?.map(command => command.name)).toEqual([
    'SubmitInquiry',
  ])
  expect(payloadOf(retry).id).toBe('id-1')
})

test('a failed send keeps the draft, shows the error, and can be retried', () => {
  story(
    update,
    given(init()),
    ...toReview,
    message(Message.ClickedSend()),
    model(current => expect(current.submission._tag).toBe('Sending')),
    Command.resolve(
      CreateInquiryId,
      Message.CompletedCreateInquiryId({ id: 'id-1' }),
    ),
    Command.resolve(
      SubmitInquiry,
      Message.FailedSubmitInquiry({ error: 'offline' }),
    ),
    model(current => {
      expect(current.submission).toMatchObject({
        _tag: 'Failed',
        error: 'offline',
      })
      expect(current.draft['brief']).toBe('Homura, about 4:30')
      expect(stepIndex(spec, current.step)).toBe(4)
    }),
    message(Message.ClickedSend()),
    Command.resolve(SubmitInquiry, Message.SucceededSubmitInquiry()),
    model(current => expect(current.submission._tag).toBe('Sent')),
  )
})

test('Send re-checks every step and returns to the first bad one', () => {
  story(
    update,
    given(init()),
    ...toReview,
    fill('contact', ''),
    message(Message.ClickedSend()),
    model(current => {
      expect(current.step).toBe('you')
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['contact'],
      })
    }),
  )
})
