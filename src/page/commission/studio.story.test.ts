import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import {
  CreateInquiryId,
  Message,
  type Model,
  SubmitInquiry,
  stepIndex,
} from './inquiry'
import { init, spec, update } from './studio'

const fill = (field: string, value: string) =>
  message(Message.UpdatedField({ field, value }))

const next = message(Message.ClickedNext())

const toServiceStep = [
  fill('name', 'Mika'),
  fill('contact', 'mika#0001'),
  next,
  fill('song', 'Gurenge - LiSA'),
  fill('vocal_link', 'https://drive.example.com/abc'),
  next,
]

const toReview = [
  ...toServiceStep,
  fill('service', 'Full Production'),
  fill('length', 'Standard'),
  fill('tracks', '4'),
  next,
  fill('deadline', 'rush'),
  next,
  fill('details', 'Reference attached'),
  fill('agree', 'yes'),
  next,
]

const quoteOf = (current: Model) => Option.getOrNull(spec.quote(current.draft))

test('Next is blocked on each step until its fields are valid', () => {
  story(
    update,
    given(init()),
    next,
    model(current =>
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['name', 'contact'],
      }),
    ),
    fill('name', 'Mika'),
    fill('contact', 'mika#0001'),
    next,
    fill('song', 'Gurenge'),
    fill('vocal_link', 'not a link'),
    next,
    model(current => {
      expect(current.step).toBe('cover')
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['vocal_link'],
      })
    }),
    fill('vocal_link', 'https://drive.example.com/abc'),
    next,
    next,
    model(current => {
      expect(current.step).toBe('service')
      expect(current.submission).toMatchObject({
        _tag: 'Invalid',
        fields: ['service', 'length'],
      })
    }),
  )
})

test('Back keeps answers and never validates', () => {
  story(
    update,
    given(init()),
    ...toServiceStep,
    fill('service', 'Mix & Master'),
    message(Message.ClickedBack()),
    message(Message.ClickedBack()),
    model(current => {
      expect(current.step).toBe('you')
      expect(current.draft['service']).toBe('Mix & Master')
      expect(current.draft['song']).toBe('Gurenge - LiSA')
      expect(current.submission._tag).toBe('Editing')
    }),
  )
})

test('the quote updates as options are picked and never sits in the model', () => {
  story(
    update,
    given(init()),
    model(current => expect(quoteOf(current)).toBeNull()),
    fill('service', 'Full Production'),
    fill('length', 'Short'),
    model(current => {
      expect(quoteOf(current)).toMatchObject({
        _tag: 'Priced',
        total: { idr: 100_000, usd: 20 },
      })
      expect(Object.keys(current).sort()).toEqual([
        'draft',
        'inquiryId',
        'step',
        'submission',
      ])
    }),
    message(
      Message.ToggledChoice({ field: 'add_ons', value: 'simple-adlibs' }),
    ),
    model(current =>
      expect(quoteOf(current)).toMatchObject({ total: { idr: 200_000 } }),
    ),
    message(
      Message.ToggledChoice({ field: 'add_ons', value: 'simple-adlibs' }),
    ),
    fill('deadline', 'rush'),
    fill('first_commission', 'yes'),
    model(current =>
      expect(quoteOf(current)).toMatchObject({ total: { idr: 112_500 } }),
    ),
    fill('length', 'Long'),
    model(current => expect(quoteOf(current)?._tag).toBe('ByCase')),
  )
})

test('the review shows the quote with its deposit, then sends it', () => {
  story(
    update,
    given(init()),
    ...toReview,
    model(current => {
      expect(stepIndex(spec, current.step)).toBe(5)
      expect(quoteOf(current)).toMatchObject({
        _tag: 'Priced',
        total: { idr: 375_000, usd: 75 },
        deposit: { _tag: 'Some' },
      })
    }),
    message(Message.ClickedSend()),
    Command.resolve(
      CreateInquiryId,
      Message.CompletedCreateInquiryId({ id: 'id-1' }),
    ),
    Command.resolve(SubmitInquiry, Message.SucceededSubmitInquiry()),
    model(current => {
      expect(current.submission._tag).toBe('Sent')
      expect(current.draft['name']).toBe('')
    }),
  )
})

test('a failed send keeps the draft and the retry succeeds', () => {
  story(
    update,
    given(init()),
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
    model(current => {
      expect(current.submission._tag).toBe('Failed')
      expect(current.draft['song']).toBe('Gurenge - LiSA')
      expect(current.draft['tracks']).toBe('4')
    }),
    message(Message.ClickedSend()),
    Command.resolve(SubmitInquiry, Message.SucceededSubmitInquiry()),
    model(current => expect(current.submission._tag).toBe('Sent')),
  )
})
