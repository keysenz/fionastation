import { Option, Schema } from 'effect'
import { expect, test } from 'vitest'

import { PlaylistId } from '../../playlist.ts'
import {
  EditToken,
  type Owned,
  copyName,
  editTokenOf,
  editTokenOfHash,
  forget,
  isUnproven,
  mergeOwned,
  ownedToJson,
  parseOwned,
  remember,
  rename,
  writtenName,
} from './playlists.ts'

const id = (value: string) => Schema.decodeSync(PlaylistId)(value)
const token = (value: string) => Schema.decodeSync(EditToken)(value)
const owned = (value: string, name = value): Owned => ({
  id: id(value),
  name,
  editToken: token(`token-${value}`),
  origin: 'Created',
})
const [one, two] = [owned('AAAAAAAA'), owned('BBBBBBBB')]

test('what is stored comes back as it was saved', () => {
  expect(parseOwned(Option.some(ownedToJson([one, two])))).toEqual([one, two])
})

test('storage that holds anything else reads as no playlists', () => {
  expect(parseOwned(Option.none())).toEqual([])
  expect(parseOwned(Option.some('not json'))).toEqual([])
  expect(parseOwned(Option.some('[{"id":"x"}]'))).toEqual([])
})

test('a proven token replaces the stored one', () => {
  const again = { ...one, editToken: token('newer') }
  expect(remember([one, two], again)).toEqual([two, again])
})

test('forgetting and renaming touch only that playlist', () => {
  expect(forget([one, two], one.id)).toEqual([two])
  expect(rename([one, two], two.id, 'New')).toEqual([
    one,
    { ...two, name: 'New' },
  ])
})

test('storage fills in what the page has not learned and never overrides it', () => {
  const newer = { ...one, editToken: token('newer') }
  expect(mergeOwned([one, two], [newer])).toEqual([two, newer])
})

test('the edit token of a playlist is found by its id', () => {
  expect(editTokenOf([one, two], two.id)).toEqual(Option.some(two.editToken))
  expect(editTokenOf([one], two.id)).toEqual(Option.none())
})

test('an edit fragment yields its token and anything else yields none', () => {
  expect(editTokenOfHash(Option.some('edit=abc_DEF-123'))).toEqual(
    Option.some(token('abc_DEF-123')),
  )
  expect(editTokenOfHash(Option.some('edit='))).toEqual(Option.none())
  expect(editTokenOfHash(Option.some('edit=has space'))).toEqual(Option.none())
  expect(editTokenOfHash(Option.some('other=abc'))).toEqual(Option.none())
  expect(editTokenOfHash(Option.none())).toEqual(Option.none())
})

test('a name is cleaned, an empty name falls back, and a long one is refused', () => {
  expect(writtenName('  𝓕𝓲𝓸𝓷𝓪​  ')).toEqual({ kind: 'Valid', name: 'Fiona' })
  expect(writtenName('   ')).toEqual({
    kind: 'Valid',
    name: 'Untitled playlist',
  })
  expect(writtenName('x'.repeat(61))).toEqual({ kind: 'TooLong' })
})

test('a copy name ends in (copy) and still fits in 60 characters', () => {
  expect(copyName('Rainy day')).toBe('Rainy day (copy)')
  const long = copyName('y'.repeat(60))
  expect(long.endsWith(' (copy)')).toBe(true)
  expect(writtenName(long).kind).toBe('Valid')
})

test('a token that differs from the stored one is unproven, a new playlist is not', () => {
  const other = token('other')
  expect(isUnproven([one], one.id, other)).toBe(true)
  expect(isUnproven([one], one.id, one.editToken)).toBe(false)
  expect(isUnproven([two], one.id, other)).toBe(false)
})

test('an entry stored before origins were recorded reads as created', () => {
  expect(
    parseOwned(
      Option.some(
        JSON.stringify([
          { id: 'AAAAAAAA', name: 'old', editToken: 'token-AAAAAAAA' },
        ]),
      ),
    ),
  ).toEqual([{ ...one, name: 'old' }])
})

test('a picked-up origin survives storage', () => {
  const pickedUp: Owned = { ...two, origin: 'PickedUp' }
  expect(parseOwned(Option.some(ownedToJson([pickedUp])))).toEqual([pickedUp])
})
