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
