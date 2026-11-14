import { createServer } from 'node:http'

const port = Number(process.env.HARNESS_PORT)
if (!port || !process.env.API_ORIGIN || !process.env.PROXY_SECRET) {
  console.error('set HARNESS_PORT, API_ORIGIN and PROXY_SECRET')
  process.exit(1)
}

const handlers = await import(
  new URL('../../../api/proxy.ts', import.meta.url).href
)

const chunksOf = async req => {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const server = createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://harness')
  const rewritten = /^\/api\/(.+)$/.exec(incoming.pathname)
  const handler = handlers[req.method]
  if (!rewritten && req.method === 'GET') {
    const page = await fetch(new URL(req.url, process.env.API_ORIGIN))
    res.writeHead(page.status, {
      'content-type': page.headers.get('content-type') ?? 'text/plain',
    })
    res.end(Buffer.from(await page.arrayBuffer()))
    return
  }
  if (!rewritten || !handler) {
    res.writeHead(rewritten ? 405 : 404).end()
    return
  }
  const url = new URL('/api/proxy', incoming)
  url.search = incoming.search
  url.searchParams.set('path', rewritten[1])
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const response = await handler(
    new Request(url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? await chunksOf(req) : undefined,
    }),
  )
  const headers = Object.fromEntries(response.headers)
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) {
    headers['set-cookie'] = cookies
  }
  res.writeHead(response.status, headers)
  res.end(Buffer.from(await response.arrayBuffer()))
})

server.listen(port, '127.0.0.1', () => {
  console.log(
    `proxy harness on http://127.0.0.1:${port} -> ${process.env.API_ORIGIN}`,
  )
})
