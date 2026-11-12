import { AsyncData } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import type { Songbook } from '../../domain.ts'
import {
  FetchSongbook,
  Message,
  init,
  update,
  visibleGroups,
  visibleNotes,
  visibleRequests,
} from './songs'

const songbook: Songbook = {
  songs: [
    { title: 'Homura', language: 'JP' },
    { title: 'Perahu kertas', language: 'ID' },
    { title: 'Tabako', language: 'JP' },
  ],
  requests: ['phoebe - crown'],
  notes: ['hanako oku kawaranai mono'],
}

test('loading fetches the sheet and shows the songs it returns', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedRetryFetch()),
    Command.resolve(
      FetchSongbook,
      Message.SucceededFetchSongbook({ songbook }),
    ),
    model(current => {
      expect(AsyncData.getData(current.songbook)).toMatchObject({
        _tag: 'Some',
        value: songbook,
      })
    }),
  )
})

test('a failed fetch shows the error, and retry fetches again', () => {
  story(
    update,
    given(init()),
    message(Message.ClickedRetryFetch()),
    Command.resolve(
      FetchSongbook,
      Message.FailedFetchSongbook({ error: 'Could not reach the archive' }),
    ),
    model(current => {
      expect(AsyncData.getError(current.songbook)).toMatchObject({
        _tag: 'Some',
      })
    }),
    message(Message.ClickedRetryFetch()),
    Command.resolve(
      FetchSongbook,
      Message.SucceededFetchSongbook({ songbook }),
    ),
    model(current => {
      expect(AsyncData.getData(current.songbook)._tag).toBe('Some')
    }),
  )
})

test('languages keep sheet order and a search filters songs and requests', () => {
  expect(
    visibleGroups(songbook, '').map(group => [
      group.language,
      group.songs.map(song => song.title),
    ]),
  ).toEqual([
    ['JP', ['Homura', 'Tabako']],
    ['ID', ['Perahu kertas']],
  ])
  expect(
    visibleGroups(songbook, 'tabako').map(group => group.songs.length),
  ).toEqual([1, 0])
  expect(visibleRequests(songbook, 'crown')).toEqual(['phoebe - crown'])
  expect(visibleRequests(songbook, 'homura')).toEqual([])
  expect(visibleNotes(songbook, 'hanako')).toEqual([
    'hanako oku kawaranai mono',
  ])
  expect(visibleNotes(songbook, 'homura')).toEqual([])
})

test('the notes toggle opens and closes', () => {
  story(
    update,
    given(init()),
    model(current => expect(current.isNotesOpen).toBe(false)),
    message(Message.ToggledNotes()),
    model(current => expect(current.isNotesOpen).toBe(true)),
    message(Message.ToggledNotes()),
    model(current => expect(current.isNotesOpen).toBe(false)),
  )
})
