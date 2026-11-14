// NOTE: vercel.json rewrites /api/:path* here. The upstream origin and secret live in Vercel's
// environment settings so the devbox hostname stays out of this public repo.
const API_PATH = /^[\w-]+(\/[\w-]+)*$/

const FORWARDED_HEADERS = ['content-type', 'authorization', 'cookie', 'origin']

const DROPPED_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
]

const UNCACHED_PATH = /^(playlists|auth|stats-page)(\/|$)/

const visitorIp = (request: Request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined

async function forward(request: Request): Promise<Response> {
  const origin = process.env.API_ORIGIN
  const secret = process.env.PROXY_SECRET
  if (!origin || !secret) {
    console.error('API_ORIGIN and PROXY_SECRET must be set')
    return Response.json({ error: 'Proxy not configured' }, { status: 500 })
  }

  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  if (!API_PATH.test(path)) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }
  url.searchParams.delete('path')

  const headers: Record<string, string> = { 'x-proxy-secret': secret }
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value) {
      headers[name] = value
    }
  }
  const ip = visitorIp(request)
  if (ip) {
    headers['x-forwarded-for'] = ip
  }

  const hasBody = request.method !== 'GET' && request.method !== 'DELETE'
  const upstream = await fetch(`${origin}/api/${path}${url.search}`, {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(hasBody && { body: await request.arrayBuffer() }),
  })
  const responseHeaders = new Headers(upstream.headers)
  for (const name of DROPPED_HEADERS) {
    responseHeaders.delete(name)
  }
  if (request.method === 'GET' && upstream.ok && !UNCACHED_PATH.test(path)) {
    responseHeaders.set(
      'Vercel-CDN-Cache-Control',
      'max-age=60, stale-while-revalidate=86400',
    )
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const DELETE = forward
