import { Option } from 'effect'
import { expect, test } from 'vitest'

import { trackingUrlOf } from './inquiry'

const ID = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0001'
const URL_OK = `/commission/${ID}?t=Zm9vYmFy_-9`

test('a reply with a tracking path gives the link', () => {
  expect(trackingUrlOf({ id: ID, trackingUrl: URL_OK })).toEqual(
    Option.some(URL_OK),
  )
})

test('a reply without a usable link gives none, so the send still counts', () => {
  for (const body of [
    {},
    null,
    'ok',
    { id: ID },
    { id: ID, trackingUrl: 'https://evil.test/commission/x?t=a' },
    { id: ID, trackingUrl: 'javascript:alert(1)' },
    { id: ID, trackingUrl: `//evil.test/commission/${ID}?t=a` },
    { id: ID, trackingUrl: `/commission/${ID}` },
  ]) {
    expect(trackingUrlOf(body), JSON.stringify(body)).toEqual(Option.none())
  }
})
