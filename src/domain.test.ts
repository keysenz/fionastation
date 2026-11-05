import { expect, test } from 'vitest'

import { type KaraokeVideo, goneVideoIdsOf } from './domain.ts'

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
