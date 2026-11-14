import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { init, spec, update } from './endorse'
import { CreateInquiryId, Message, SubmitInquiry, stepIndex } from './inquiry'
import { InquiryPayload } from './inquiryPayload'

const fill = (field: string, value: string) =>
  message(Message.UpdatedField({ field, value }))

const next = message(Message.ClickedNext())

const toReview = [
  fill('brand', 'Acme'),
  fill('contact', 'Ann, ann@acme.test'),
  next,
  message(Message.ToggledChoice({ field: 'channels', value: 'YouTube' })),
  message(Message.ToggledChoice({ field: 'channels', value: 'Live Stream' })),
  fill('budget', '$300 – $700'),
  next,
  fill('details', 'Launch stream in March'),
  next,
]

test('each step blocks Next until its own fields are valid', () => {
  story(
    update,
    given(init()),
    next,
    model(current =>
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['brand', 'contact'],
      }),
    ),
    fill('brand', 'Acme'),
    fill('contact', 'Ann'),
    next,
    next,
    model(current => {
      expect(current.step).toBe('campaign')
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['channels'],
      })
    }),
    message(Message.ToggledChoice({ field: 'channels', value: 'X' })),
    next,
    next,
    model(current =>
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['details'],
      }),
    ),
  )
})

test('a channel toggles off again and Back keeps the answers', () => {
  story(
    update,
    given(init()),
    message(Message.ToggledChoice({ field: 'channels', value: 'X' })),
    message(Message.ToggledChoice({ field: 'channels', value: 'TikTok' })),
    message(Message.ToggledChoice({ field: 'channels', value: 'X' })),
    model(current => expect(current.draft['channels']).toBe('TikTok')),
    fill('brand', 'Acme'),
    fill('contact', 'Ann'),
    next,
    message(Message.ClickedBack()),
    model(current => {
      expect(current.step).toBe('who')
      expect(current.draft['brand']).toBe('Acme')
      expect(current.draft['channels']).toBe('TikTok')
    }),
  )
})

test('the review has no quote and sends an endorse payload without one', () => {
  story(
    update,
    given(init()),
    ...toReview,
    model(current => {
      expect(stepIndex(spec, current.step)).toBe(3)
      expect(spec.quote(current.draft)._tag).toBe('None')
    }),
    message(Message.ClickedSend()),
    Command.resolve(
      CreateInquiryId,
      Message.CompletedCreateInquiryId({ id: 'id-1' }),
    ),
    Command.resolve(
      SubmitInquiry,
      Message.SucceededSubmitInquiry({ trackingUrl: Option.none() }),
    ),
    model(current => expect(current.submission._tag).toBe('Sent')),
  )
})

test('a failed send keeps the draft so the retry resends the same answers', () => {
  const sendable = [
    ...toReview,
    message(Message.ClickedSend()),
    Command.resolve(
      CreateInquiryId,
      Message.CompletedCreateInquiryId({ id: 'id-1' }),
    ),
    Command.resolve(
      SubmitInquiry,
      Message.FailedSubmitInquiry({ error: 'offline' }),
    ),
  ]
  story(
    update,
    given(init()),
    ...sendable,
    model(current => {
      expect(current.submission._tag).toBe('Failed')
      expect(current.draft['details']).toBe('Launch stream in March')
    }),
    message(Message.ClickedSend()),
    Command.resolve(
      SubmitInquiry,
      Message.SucceededSubmitInquiry({ trackingUrl: Option.none() }),
    ),
    model(current => expect(current.submission._tag).toBe('Sent')),
  )
})

test('the answers decode as an endorse payload with a null quote', () => {
  const payload = {
    id: 'id-1',
    kind: spec.kind,
    fields: spec.answers({
      brand: 'Acme',
      contact: 'Ann',
      channels: 'YouTube,Live Stream',
      campaign_type: 'Other',
      budget: "Let's discuss",
      details: 'Hi',
    }),
    quote: null,
  }
  expect(Schema.decodeResult(InquiryPayload)(payload)._tag).toBe('Success')
  expect(payload.fields['channels']).toBe('YouTube, Live Stream')
})
