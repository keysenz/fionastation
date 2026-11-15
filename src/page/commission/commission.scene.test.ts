import { Option } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { test } from 'vitest'

import * as Hire from './hire'
import { type Model as InquiryModel, Submission } from './inquiry'
import * as Track from './track'

const ID = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0001'
const TRACKING_URL = `/commission/${ID}?t=abc_-123`

const tracked: Track.Tracked = {
  id: ID,
  kind: 'voice',
  createdAt: '2026-11-14T10:00:00.000Z',
  status: 'in_progress',
  events: [
    { status: 'received', note: null, at: '2026-11-14T10:00:00.000Z' },
    { status: 'quoted', note: 'Rp600.000', at: '2026-11-14T12:30:00.000Z' },
    { status: 'deposit_paid', note: null, at: '2026-11-15T08:00:00.000Z' },
    { status: 'in_progress', note: null, at: '2026-11-15T09:15:00.000Z' },
  ],
}

const trackModel = (lookup: Track.Lookup) => ({
  ...Track.init(),
  id: ID,
  lookup,
})

test('the tracking page shows the kind, the date and a labelled timeline', () => {
  scene(
    { update: Track.update, view: Track.view },
    given(trackModel(Track.Lookup.Found({ tracked }))),
    expect(role('heading', { name: 'Your commission' })).toExist(),
    expect(text("Fio's voice, sent 2026-11-14 10:00 UTC")).toExist(),
    expect(text('Fio is working on it.')).toExist(),
    expectAll(all.selector('[aria-label="Status history"] li')).toHaveCount(4),
    expect(text('Quote sent')).toExist(),
    expect(text('Deposit paid')).toExist(),
    expect(text('Rp600.000')).toExist(),
    expect(selector('[aria-current="step"]')).toContainText('In progress'),
  )
})

test('the tracking page never asks for or shows a name or contact', () => {
  scene(
    { update: Track.update, view: Track.view },
    given(trackModel(Track.Lookup.Found({ tracked }))),
    expect(text(/mika|contact|discord/i)).toBeAbsent(),
  )
})

test('an unknown link says so and offers the forms', () => {
  scene(
    { update: Track.update, view: Track.view },
    given(trackModel(Track.Lookup.Missing())),
    expect(role('alert')).toContainText("can't find a commission"),
    expect(role('link', { name: "Hire Fio's voice" })).toExist(),
    expectAll(all.selector('[aria-label="Status history"]')).toBeEmpty(),
  )
})

test('a failed load offers Try again, which fetches again', () => {
  scene(
    { update: Track.update, view: Track.view },
    given({
      ...trackModel(Track.Lookup.Failed({ error: 'The site answered 500.' })),
      token: Option.some('abc_-123'),
    }),
    expect(role('alert')).toContainText('The site answered 500.'),
    click(role('button', { name: 'Try again' })),
    expect(text('Loading your commission...')).toExist(),
    Command.resolve(
      Track.FetchCommission,
      Track.Message.SucceededFetchCommission({ tracked }),
    ),
    expect(text('Quote sent')).toExist(),
  )
})

test('the Sent screen links to the tracking page when the reply had a link', () => {
  const sent: InquiryModel = {
    ...Hire.init(),
    submission: Submission.Sent({ trackingUrl: Option.some(TRACKING_URL) }),
  }
  scene(
    { update: Hire.update, view: Hire.view },
    given(sent),
    expect(text('Sent! Talk soon.')).toExist(),
    expect(role('link', { name: 'Track your commission' })).toHaveAttr(
      'href',
      TRACKING_URL,
    ),
  )
})

test('the Sent screen still confirms the send when there is no link', () => {
  const sent: InquiryModel = {
    ...Hire.init(),
    submission: Submission.Sent({ trackingUrl: Option.none() }),
  }
  scene(
    { update: Hire.update, view: Hire.view },
    given(sent),
    expect(text('Sent! Talk soon.')).toExist(),
    expect(role('link', { name: 'Track your commission' })).toBeAbsent(),
  )
})
