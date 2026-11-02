import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import type { Cover } from '../domain.ts'
import {
  Message,
  type Model,
  PickRandomVideo,
  entered,
  init,
  update,
} from './cover'

const videos: ReadonlyArray<Cover> = ['a', 'b', 'c'].map(id => ({
  id,
  title: `Video ${id}`,
  video_id: `yt-${id}`,
  published_at: null,
}))
const loaded = (): Model =>
  update(init(), Message.SucceededFetchCovers({ videos })).model

test('next and previous wrap around the list', () => {
  story(
    update,
    given(loaded()),
    message(Message.ClickedPrevious()),
    model(current => {
      expect(current.currentIndex).toBe(2)
    }),
    message(Message.ClickedNext()),
    model(current => {
      expect(current.currentIndex).toBe(0)
    }),
  )
})

test('a video end only moves on when autoplay is on', () => {
  story(
    update,
    given(loaded()),
    message(Message.EndedVideo()),
    model(current => {
      expect(current.currentIndex).toBe(0)
    }),
    message(Message.ClickedToggleAutoplay()),
    message(Message.EndedVideo()),
    model(current => {
      expect(current.currentIndex).toBe(1)
    }),
  )
})

test('shuffle moves through a random pick', () => {
  story(
    update,
    given(loaded()),
    message(Message.ClickedToggleShuffle()),
    message(Message.ClickedNext()),
    Command.resolve(
      PickRandomVideo,
      Message.CompletedPickRandomVideo({ index: 2 }),
    ),
    model(current => {
      expect(current.currentIndex).toBe(2)
    }),
  )
})

test('a new visit starts at the newest video and keeps the loaded list on screen', () => {
  const moved = update(loaded(), Message.ClickedNext()).model
  const revisit = entered(moved)
  expect(revisit.model.currentIndex).toBe(0)
  expect(revisit.model.videos._tag).toBe('Refreshing')
})
