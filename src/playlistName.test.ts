import { describe, expect, test } from 'vitest'

import {
  DEFAULT_PLAYLIST_NAME,
  MAX_PLAYLIST_NAME_GRAPHEMES,
  cleanPlaylistName,
} from './playlistName.ts'

const cleaned = (raw: string) => {
  const result = cleanPlaylistName(raw)
  if (result.kind !== 'Cleaned') {
    throw new Error(`expected a cleaned name, got ${result.kind}`)
  }
  return result.name
}

describe('cleanPlaylistName', () => {
  test('fancy Unicode folds to plain letters', () => {
    expect(cleaned('𝓕𝓲𝓸𝓷𝓪')).toBe('Fiona')
  })

  test('bidi controls and zero-width characters are removed', () => {
    expect(cleaned('  ‮𝓕𝓲𝓸𝓷𝓪​  ')).toBe('Fiona')
    expect(cleaned('a‍b⁦c⁩d﻿e؜f')).toBe('abcdef')
  })

  test('control characters never survive and line breaks become spaces', () => {
    expect(cleaned('rainy\nday\u0000\u0007 Fio')).toBe('rainy day Fio')
  })

  test('runs of whitespace collapse and the ends are trimmed', () => {
    expect(cleaned('  rainy \t  day  ')).toBe('rainy day')
  })

  test.each(['', '   ', '​‮', '\n\t'])(
    'a name with nothing visible (%j) becomes the default name',
    raw => {
      expect(cleaned(raw)).toBe(DEFAULT_PLAYLIST_NAME)
    },
  )

  test('the limit counts graphemes, so a family emoji is one', () => {
    expect(cleaned('a'.repeat(MAX_PLAYLIST_NAME_GRAPHEMES))).toHaveLength(
      MAX_PLAYLIST_NAME_GRAPHEMES,
    )
    expect(
      cleanPlaylistName('a'.repeat(MAX_PLAYLIST_NAME_GRAPHEMES + 1)),
    ).toEqual({ kind: 'TooLong' })
    expect(
      cleanPlaylistName('🎤'.repeat(MAX_PLAYLIST_NAME_GRAPHEMES)).kind,
    ).toBe('Cleaned')
    expect(
      cleanPlaylistName('é'.repeat(MAX_PLAYLIST_NAME_GRAPHEMES + 1)).kind,
    ).toBe('TooLong')
  })

  test('a cleaned name cleans to itself', () => {
    for (const raw of ['𝓕𝓲𝓸𝓷𝓪', ' a​b ', '', 'ｆｕｌｌ　ｗｉｄｔｈ']) {
      const once = cleaned(raw)
      expect(cleaned(once)).toBe(once)
    }
  })
})
