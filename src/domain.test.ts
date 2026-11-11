import { expect, test } from 'vitest'

import { type KaraokeVideo, goneVideoIdsOf, songLabel } from './domain.ts'

const video = (
  video_url: string,
  fields: Partial<KaraokeVideo> = {},
): KaraokeVideo => ({
  id: video_url,
  video_title: video_url,
  video_url,
  membership: false,
  is_gone: false,
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
