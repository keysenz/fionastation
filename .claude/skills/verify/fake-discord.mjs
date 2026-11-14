import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.FAKE_DISCORD_PORT)
const clientId = process.env.DISCORD_CLIENT_ID
const clientSecret = process.env.DISCORD_CLIENT_SECRET
if (!port || !clientId || !clientSecret) {
  console.error(
    'set FAKE_DISCORD_PORT, DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET',
  )
  process.exit(1)
}

let nextUser = {
  id: '100000000000000001',
  username: 'fakefan',
  global_name: 'Fake Fan',
}
let refusing = false
const codes = new Map()
const tokens = new Map()

const bodyOf = async req => {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const routes = {
  'GET /fake/as': (req, res, query) => {
    const id = query.get('id')
    const name = query.get('name')
    if (!id || !name) {
      return json(res, 400, { error: 'pass id and name' })
    }
    nextUser = {
      id,
      username: name.toLowerCase().replaceAll(' ', ''),
      global_name: name,
    }
    json(res, 200, nextUser)
  },
  'GET /fake/refuse': (req, res, query) => {
    refusing = query.get('on') === '1'
    json(res, 200, { refusing })
  },
  'GET /oauth2/authorize': (req, res, query) => {
    const redirectUri = query.get('redirect_uri')
    if (
      query.get('client_id') !== clientId ||
      query.get('scope') !== 'identify' ||
      !redirectUri
    ) {
      return json(res, 400, { error: 'invalid_request' })
    }
    const code = randomBytes(12).toString('hex')
    codes.set(code, { user: nextUser, redirectUri })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', query.get('state') ?? '')
    res.writeHead(302, { location: back.href })
    res.end()
  },
  'POST /oauth2/token': async (req, res) => {
    const form = await bodyOf(req)
    if (refusing) {
      return json(res, 400, { error: 'invalid_grant' })
    }
    const grant = codes.get(form.get('code'))
    codes.delete(form.get('code'))
    if (
      form.get('client_id') !== clientId ||
      form.get('client_secret') !== clientSecret
    ) {
      return json(res, 401, { error: 'invalid_client' })
    }
    if (
      !grant ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('redirect_uri') !== grant.redirectUri
    ) {
      return json(res, 400, { error: 'invalid_grant' })
    }
    const accessToken = randomBytes(12).toString('hex')
    tokens.set(accessToken, grant.user)
    json(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 604800,
      scope: 'identify',
    })
  },
  'GET /users/@me': (req, res) => {
    const user = tokens.get(
      /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1],
    )
    return user
      ? json(res, 200, user)
      : json(res, 401, { message: '401: Unauthorized' })
  },
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fake-discord')
  const route = routes[`${req.method} ${url.pathname}`]
  if (!route) {
    return json(res, 404, { message: '404: Not Found' })
  }
  Promise.resolve(route(req, res, url.searchParams)).catch(error => {
    console.error(error)
    json(res, 500, { message: 'fake discord failed' })
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`fake discord on http://127.0.0.1:${port}`)
})
