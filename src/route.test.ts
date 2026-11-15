import { Option } from 'effect'
import { fromString } from 'foldkit/url'
import { expect, test } from 'vitest'

import { AppRoute, isRadioRoute, urlToAppRoute } from './route.ts'

const routeOf = (path: string): AppRoute =>
  urlToAppRoute(Option.getOrThrow(fromString(`https://fio.test${path}`)))

test('a shared playlist link opens the playlist route carrying the id', () => {
  const route = routeOf('/p/Ab3dE5gH')
  expect(route._tag).toBe('Playlist')
  expect(route._tag === 'Playlist' && route.id).toBe('Ab3dE5gH')
})

test('a playlist link whose id is not 8 letters and digits is not a page', () => {
  expect(routeOf('/p/short')._tag).toBe('NotFound')
  expect(routeOf('/p/Ab3dE5gH9')._tag).toBe('NotFound')
  expect(routeOf('/p/Ab3dE5g!')._tag).toBe('NotFound')
  expect(routeOf('/p')._tag).toBe('NotFound')
})

test('the radio page and a playlist link both run the radio, the song list does not', () => {
  expect(isRadioRoute(routeOf('/'))).toBe(true)
  expect(isRadioRoute(routeOf('/p/Ab3dE5gH'))).toBe(true)
  expect(isRadioRoute(routeOf('/songs'))).toBe(false)
  expect(isRadioRoute(routeOf('/nope'))).toBe(false)
})

test('a tracking link opens the commission route carrying the id, and the token stays in the query', () => {
  const id = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0001'
  const route = routeOf(`/commission/${id}?t=abc_-123`)
  expect(route._tag).toBe('Commission')
  expect(route._tag === 'Commission' && route.id).toBe(id)
  expect(routeOf(`/commission/${id}`)._tag).toBe('Commission')
})

test('a commission link whose id is not a lowercase UUID is not a page', () => {
  expect(routeOf('/commission/abc')._tag).toBe('NotFound')
  expect(routeOf('/commission/6F0E5D0A-5A43-4C52-9A56-2A8F0F6C0001')._tag).toBe(
    'NotFound',
  )
  expect(routeOf('/commission')._tag).toBe('NotFound')
})
