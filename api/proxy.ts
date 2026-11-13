// NOTE: vercel.json rewrites /api/:path* here. The upstream origin and secret live in Vercel's
// environment settings so the devbox hostname stays out of this public repo.
const API_PATH = /^[\w-]+(\/[\w-]+)*$/

const DROPPED_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
]

export async function GET(request: Request): Promise<Response> {
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

  const upstream = await fetch(`${origin}/api/${path}${url.search}`, {
    headers: { 'x-proxy-secret': secret },
  })
  const headers = new Headers(upstream.headers)
  for (const name of DROPPED_HEADERS) {
    headers.delete(name)
  }
  // NOTE: the hop to devbox takes 1-3 s, so Vercel's CDN answers from cache and refreshes in the background; browsers still revalidate every load.
  if (upstream.ok) {
    headers.set(
      'Vercel-CDN-Cache-Control',
      'max-age=60, stale-while-revalidate=86400',
    )
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
