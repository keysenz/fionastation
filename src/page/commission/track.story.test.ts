import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import {
  FetchCommission,
  Lookup,
  Message,
  type Tracked,
  entered,
  init,
  statusLabel,
  update,
  whenLabel,
} from './track'

const ID = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0001'
const OTHER_ID = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0002'

const tracked: Tracked = {
  id: ID,
  kind: 'voice',
  createdAt: '2026-11-14T10:00:00.000Z',
  status: 'quoted',
  events: [
    { status: 'received', note: null, at: '2026-11-14T10:00:00.000Z' },
    { status: 'quoted', note: 'Rp600.000', at: '2026-11-14T12:30:00.000Z' },
  ],
}

const opened = entered(init(), ID, Option.some('tok_en-1')).model

const load = message(Message.ClickedRetry())

test('opening a link with a token loads that commission', () => {
  const result = entered(init(), ID, Option.some('tok_en-1'))
  expect(result.model.lookup._tag).toBe('Loading')
  expect(result.commands?.map(command => command.name)).toEqual([
    'FetchCommission',
  ])
  expect(result.commands?.[0]?.args).toEqual({ id: ID, token: 'tok_en-1' })
})

test('the commission arrives and the page holds its timeline', () => {
  story(
    update,
    given(opened),
    load,
    Command.resolve(
      FetchCommission,
      Message.SucceededFetchCommission({ tracked }),
    ),
    model(current => expect(current.lookup).toEqual(Lookup.Found({ tracked }))),
  )
})

test('a link with no token shows the unknown screen and fetches nothing', () => {
  const result = entered(init(), ID, Option.none())
  expect(result.model.lookup._tag).toBe('Missing')
  expect(result.commands).toBeUndefined()
  story(
    update,
    given(result.model),
    load,
    model(current => expect(current.lookup._tag).toBe('Missing')),
  )
})

test('a 404 shows the unknown screen', () => {
  story(
    update,
    given(opened),
    load,
    Command.resolve(FetchCommission, Message.MissedCommission({ id: ID })),
    model(current => expect(current.lookup._tag).toBe('Missing')),
  )
})

test('a failed fetch shows its error and Try again fetches again', () => {
  story(
    update,
    given(opened),
    load,
    Command.resolve(
      FetchCommission,
      Message.FailedFetchCommission({
        id: ID,
        error: 'The site answered 500.',
      }),
    ),
    model(current =>
      expect(current.lookup).toEqual(
        Lookup.Failed({ error: 'The site answered 500.' }),
      ),
    ),
    load,
    model(current => expect(current.lookup._tag).toBe('Loading')),
    Command.resolve(
      FetchCommission,
      Message.SucceededFetchCommission({ tracked }),
    ),
    model(current => expect(current.lookup._tag).toBe('Found')),
  )
})

test('a late answer for another commission is ignored', () => {
  story(
    update,
    given(opened),
    load,
    Command.resolve(
      FetchCommission,
      Message.SucceededFetchCommission({
        tracked: { ...tracked, id: OTHER_ID },
      }),
    ),
    model(current => expect(current.lookup._tag).toBe('Loading')),
  )
})

test('statuses and times read as people say them', () => {
  expect(statusLabel('deposit_paid')).toBe('Deposit paid')
  expect(statusLabel('in_progress')).toBe('In progress')
  expect(statusLabel('some_future_status')).toBe('some_future_status')
  expect(whenLabel('2026-11-14T10:00:00.000Z')).toBe('2026-11-14 10:00 UTC')
  expect(whenLabel('later')).toBe('later')
})
