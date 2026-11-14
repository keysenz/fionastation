// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE, GET, POST, PUT } from './proxy'

const CDN = 'Vercel-CDN-Cache-Control'

type Sent = Readonly<{ url: string; init: RequestInit }>

const stubUpstream = (response: () => Response) => {
  const sent: Array<Sent> = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return response()
  })
  return sent
}

const ok = () => Response.json({ ok: true })

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', 'http://upstream.test')
  vi.stubEnv('PROXY_SECRET', 's3cret')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('statistics', () => {
  it('forwards a stat post and passes the empty 204 back', async () => {
    const sent = stubUpstream(() => new Response(null, { status: 204 }))
    const response = await POST(
      new Request('https://site.test/api/proxy?path=stats', {
        method: 'POST',
        body: '{"songId":"a","kind":"Play","origin":"Visitor"}',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(sent[0]?.url).toBe('http://upstream.test/api/stats')
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })
})

describe('writes', () => {
  it('forwards method, body, content-type, authorization and the visitor IP', async () => {
    const sent = stubUpstream(ok)
    await PUT(
      new Request('https://site.test/api/proxy?path=playlists/abc12345', {
        method: 'PUT',
        body: '{"name":"x"}',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer tok',
          'x-forwarded-for': '203.0.113.9',
        },
      }),
    )
    const [call] = sent
    const headers = new Headers(call?.init.headers)
    expect(call?.url).toBe('http://upstream.test/api/playlists/abc12345')
    expect(call?.init.method).toBe('PUT')
    expect(new TextDecoder().decode(call?.init.body as ArrayBuffer)).toBe(
      '{"name":"x"}',
    )
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBe('Bearer tok')
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9')
    expect(headers.get('x-proxy-secret')).toBe('s3cret')
  })

  it('forwards only the first address, so a chain cannot choose the limited IP', async () => {
    const sent = stubUpstream(ok)
    await POST(
      new Request('https://site.test/api/proxy?path=playlists', {
        method: 'POST',
        body: '{}',
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      }),
    )
    expect(new Headers(sent[0]?.init.headers).get('x-forwarded-for')).toBe(
      '203.0.113.9',
    )
  })

  it('sends no x-forwarded-for when the request has none', async () => {
    const sent = stubUpstream(ok)
    await POST(
      new Request('https://site.test/api/proxy?path=playlists', {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(new Headers(sent[0]?.init.headers).has('x-forwarded-for')).toBe(
      false,
    )
  })

  it('forwards DELETE without a body', async () => {
    const sent = stubUpstream(ok)
    await DELETE(
      new Request('https://site.test/api/proxy?path=playlists/abc12345', {
        method: 'DELETE',
        headers: { authorization: 'Bearer tok' },
      }),
    )
    expect(sent[0]?.init.method).toBe('DELETE')
    expect(sent[0]?.init.body).toBeUndefined()
  })

  it('passes the upstream status through and never adds a CDN cache header', async () => {
    stubUpstream(() => Response.json({ id: 'a' }, { status: 201 }))
    const response = await POST(
      new Request('https://site.test/api/proxy?path=playlists', {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(response.status).toBe(201)
    expect(response.headers.has(CDN)).toBe(false)
  })
})

describe('reads', () => {
  const read = (path: string) =>
    GET(new Request(`https://site.test/api/proxy?path=${path}`))

  it('gives no CDN cache header to a playlist read', async () => {
    stubUpstream(ok)
    expect((await read('playlists/abc12345')).headers.has(CDN)).toBe(false)
  })

  it('keeps the CDN cache header on a songs read', async () => {
    stubUpstream(ok)
    expect((await read('get-karaoke')).headers.get(CDN)).toBe(
      'max-age=60, stale-while-revalidate=86400',
    )
  })

  it('does not treat a path that only starts with the word as a playlist path', async () => {
    stubUpstream(ok)
    expect((await read('playlists-archive')).headers.has(CDN)).toBe(true)
  })

  it('sends the secret and no forwarded address when the request has none', async () => {
    const sent = stubUpstream(ok)
    await read('get-karaoke')
    const headers = new Headers(sent[0]?.init.headers)
    expect(headers.get('x-proxy-secret')).toBe('s3cret')
    expect(headers.has('x-forwarded-for')).toBe(false)
  })
})

describe('login', () => {
  it('forwards the cookie and the origin upstream', async () => {
    const sent = stubUpstream(ok)
    await POST(
      new Request('https://site.test/api/proxy?path=auth/logout', {
        method: 'POST',
        headers: {
          cookie: 'fs_session=abc; other=1',
          origin: 'https://site.test',
        },
      }),
    )
    const headers = new Headers(sent[0]?.init.headers)
    expect(headers.get('cookie')).toBe('fs_session=abc; other=1')
    expect(headers.get('origin')).toBe('https://site.test')
  })

  it('hands a redirect back to the browser with its location and every cookie', async () => {
    const sent = stubUpstream(() => {
      const headers = new Headers({
        location: 'https://discord.test/authorize',
      })
      headers.append('set-cookie', 'fs_session=abc; Path=/; HttpOnly')
      headers.append('set-cookie', 'fs_oauth_state=; Path=/api/auth; Max-Age=0')
      return new Response(null, { status: 302, headers })
    })
    const response = await GET(
      new Request(
        'https://site.test/api/proxy?path=auth/discord/callback&code=c1&state=s1',
      ),
    )
    expect(sent[0]?.url).toBe(
      'http://upstream.test/api/auth/discord/callback?code=c1&state=s1',
    )
    expect(sent[0]?.init.redirect).toBe('manual')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://discord.test/authorize',
    )
    expect(response.headers.getSetCookie()).toEqual([
      'fs_session=abc; Path=/; HttpOnly',
      'fs_oauth_state=; Path=/api/auth; Max-Age=0',
    ])
  })

  it('never gives an auth read the CDN cache header', async () => {
    stubUpstream(ok)
    const response = await GET(
      new Request('https://site.test/api/proxy?path=auth/me'),
    )
    expect(response.headers.has(CDN)).toBe(false)
  })
})

describe('guards', () => {
  it('answers 500 when the proxy is not configured', async () => {
    vi.stubEnv('PROXY_SECRET', '')
    const response = await POST(
      new Request('https://site.test/api/proxy?path=playlists', {
        method: 'POST',
      }),
    )
    expect(response.status).toBe(500)
  })

  it('answers 404 for a path that is not an api path', async () => {
    const response = await POST(
      new Request('https://site.test/api/proxy?path=../x', { method: 'POST' }),
    )
    expect(response.status).toBe(404)
  })
})
