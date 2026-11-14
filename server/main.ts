import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  findSongForLyrics,
  findSongsForPlaylist,
  listKaraokeVideos,
  listSongIds,
} from './db.ts'
import {
  loadAlignments,
  loadOverrides,
  lookupLyrics,
  warnAboutUnknownSongs,
} from './lyrics.ts'
import {
  MAX_BODY_BYTES,
  createPlaylistApi,
  openPlaylistStore,
} from './playlists.ts'
import { loadSongbook } from './songbook.ts'
import { isGone, startRefreshing } from './videoStatus.ts'

const ROOT = resolve(import.meta.dirname, '../dist')
const PORT = Number(process.env.PORT ?? 3000)

// NOTE: unset in local dev. In production compose requires it, and only the Vercel proxy knows it.
const PROXY_SECRET = process.env.PROXY_SECRET
  ? Buffer.from(process.env.PROXY_SECRET)
  : undefined

const hasProxySecret = (req: IncomingMessage) => {
  if (!PROXY_SECRET) {
    return true
  }
  const sent = req.headers['x-proxy-secret']
  if (typeof sent !== 'string') {
    return false
  }
  const sentBytes = Buffer.from(sent)
  return (
    sentBytes.length === PROXY_SECRET.length &&
    timingSafeEqual(sentBytes, PROXY_SECRET)
  )
}

const visitorIp = (req: IncomingMessage) => {
  const socketIp = req.socket.remoteAddress ?? 'unknown'
  const forwarded = req.headers['x-forwarded-for']
  if (!PROXY_SECRET || !hasProxySecret(req) || typeof forwarded !== 'string') {
    return socketIp
  }
  return forwarded.split(',')[0]?.trim() || socketIp
}

const readBody = (req: IncomingMessage) =>
  new Promise<string | undefined>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data')
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const createsPerIpPerHour =
  Number(process.env.PLAYLISTS_IP_LIMIT_PER_HOUR) || 10

const playlistApi = (() => {
  const path = process.env.PLAYLISTS_DB_PATH
  if (!path) {
    console.warn('PLAYLISTS_DB_PATH is not set, so playlists are unavailable')
    return undefined
  }
  try {
    return createPlaylistApi({
      store: openPlaylistStore({ path }),
      findSongs: findSongsForPlaylist,
      createsPerIpPerHour,
    })
  } catch (error) {
    console.error('Could not open the playlists database:', error)
    return undefined
  }
})()

const PLAYLIST_ROUTE = /^\/api\/playlists(?:\/([^/]+))?$/

// NOTE: keep in step with src/route.ts. Any other path gets the 404 status with the app's own 404 page.
const PAGE_PATHS = new Set(['/', '/songs'])

const MOVED_PAGE_PATHS = new Set([
  '/radio',
  '/karaoke',
  '/cover',
  '/about',
  '/credits',
])

type ApiReply = Readonly<{
  status: number
  body: unknown
  cacheControl: string
}>

const NO_CACHE = 'no-cache'
const LYRICS_CACHE = 'public, max-age=3600, s-maxage=3600'

const lyricsOverrides = loadOverrides(
  join(import.meta.dirname, 'lyrics-overrides.json'),
)
const lyricsAlignments = loadAlignments(
  join(import.meta.dirname, 'lyrics-aligned.json'),
)

const lyricsRoute = async (songId: string | null): Promise<ApiReply> => {
  if (!songId) {
    return {
      status: 400,
      body: { error: 'Missing song' },
      cacheControl: NO_CACHE,
    }
  }
  const song = findSongForLyrics(songId)
  if (!song) {
    return {
      status: 404,
      body: { error: 'Unknown song' },
      cacheControl: NO_CACHE,
    }
  }
  const lookup = await lookupLyrics(song, lyricsOverrides, lyricsAlignments)
  return lookup.kind === 'Answered'
    ? { status: 200, body: lookup.lyrics, cacheControl: LYRICS_CACHE }
    : {
        status: 503,
        body: { error: 'Lyrics are unavailable right now' },
        cacheControl: 'no-store',
      }
}

const API_ROUTES: Record<
  string,
  (query: URLSearchParams) => ApiReply | Promise<ApiReply>
> = {
  '/api/get-karaoke': () => ({
    status: 200,
    body: listKaraokeVideos().map(video => ({
      ...video,
      is_gone: isGone(video.video_url),
    })),
    cacheControl: NO_CACHE,
  }),
  '/api/get-lyrics': query => lyricsRoute(query.get('song')),
  '/api/get-songbook': async () => {
    const lookup = await loadSongbook()
    return lookup.kind === 'Answered'
      ? {
          status: 200,
          body: lookup.songbook,
          cacheControl: 'public, max-age=300, s-maxage=300',
        }
      : {
          status: 503,
          body: { error: 'The song list is unavailable right now' },
          cacheControl: 'no-store',
        }
  },
}

const SECURITY_HEADERS = {
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-XSS-Protection': '1; mode=block',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'origin-when-cross-origin',
}

const HTML = 'text/html; charset=utf-8'
const JSON_TYPE = 'application/json; charset=utf-8'
const TEXT = 'text/plain; charset=utf-8'

const FILE_TYPES: Record<string, string> = {
  '.html': HTML,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': JSON_TYPE,
  '.txt': TEXT,
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

const isText = (contentType: string) => contentType.includes('charset=utf-8')

const parsePath = (rawUrl: string) => {
  try {
    const { pathname } = new URL(rawUrl, 'http://localhost')
    return { pathname, decoded: decodeURIComponent(pathname) }
  } catch {
    return undefined
  }
}

const readRange = (header: string | undefined, size: number) => {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (match[1] === '' && match[2] === '')) {
    return undefined
  }
  const start =
    match[1] === '' ? Math.max(size - Number(match[2]), 0) : Number(match[1])
  const end =
    match[1] === '' || match[2] === ''
      ? size - 1
      : Math.min(Number(match[2]), size - 1)
  return start <= end ? { start, end } : undefined
}

const handle = async (req: IncomingMessage, res: ServerResponse) => {
  const reply = (
    status: number,
    contentType: string,
    body: Buffer,
    cacheControl = 'no-cache',
  ) => {
    const gzip =
      isText(contentType) &&
      (req.headers['accept-encoding'] ?? '').includes('gzip')
    const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ETag: etag,
      Vary: 'Accept-Encoding',
      ...(isText(contentType) ? {} : { 'Accept-Ranges': 'bytes' }),
    }
    if (status === 200 && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    const range =
      status === 200 && !isText(contentType)
        ? readRange(req.headers.range, body.length)
        : undefined
    if (range) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${body.length}`,
      })
      res.end(body.subarray(range.start, range.end + 1))
      return
    }
    res.writeHead(status, {
      ...headers,
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    })
    res.end(gzip ? gzipSync(body) : body)
  }

  const replyJson = (status: number, value: unknown, cacheControl?: string) =>
    reply(status, JSON_TYPE, Buffer.from(JSON.stringify(value)), cacheControl)

  const replyShell = async (status: number) =>
    reply(status, HTML, await readFile(join(ROOT, 'index.html')))

  const path = parsePath(req.url ?? '/')
  if (!path) {
    return replyShell(404)
  }
  const { pathname, decoded } = path

  if (pathname.length > 1 && pathname.endsWith('/')) {
    // NOTE: the leading slashes collapse because `//host` in a Location header would redirect off this site.
    const target = `/${pathname.slice(0, -1).replace(/^\/+/, '')}`
    res.writeHead(308, { ...SECURITY_HEADERS, Location: target })
    res.end()
    return
  }

  if (
    MOVED_PAGE_PATHS.has(pathname) &&
    (req.method === 'GET' || req.method === 'HEAD')
  ) {
    const { search } = new URL(req.url ?? '/', 'http://localhost')
    res.writeHead(301, { ...SECURITY_HEADERS, Location: `/${search}` })
    res.end()
    return
  }

  const playlistRoute = PLAYLIST_ROUTE.exec(pathname)
  if (playlistRoute) {
    if (!hasProxySecret(req)) {
      return replyJson(403, { error: 'Forbidden' })
    }
    if (!playlistApi) {
      return replyJson(
        503,
        { error: 'Playlists are unavailable right now' },
        'no-store',
      )
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    const body = declared > MAX_BODY_BYTES ? undefined : await readBody(req)
    if (body === undefined) {
      res.once('finish', () => req.destroy())
      res.setHeader('Connection', 'close')
      return replyJson(413, { error: 'The request is too large' }, 'no-store')
    }
    const { status, body: payload } = playlistApi({
      method: req.method ?? 'GET',
      id: playlistRoute[1],
      ip: visitorIp(req),
      authorization: req.headers.authorization,
      body,
    })
    return replyJson(status, payload, 'no-store')
  }

  const apiRoute = API_ROUTES[pathname]
  if (apiRoute) {
    if (!hasProxySecret(req)) {
      return replyJson(403, { error: 'Forbidden' })
    }
    if (req.method !== 'GET') {
      return replyJson(405, { error: 'Method Not Allowed' })
    }
    try {
      const { status, body, cacheControl } = await apiRoute(
        new URL(req.url ?? '/', 'http://localhost').searchParams,
      )
      return replyJson(status, body, cacheControl)
    } catch (error) {
      console.error(`Error serving ${pathname}:`, error)
      return replyJson(500, { error: 'Could not read data' })
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return reply(405, TEXT, Buffer.from('Method Not Allowed'))
  }

  if (PAGE_PATHS.has(pathname)) {
    return replyShell(200)
  }

  const filePath = resolve(join(ROOT, decoded))
  const contentType = FILE_TYPES[extname(filePath)]
  if (filePath.startsWith(ROOT + sep) && contentType) {
    const body = await readFile(filePath).catch(() => undefined)
    if (body) {
      return reply(
        200,
        contentType,
        body,
        pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      )
    }
  }

  return replyShell(404)
}

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(`Error serving ${req.url}:`, error)
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': TEXT })
    res.end('Internal Server Error')
  })
})

server.listen(PORT, process.env.HOSTNAME ?? '0.0.0.0', () => {
  console.log(`listening on ${PORT}`)
})

startRefreshing(() => listKaraokeVideos().map(video => video.video_url))

try {
  warnAboutUnknownSongs(lyricsOverrides, listSongIds())
} catch (error) {
  console.warn('Could not check lyrics overrides against the database:', error)
}

// NOTE: Node runs as PID 1 in the container, where a signal with no handler is ignored.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => process.exit(0))
}
