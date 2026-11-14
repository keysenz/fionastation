import { Effect, Schema } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import { PlaylistId } from '../../playlist.ts'
import { LoadAccount, LoadAccountPlaylists, Logout } from './karaoke'
import { EditToken, type Owned } from './playlists.ts'

const idOf = (index: number) =>
  Schema.decodeSync(PlaylistId)(String(index).padStart(8, '0'))
const ownedAt = (index: number): Owned => ({
  id: idOf(index),
  name: `n${index}`,
  editToken: Schema.decodeSync(EditToken)(`token${index}`),
})

type Call = Readonly<{ method: string; path: string; body: unknown }>

const stubServer = (answer: (call: Call) => Response): ReadonlyArray<Call> => {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const call = {
      method: init?.method ?? 'GET',
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return Promise.resolve(answer(call))
  })
  return calls
}

const run = <A, E>(command: { effect: Effect.Effect<A, E> }) =>
  Effect.runPromise(command.effect)

afterEach(() => vi.unstubAllGlobals())

const summary = (index: number) => ({
  id: idOf(index),
  name: `n${index}`,
  deleted: false,
})

test('claims go out in batches of at most 100 tokens, then the account list is read again', async () => {
  let claimed = false
  const calls = stubServer(({ method, body }) => {
    if (method === 'POST') {
      claimed = true
      const tokens = (body as { editTokens: ReadonlyArray<string> }).editTokens
      return Response.json({ claimed: tokens })
    }
    return Response.json({
      playlists: claimed ? [summary(0), summary(1), summary(2)] : [summary(0)],
    })
  })
  const owned = Array.from({ length: 250 }, (_, index) => ownedAt(index))
  const message = await run(LoadAccountPlaylists({ owned }))
  const posts = calls.filter(({ method }) => method === 'POST')
  expect(
    posts.map(
      ({ body }) => (body as { editTokens: unknown[] }).editTokens.length,
    ),
  ).toEqual([100, 100, 49])
  expect(calls.map(({ method }) => method)).toEqual([
    'GET',
    'POST',
    'POST',
    'POST',
    'GET',
  ])
  expect(message).toMatchObject({
    _tag: 'SucceededLoadAccountPlaylists',
    playlists: [{ id: idOf(0) }, { id: idOf(1) }, { id: idOf(2) }],
  })
})

test('a browser whose playlists the account already owns claims nothing', async () => {
  const calls = stubServer(() => Response.json({ playlists: [summary(0)] }))
  await run(LoadAccountPlaylists({ owned: [ownedAt(0)] }))
  expect(calls.map(({ method }) => method)).toEqual(['GET'])
})

test('tokens the server will not claim are not read back again', async () => {
  const calls = stubServer(({ method }) =>
    method === 'POST'
      ? Response.json({ claimed: [] })
      : Response.json({ playlists: [] }),
  )
  await run(LoadAccountPlaylists({ owned: [ownedAt(5)] }))
  expect(calls.map(({ method }) => method)).toEqual(['GET', 'POST'])
})

test('deleted playlists are not listed', async () => {
  stubServer(() =>
    Response.json({
      playlists: [{ ...summary(0), deleted: true }, summary(1)],
    }),
  )
  const message = await run(LoadAccountPlaylists({ owned: [] }))
  expect(message).toMatchObject({
    playlists: [{ id: idOf(1) }],
  })
})

test('a failed list is a quiet failure message, not an exception', async () => {
  stubServer(() => new Response('', { status: 500 }))
  expect(await run(LoadAccountPlaylists({ owned: [] }))).toMatchObject({
    _tag: 'FailedLoadAccountPlaylists',
  })
})

test.each([
  [200, { discordId: '1', name: 'Fake Fan' }, 'SucceededLoadAccount'],
  [401, { error: 'Not connected' }, 'FailedLoadAccount'],
  [503, { error: 'unavailable' }, 'FailedLoadAccount'],
  [404, { error: 'Not Found' }, 'FailedLoadAccount'],
] as const)('the account answer %s becomes %s', async (status, body, tag) => {
  stubServer(() => Response.json(body, { status }))
  expect(await run(LoadAccount())).toMatchObject({ _tag: tag })
})

test('an account name with markup comes through as the same text', async () => {
  const name = '<img src=x onerror=alert(1)>'
  stubServer(() => Response.json({ discordId: '1', name }))
  expect(await run(LoadAccount())).toMatchObject({ name })
})

test('a dead network is the same as an account that is not offered', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  expect(await run(LoadAccount())).toMatchObject({
    _tag: 'FailedLoadAccount',
    kind: 'Unavailable',
  })
})

test('disconnect posts to logout and reports whether it worked', async () => {
  const calls = stubServer(() => Response.json({}))
  expect(await run(Logout())).toMatchObject({ _tag: 'SucceededLogout' })
  expect(calls).toEqual([
    { method: 'POST', path: '/api/auth/logout', body: undefined },
  ])
  stubServer(() => new Response('', { status: 500 }))
  expect(await run(Logout())).toMatchObject({ _tag: 'FailedLogout' })
})
