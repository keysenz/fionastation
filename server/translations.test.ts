// @vitest-environment node
import { expect, test } from 'vitest'

import type { Lyrics } from '../src/lyrics.ts'
import { parseTranslations, withTranslation } from './translations.ts'

const translation = {
  language: 'id',
  lines: [
    { atMs: 0, text: 'satu' },
    { atMs: 4000, text: '' },
  ],
}

const missing: Lyrics = { _tag: 'Missing', reason: 'NotFound' }
const synced: Lyrics = {
  _tag: 'Synced',
  lines: [{ atMs: 0, text: 'one' }],
  offsetMs: 0,
  credit: { source: 'LRCLIB', track: 't', artist: 'a' },
}

test('a translation rides on both variants', () => {
  const parsed = parseTranslations({ song: translation }).get('song')
  expect(withTranslation(missing, parsed)).toEqual({
    ...missing,
    translation,
  })
  expect(withTranslation(synced, parsed)).toEqual({ ...synced, translation })
})

test('a song without a translation is answered unchanged', () => {
  const all = parseTranslations({ song: translation })
  expect(withTranslation(missing, all.get('other'))).toEqual(missing)
  expect(withTranslation(synced, all.get('other'))).toEqual(synced)
})

test.each([
  ['a non-object file', []],
  ['an entry without lines', { a: { language: 'id', lines: [] } }],
  ['an entry without a language', { a: { lines: translation.lines } }],
  [
    'lines out of order',
    {
      a: {
        language: 'id',
        lines: [
          { atMs: 5, text: 'x' },
          { atMs: 1, text: 'y' },
        ],
      },
    },
  ],
  [
    'a fractional time',
    { a: { language: 'id', lines: [{ atMs: 1.5, text: 'x' }] } },
  ],
])('rejects %s', (_name, json) => {
  expect(() => parseTranslations(json)).toThrow()
})
