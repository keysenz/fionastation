import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

import { listCovers, listKaraokeVideos } from './db.ts'
import { isGone, startRefreshing } from './videoStatus.ts'

const ROOT = resolve(import.meta.dirname, '../dist')
const PORT = Number(process.env.PORT ?? 3000)

// NOTE: keep in step with src/route.ts. Any other path gets the 404 status with the app's own 404 page.
const PAGE_PATHS = new Set(['/', '/about', '/karaoke', '/cover', '/credits'])

const API_ROUTES: Record<string, () => unknown> = {
  '/api/get-karaoke': () =>
    listKaraokeVideos().map(video => ({
      ...video,
      is_gone: isGone(video.video_url),
    })),
  '/api/get-cover': listCovers,
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

  const replyJson = (status: number, value: unknown) =>
    reply(status, JSON_TYPE, Buffer.from(JSON.stringify(value)))

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

  const apiRoute = API_ROUTES[pathname]
  if (apiRoute) {
    if (req.method !== 'GET') {
      return replyJson(405, { error: 'Method Not Allowed' })
    }
    try {
      return replyJson(200, apiRoute())
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

// NOTE: Node runs as PID 1 in the container, where a signal with no handler is ignored.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => process.exit(0))
}
