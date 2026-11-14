import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { isDiscordId, windowLimiter } from './playlists.ts'
import type { Account, SessionStore, Viewer } from './playlists.ts'

export const SESSION_COOKIE = 'fs_session'
export const STATE_COOKIE = 'fs_oauth_state'
const SESSION_SECONDS = 30 * 24 * 60 * 60
const STATE_SECONDS = 10 * 60
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const DISCORD_TIMEOUT_MS = 10_000
const MAX_NAME_LENGTH = 64

export type DiscordApp = Readonly<{
  clientId: string
  clientSecret: string
  apiBase: string
}>

export const AUTH_ROUTES = {
  'discord/start': 'GET',
  'discord/callback': 'GET',
  me: 'GET',
  logout: 'POST',
} as const
export type AuthRoute = keyof typeof AUTH_ROUTES

export type AuthRequest = Readonly<{
  method: string
  route: AuthRoute
  ip: string
  query: URLSearchParams
  cookie: string | undefined
  origin: string | undefined
}>

export type AuthReply =
  | Readonly<{
      kind: 'Json'
      status: number
      body: unknown
      cookies: readonly string[]
    }>
  | Readonly<{
      kind: 'Redirect'
      location: string
      cookies: readonly string[]
    }>

const json = (
  status: number,
  body: unknown,
  cookies: readonly string[] = [],
): AuthReply => ({ kind: 'Json', status, body, cookies })
const failure = (status: number, error: string) => json(status, { error })

const tooManyLogins = failure(429, 'Too many login attempts. Try later.')

const sha256 = (value: string) => createHash('sha256').update(value)

const readCookie = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map(pair => pair.trim())
    .find(pair => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1) || undefined

const asObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const parseAccount = (user: Record<string, unknown>): Account | undefined => {
  const { id, username, global_name: globalName } = user
  if (typeof id !== 'string' || !isDiscordId(id)) return undefined
  const name =
    typeof globalName === 'string' && globalName !== '' ? globalName : username
  return typeof name === 'string' && name !== ''
    ? { discordId: id, name: name.slice(0, MAX_NAME_LENGTH) }
    : undefined
}

export const createDiscordAuth = ({
  discord,
  siteOrigin,
  sessions,
  fetch = globalThis.fetch,
  now = () => new Date(),
  newSecret = () => randomBytes(32).toString('base64url'),
  loginsPerIp = 30,
}: Readonly<{
  discord: DiscordApp | undefined
  siteOrigin: string
  sessions: SessionStore
  fetch?: typeof globalThis.fetch
  now?: () => Date
  newSecret?: () => string
  loginsPerIp?: number
}>) => {
  const allowLogin = windowLimiter(loginsPerIp, LOGIN_WINDOW_MS, now)
  const redirectUri = `${siteOrigin}/api/auth/discord/callback`
  const secure = siteOrigin.startsWith('https:') ? '; Secure' : ''
  const cookie = (name: string, value: string, path: string, seconds: number) =>
    `${name}=${value}; Path=${path}; Max-Age=${seconds}; HttpOnly; SameSite=Lax${secure}`
  const stateCookie = (state: string, seconds: number) =>
    cookie(STATE_COOKIE, state, '/api/auth', seconds)
  const sessionCookie = (id: string, seconds: number) =>
    cookie(SESSION_COOKIE, id, '/', seconds)

  const sessionHash = (header: string | undefined) => {
    const id = readCookie(header, SESSION_COOKIE)
    return id === undefined ? undefined : sha256(id).digest('hex')
  }

  const account = (cookieHeader: string | undefined) => {
    const hash = sessionHash(cookieHeader)
    return hash === undefined ? undefined : sessions.find(hash)
  }

  const viewer = ({
    method,
    cookie: cookieHeader,
    origin,
  }: Pick<AuthRequest, 'method' | 'cookie' | 'origin'>): Viewer => {
    const member = account(cookieHeader)
    if (!member) return { kind: 'Anonymous' }
    const reads = method === 'GET' || method === 'HEAD'
    return reads || origin === siteOrigin
      ? { kind: 'Member', discordId: member.discordId }
      : { kind: 'CrossSite' }
  }

  const askDiscord = async (
    { apiBase }: DiscordApp,
    path: string,
    init: RequestInit,
  ) => {
    try {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      })
      if (!response.ok) {
        console.error(`Discord answered ${response.status} for ${path}`)
        return undefined
      }
      return asObject(await response.json())
    } catch (error) {
      console.error(`Discord request to ${path} failed:`, error)
      return undefined
    }
  }

  const signIn = async (app: DiscordApp, code: string) => {
    const token = await askDiscord(app, '/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }).toString(),
    })
    if (typeof token?.access_token !== 'string') return undefined
    const user = await askDiscord(app, '/users/@me', {
      headers: { authorization: `Bearer ${token.access_token}` },
    })
    return user && parseAccount(user)
  }

  const start = (app: DiscordApp): AuthReply => {
    const state = newSecret()
    const authorize = new URL(`${app.apiBase}/oauth2/authorize`)
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      scope: 'identify',
      state,
      redirect_uri: redirectUri,
    }).toString()
    return {
      kind: 'Redirect',
      location: authorize.href,
      cookies: [stateCookie(state, STATE_SECONDS)],
    }
  }

  const callback = async (
    app: DiscordApp,
    { query, cookie: cookieHeader }: AuthRequest,
  ): Promise<AuthReply> => {
    const forgetState = stateCookie('', 0)
    const sent = readCookie(cookieHeader, STATE_COOKIE)
    const returned = query.get('state')
    if (
      sent === undefined ||
      returned === null ||
      !timingSafeEqual(sha256(sent).digest(), sha256(returned).digest())
    ) {
      return json(400, { error: 'This login did not start in this browser' }, [
        forgetState,
      ])
    }
    const code = query.get('code')
    if (!code) {
      return { kind: 'Redirect', location: '/', cookies: [forgetState] }
    }
    const member = await signIn(app, code)
    if (!member) {
      return json(502, { error: 'Discord login failed. Try again.' }, [
        forgetState,
      ])
    }
    const previous = sessionHash(cookieHeader)
    if (previous !== undefined) sessions.end(previous)
    const id = newSecret()
    sessions.start(
      sha256(id).digest('hex'),
      member,
      new Date(now().getTime() + SESSION_SECONDS * 1000),
    )
    return {
      kind: 'Redirect',
      location: '/',
      cookies: [sessionCookie(id, SESSION_SECONDS), forgetState],
    }
  }

  const logout = (request: AuthRequest): AuthReply => {
    if (viewer(request).kind === 'CrossSite') {
      return failure(403, 'This request came from another site')
    }
    const hash = sessionHash(request.cookie)
    if (hash !== undefined) sessions.end(hash)
    return json(200, {}, [sessionCookie('', 0)])
  }

  const handle = async (request: AuthRequest): Promise<AuthReply> => {
    if (!discord) {
      return failure(503, 'Discord login is unavailable right now')
    }
    if (request.method !== AUTH_ROUTES[request.route]) {
      return failure(405, 'Method Not Allowed')
    }
    switch (request.route) {
      case 'discord/start':
        return allowLogin(request.ip) ? start(discord) : tooManyLogins
      case 'discord/callback':
        return allowLogin(request.ip)
          ? callback(discord, request)
          : tooManyLogins
      case 'me': {
        const member = account(request.cookie)
        return member ? json(200, member) : failure(401, 'Not connected')
      }
      case 'logout':
        return logout(request)
    }
  }

  return {
    viewer,
    handle: async (request: AuthRequest): Promise<AuthReply> => {
      try {
        return await handle(request)
      } catch (error) {
        console.error('Discord login error:', error)
        return failure(500, 'Could not read or save the login')
      }
    },
  }
}
