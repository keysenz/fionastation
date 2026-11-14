// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  type AuthReply,
  type AuthRoute,
  createDiscordAuth,
} from './discordAuth.ts'
import { openPlaylistStore } from './playlists.ts'

const SITE = 'https://site.test'
const APP = {
  clientId: 'client-1',
  clientSecret: 'a-throwaway-client-secret',
  apiBase: 'https://discord.test/api',
}
const ALICE = {
  id: '111111111111111111',
  username: 'alice',
  global_name: 'Alice',
}

let dir: string
let dbPath: string
let clock: Date

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'discord-auth-test-'))
  dbPath = join(dir, 'playlists.db')
  clock = new Date('2026-11-14T10:00:00Z')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

type Call = Readonly<{ url: string; init: RequestInit }>

const harness = (
  options: Readonly<{
    token?: () => Response
    user?: () => Response
    discord?: typeof APP | undefined
    siteOrigin?: string
    loginsPerIp?: number
  }> = {},
) => {
  const calls: Call[] = []
  const secrets = ['state-1', 'session-1', 'state-2', 'session-2']
  const store = openPlaylistStore({ path: dbPath, now: () => clock })
  const auth = createDiscordAuth({
    discord: 'discord' in options ? options.discord : APP,
    siteOrigin: options.siteOrigin ?? SITE,
    sessions: store.sessions,
    now: () => clock,
    newSecret: () =>
      secrets.shift() ?? `spare-${secrets.length}-${calls.length}`,
    ...(options.loginsPerIp === undefined
      ? {}
      : { loginsPerIp: options.loginsPerIp }),
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return String(url).endsWith('/oauth2/token')
        ? (options.token?.() ?? Response.json({ access_token: 'access-1' }))
        : (options.user?.() ?? Response.json(ALICE))
    },
  })
  const send = (
    route: AuthRoute,
    request: Readonly<{
      method?: string
      query?: string
      cookie?: string
      origin?: string
      ip?: string
    }> = {},
  ) =>
    auth.handle({
      method: request.method ?? 'GET',
      route,
      ip: request.ip ?? '9.9.9.9',
      query: new URLSearchParams(request.query ?? ''),
      cookie: request.cookie,
      origin: request.origin,
    })
  const sessionRows = () =>
    new DatabaseSync(dbPath, { readOnly: true })
      .prepare('SELECT * FROM sessions')
      .all()
  const login = async () => {
    await send('discord/start')
    const reply = await send('discord/callback', {
      query: 'code=code-1&state=state-1',
      cookie: 'fs_oauth_state=state-1',
    })
    return { reply, cookie: 'fs_session=session-1' }
  }
  return { auth, send, calls, sessionRows, login }
}

const statusOf = (reply: AuthReply) =>
  reply.kind === 'Json' ? reply.status : 302

describe('login', () => {
  test('start sets a short-lived state cookie and sends the browser to Discord', async () => {
    const { send } = harness()
    const reply = await send('discord/start')

    if (reply.kind !== 'Redirect') throw new Error(reply.kind)
    const target = new URL(reply.location)
    expect(target.origin + target.pathname).toBe(
      'https://discord.test/api/oauth2/authorize',
    )
    expect(Object.fromEntries(target.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      scope: 'identify',
      state: 'state-1',
      redirect_uri: 'https://site.test/api/auth/discord/callback',
    })
    expect(reply.cookies).toEqual([
      'fs_oauth_state=state-1; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure',
    ])
  })

  test('the callback exchanges the code, stores only a hash, and sets a 30-day session cookie', async () => {
    const { login, calls, sessionRows, send } = harness()
    const { reply, cookie } = await login()

    expect(reply).toEqual({
      kind: 'Redirect',
      location: '/',
      cookies: [
        'fs_session=session-1; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure',
        'fs_oauth_state=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
      ],
    })
    const [exchange, whoAmI] = calls
    expect(exchange?.url).toBe('https://discord.test/api/oauth2/token')
    expect(
      Object.fromEntries(new URLSearchParams(String(exchange?.init.body))),
    ).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://site.test/api/auth/discord/callback',
      client_id: 'client-1',
      client_secret: 'a-throwaway-client-secret',
    })
    expect(whoAmI?.url).toBe('https://discord.test/api/users/@me')
    expect(new Headers(whoAmI?.init.headers).get('authorization')).toBe(
      'Bearer access-1',
    )
    const rows = sessionRows()
    expect(rows).toEqual([
      {
        id_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        discord_id: ALICE.id,
        discord_name: 'Alice',
        created_at: '2026-11-14T10:00:00.000Z',
        expires_at: '2026-12-14T10:00:00.000Z',
      },
    ])
    expect(JSON.stringify(rows)).not.toContain('session-1')
    expect(await send('me', { cookie })).toMatchObject({
      status: 200,
      body: { discordId: ALICE.id, name: 'Alice' },
    })
  })

  test('a state that differs from the cookie, or is missing, lands on the page as login=state with no session and no Discord call', async () => {
    const { send, calls, sessionRows } = harness()
    await send('discord/start')
    const attempts = [
      { query: 'code=code-1&state=other', cookie: 'fs_oauth_state=state-1' },
      { query: 'code=code-1', cookie: 'fs_oauth_state=state-1' },
      { query: 'code=code-1&state=state-1' },
      { query: 'code=code-1&state=', cookie: 'fs_oauth_state=' },
    ]
    for (const attempt of attempts) {
      expect(await send('discord/callback', attempt)).toMatchObject({
        kind: 'Redirect',
        location: '/?login=state',
      })
    }
    expect(calls).toEqual([])
    expect(sessionRows()).toEqual([])
  })

  test.each([
    [
      'Discord refuses the code',
      {
        token: () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      },
    ],
    ['the token reply has no access token', { token: () => Response.json({}) }],
    ['the token reply is not JSON', { token: () => new Response('<html>') }],
    [
      'the user lookup fails',
      { user: () => new Response('', { status: 401 }) },
    ],
    [
      'the user has no usable id',
      { user: () => Response.json({ id: 'me', username: 'x' }) },
    ],
    [
      'Discord is unreachable',
      {
        token: () => {
          throw new TypeError('fetch failed')
        },
      },
    ],
  ])(
    'a failed login lands on the page as login=refused with no session when %s',
    async (_, options) => {
      const { login, sessionRows, send } = harness(options)
      const { reply, cookie } = await login()

      expect(reply).toMatchObject({
        kind: 'Redirect',
        location: '/?login=refused',
      })
      expect(reply.cookies.join()).not.toContain('fs_session')
      expect(sessionRows()).toEqual([])
      expect(statusOf(await send('me', { cookie }))).toBe(401)
    },
  )

  test('a visitor who cancels on Discord returns to the page with no session', async () => {
    const { send, sessionRows, calls } = harness()
    const reply = await send('discord/callback', {
      query: 'error=access_denied&state=state-1',
      cookie: 'fs_oauth_state=state-1',
    })
    expect(reply).toMatchObject({ kind: 'Redirect', location: '/' })
    expect(calls).toEqual([])
    expect(sessionRows()).toEqual([])
  })

  test('a user with no display name is known by the username', async () => {
    const { login, send } = harness({
      user: () => Response.json({ ...ALICE, global_name: null }),
    })
    const { cookie } = await login()
    expect(await send('me', { cookie })).toMatchObject({
      body: { name: 'alice' },
    })
  })

  test('a second login in the same browser replaces the first session', async () => {
    const { login, send, sessionRows } = harness()
    const { cookie } = await login()
    await send('discord/start')
    await send('discord/callback', {
      query: 'code=code-2&state=state-2',
      cookie: `${cookie}; fs_oauth_state=state-2`,
    })
    expect(sessionRows()).toHaveLength(1)
    expect(statusOf(await send('me', { cookie }))).toBe(401)
    expect(statusOf(await send('me', { cookie: 'fs_session=session-2' }))).toBe(
      200,
    )
  })

  test('the callback and start are limited per address before any call to Discord', async () => {
    const { send, calls } = harness({ loginsPerIp: 3 })
    const hit = (ip: string) =>
      send('discord/callback', {
        query: 'code=x&state=chosen',
        cookie: 'fs_oauth_state=chosen',
        ip,
      })
    const locations = []
    for (let i = 0; i < 6; i++) {
      const reply = await hit('1.1.1.1')
      locations.push(reply.kind === 'Redirect' ? reply.location : undefined)
    }
    expect(locations).toEqual([
      '/',
      '/',
      '/',
      ...Array(3).fill('/?login=limit'),
    ])
    expect(
      calls.filter(call => call.url.endsWith('/oauth2/token')),
    ).toHaveLength(3)
    expect(await send('discord/start', { ip: '1.1.1.1' })).toMatchObject({
      location: '/?login=limit',
    })
    expect(await hit('2.2.2.2')).toMatchObject({ location: '/' })
  })

  test('every callback answer clears the state cookie, so the same state cannot be replayed', async () => {
    const { send, calls } = harness()
    const cleared = 'fs_oauth_state=; Path=/api/auth; Max-Age=0'
    const attempts = [
      { query: 'code=c&state=wrong', cookie: 'fs_oauth_state=state-1' },
      { query: 'state=state-1', cookie: 'fs_oauth_state=state-1' },
      { query: 'code=c&state=state-1', cookie: 'fs_oauth_state=state-1' },
    ]
    for (const attempt of attempts) {
      const reply = await send('discord/callback', attempt)
      expect(reply.cookies.some(c => c.startsWith(cleared))).toBe(true)
    }
    expect(calls.map(call => call.url.split('/').pop())).toEqual([
      'token',
      '@me',
    ])
  })

  test('cookies drop Secure only when the site itself is plain http', async () => {
    const { send } = harness({ siteOrigin: 'http://127.0.0.1:3456' })
    const reply = await send('discord/start')
    expect(reply.cookies).toEqual([
      'fs_oauth_state=state-1; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax',
    ])
  })
})

describe('session', () => {
  test('me is a 401 without a cookie, with an unknown one, and after 30 days', async () => {
    const { login, send } = harness()
    const { cookie } = await login()

    expect(statusOf(await send('me'))).toBe(401)
    expect(statusOf(await send('me', { cookie: 'fs_session=guess' }))).toBe(401)
    clock = new Date('2026-12-14T09:59:59Z')
    expect(statusOf(await send('me', { cookie }))).toBe(200)
    clock = new Date('2026-12-14T10:00:00Z')
    expect(statusOf(await send('me', { cookie }))).toBe(401)
  })

  test('logout removes the session row and clears the cookie', async () => {
    const { login, send, sessionRows } = harness()
    const { cookie } = await login()

    const reply = await send('logout', {
      method: 'POST',
      cookie,
      origin: SITE,
    })

    expect(reply).toMatchObject({
      status: 200,
      cookies: [
        'fs_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
      ],
    })
    expect(sessionRows()).toEqual([])
    expect(statusOf(await send('me', { cookie }))).toBe(401)
    expect(statusOf(await send('logout', { method: 'POST', cookie }))).toBe(200)
  })

  test('a logout from another site is refused and the session stays', async () => {
    const { login, send, sessionRows } = harness()
    const { cookie } = await login()
    const evil = { method: 'POST', cookie, origin: 'https://evil.example' }

    expect(statusOf(await send('logout', evil))).toBe(403)
    expect(statusOf(await send('logout', { method: 'POST', cookie }))).toBe(403)
    expect(sessionRows()).toHaveLength(1)
  })

  test('the viewer is a member on reads and same-site writes, and cross-site on other writes', async () => {
    const { login, auth } = harness()
    const { cookie } = await login()
    const member = { kind: 'Member', discordId: ALICE.id }

    expect(auth.viewer({ method: 'GET', cookie, origin: undefined })).toEqual(
      member,
    )
    expect(auth.viewer({ method: 'PUT', cookie, origin: SITE })).toEqual(member)
    for (const origin of [
      'https://evil.example',
      `${SITE}.evil.example`,
      'null',
      undefined,
    ]) {
      expect(auth.viewer({ method: 'PUT', cookie, origin })).toEqual({
        kind: 'CrossSite',
      })
    }
    expect(
      auth.viewer({
        method: 'PUT',
        cookie: undefined,
        origin: 'https://evil.example',
      }),
    ).toEqual({ kind: 'Anonymous' })
    expect(
      auth.viewer({ method: 'PUT', cookie: 'fs_session=guess', origin: SITE }),
    ).toEqual({ kind: 'Anonymous' })
  })
})

describe('guards', () => {
  test('every auth route is a 503 when the Discord application is not configured', async () => {
    const { send } = harness({ discord: undefined })
    expect(statusOf(await send('discord/start'))).toBe(503)
    expect(statusOf(await send('discord/callback'))).toBe(503)
    expect(statusOf(await send('me'))).toBe(503)
    expect(statusOf(await send('logout', { method: 'POST' }))).toBe(503)
  })

  test('the wrong method is a 405', async () => {
    const { send } = harness()
    expect(statusOf(await send('discord/start', { method: 'POST' }))).toBe(405)
    expect(statusOf(await send('me', { method: 'POST' }))).toBe(405)
    expect(statusOf(await send('logout'))).toBe(405)
  })
})
