import { DateTime } from 'effect'
import { expect, test } from 'vitest'

import {
  type KaraokeVideo,
  formatPublishDate,
  goneVideoIdsOf,
  songLabel,
} from './domain.ts'

const video = (
  video_url: string,
  fields: Partial<KaraokeVideo> = {},
): KaraokeVideo => ({
  id: video_url,
  video_title: video_url,
  video_url,
  membership: false,
  is_gone: false,
  published_at: DateTime.makeUnsafe('2026-09-29T12:24:01Z'),
  kind: 'karaoke',
  karaoke_song: [],
  ...fields,
})

test('members-only and gone videos are both treated as gone, public live ones are not', () => {
  expect(
    goneVideoIdsOf([
      video('live'),
      video('members', { membership: true }),
      video('gone', { is_gone: true }),
    ]),
  ).toEqual(['members', 'gone'])
})

test('a song label reads like the bot: Title (version) - Artist, skipping empty parts', () => {
  expect(
    songLabel({
      song_title: 'Pretender',
      version: 'short',
      artist: 'Official HIGE DANdism',
    }),
  ).toBe('Pretender (short) - Official HIGE DANdism')
  expect(
    songLabel({ song_title: 'Lantas', version: '', artist: 'Juicy Luicy' }),
  ).toBe('Lantas - Juicy Luicy')
  expect(
    songLabel({
      song_title: 'Crayon Shin-chan Opening',
      version: 'Indonesian, rock',
      artist: '',
    }),
  ).toBe('Crayon Shin-chan Opening (Indonesian, rock)')
  expect(songLabel({ song_title: 'Hello', version: '', artist: '' })).toBe(
    'Hello',
  )
})

test('a publish date reads as day, short month, full year in UTC', () => {
  const at = (iso: string) => DateTime.makeUnsafe(iso)
  expect(formatPublishDate(at('2026-09-29T12:24:01Z'))).toBe('29 Sep 2026')
  expect(formatPublishDate(at('2022-03-03T00:00:00Z'))).toBe('3 Mar 2022')
  expect(formatPublishDate(at('2025-12-31T23:59:59Z'))).toBe('31 Dec 2025')
  expect(formatPublishDate(at('2026-01-01T00:00:00Z'))).toBe('1 Jan 2026')
})
