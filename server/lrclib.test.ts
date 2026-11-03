// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  LrclibUnavailable,
  classifyStatus,
  parseRetryAfterSeconds,
  searchTracks,
} from './lrclib.ts'
import { pauseMsFor } from './lyrics.ts'
import type { SearchPlan } from './lyricsMatch.ts'

const track = {
  id: 1,
  trackName: 'Bukti',
  artistName: 'Virgoun',
  duration: 200,
  instrumental: false,
  syncedLyrics: '[00:01.00] hi',
}

const reply = (status: number, body: unknown = [], headers = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const plan: SearchPlan = {
  kind: 'Search',
  title: 'Bukti',
  isArtistTrusted: false,
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const stubFetch = (...answers: Array<() => Response | Promise<Response>>) => {
  const fetchMock = vi.fn(async () => {
    const answer = answers.shift()
    if (!answer) throw new Error('unexpected request')
    return answer()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

test('statuses split into retryable, rate limited and permanent', () => {
  expect(classifyStatus(200)).toBe('Ok')
  expect(classifyStatus(404)).toBe('Miss')
  expect(classifyStatus(429)).toBe('RateLimited')
  expect(classifyStatus(503)).toBe('Transient')
  expect(classifyStatus(400)).toBe('Rejected')
})

test('Retry-After counts only as a non-negative number of seconds', () => {
  expect(parseRetryAfterSeconds('30')).toBe(30)
  expect(parseRetryAfterSeconds(null)).toBeUndefined()
  expect(parseRetryAfterSeconds('soon')).toBeUndefined()
})

test('a 503 then an object body then a good answer still succeeds', async () => {
  const fetchMock = stubFetch(
    () => reply(503),
    () => reply(200, { message: 'slow down' }),
    () => reply(200, [track]),
  )
  const found = searchTracks(plan)
  await vi.advanceTimersByTimeAsync(400 + 1_200)
  expect(await found).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test('three failures in a row give up as unavailable but not rate limited', async () => {
  const fetchMock = stubFetch(
    () => reply(503),
    () => reply(503),
    () => reply(503),
  )
  const found = searchTracks(plan).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(400 + 1_200)
  const error = await found
  expect(error).toBeInstanceOf(LrclibUnavailable)
  expect(pauseMsFor(error as LrclibUnavailable)).toBeUndefined()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test('a network error is retried', async () => {
  stubFetch(
    () => {
      throw new TypeError('fetch failed')
    },
    () => reply(200, [track]),
  )
  const found = searchTracks(plan)
  await vi.advanceTimersByTimeAsync(400)
  expect(await found).toHaveLength(1)
})

test('a 404 is a clean miss without a retry', async () => {
  const fetchMock = stubFetch(
    () => reply(404, {}),
    () => reply(200, []),
  )
  expect(await searchTracks(plan)).toEqual([])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('a 429 is not retried and asks for a pause that honors Retry-After', async () => {
  const fetchMock = stubFetch(() => reply(429, {}, { 'Retry-After': '90' }))
  const error = await searchTracks(plan).catch((caught: unknown) => caught)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(pauseMsFor(error as LrclibUnavailable)).toBe(90_000)
})

test('a 429 without Retry-After pauses for a minute', async () => {
  stubFetch(() => reply(429, {}))
  const error = await searchTracks(plan).catch((caught: unknown) => caught)
  expect(pauseMsFor(error as LrclibUnavailable)).toBe(60_000)
})
