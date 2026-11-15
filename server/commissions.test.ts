import { Schema } from 'effect'
// @vitest-environment node
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { REQUIRED_FIELDS } from '../src/page/commission/inquiryContract.ts'
import {
  type InquiryKind,
  InquiryReply,
} from '../src/page/commission/inquiryPayload.ts'
import {
  type CommissionStore,
  NEXT_STATUSES,
  type Status,
  createCommissionAdminApi,
  createCommissionApi,
  openCommissionStore,
  trackingToken,
} from './commissions.ts'
import { MAX_BODY_BYTES } from './playlists.ts'

const SECRET = 'commissions-test-secret'
const ADMIN = 'admin-test-secret'
const MANAGER = '111111111111111111'
const CHANNEL = '222222222222222222'
const MESSAGE = '333333333333333333'
const IP = '203.0.113.7'

const ID_A = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0001'
const ID_B = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0002'
const ID_C = '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0003'

const VOICE_FIELDS = {
  name: 'Mika',
  contact: 'mika#0001',
  usage: 'Commercial (exclusive)',
  length: 'Full',
  song_details: 'Homura, about 4:30',
  reference_link: '',
  deadline: '',
  notes: '',
  agreed: 'yes',
}

const STUDIO_FIELDS = {
  name: 'Mika',
  contact: 'mika#0001',
  song: 'Homura',
  service: 'Mix & Master',
  cover_length: 'Standard',
  tracks: '2',
  singers: 'Duet (2)',
  add_ons: 'Harmony guide',
  vocal_link: 'https://example.com/vocals',
  deadline: '4-7 days (regular)',
  extra_complexity: 'no',
  first_commission: 'yes',
  notes: 'None',
  agreed: 'yes',
}

const ENDORSE_FIELDS = {
  brand: 'Acme',
  contact: 'hi@acme.test',
  channels: 'YouTube, X',
  campaign_type: 'Brand ambassador',
  budget: "Let's discuss",
  details: 'A sponsored stream',
}

const FIELDS: Record<InquiryKind, Record<string, string>> = {
  voice: VOICE_FIELDS,
  studio: STUDIO_FIELDS,
  endorse: ENDORSE_FIELDS,
}

const inquiry = (
  overrides: Partial<{
    id: string
    kind: InquiryKind
    fields: Record<string, string>
    quote: unknown
  }> = {},
) => ({
  id: ID_A,
  kind: 'voice' as InquiryKind,
  fields: VOICE_FIELDS,
  quote: null,
  ...overrides,
})

let dir: string
let dbPath: string
let clock: Date
const now = () => clock

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'commissions-test-'))
  dbPath = join(dir, 'commissions.db')
  clock = new Date('2026-11-14T10:00:00Z')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const setup = (createsPerIpPerHour = 5) => {
  const store = openCommissionStore({ path: dbPath, now })
  const api = createCommissionApi({
    store,
    secret: SECRET,
    now,
    createsPerIpPerHour,
  })
  const admin = createCommissionAdminApi({ store, secret: ADMIN })
  const submit = (body: unknown, ip = IP) =>
    api.submit({
      method: 'POST',
      ip,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const track = (id: string, token: string | undefined) =>
    api.track({ method: 'GET', id, token })
  const call = (
    method: string,
    pathname: string,
    body: unknown = '',
    headers: {
      authorization?: string | undefined
      acting?: string | undefined
    } = {},
  ) =>
    admin({
      method,
      pathname,
      authorization:
        'authorization' in headers ? headers.authorization : `Bearer ${ADMIN}`,
      actingDiscordId: 'acting' in headers ? headers.acting : MANAGER,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const move = (id: string, status: string, note?: string) =>
    call('POST', `/admin/commissions/${id}/events`, { status, note })
  return { store, api, admin, submit, track, call, move }
}

const PATH_TO: Record<Status, readonly Status[]> = {
  received: [],
  quoted: ['quoted'],
  deposit_paid: ['quoted', 'deposit_paid'],
  in_progress: ['quoted', 'deposit_paid', 'in_progress'],
  preview: ['quoted', 'deposit_paid', 'in_progress', 'preview'],
  draft: ['quoted', 'deposit_paid', 'in_progress', 'preview', 'draft'],
  revision: [
    'quoted',
    'deposit_paid',
    'in_progress',
    'preview',
    'draft',
    'revision',
  ],
  final: ['quoted', 'deposit_paid', 'in_progress', 'preview', 'draft', 'final'],
  declined: ['declined'],
}

const STATUSES = Object.keys(NEXT_STATUSES) as Status[]

describe('store', () => {
  const newCommission = (id = ID_A) => ({
    id,
    kind: 'voice' as const,
    payload: JSON.stringify({
      id,
      kind: 'voice',
      fields: VOICE_FIELDS,
      quote: null,
    }),
    quote: null,
    ipHash: 'hash',
  })

  test('create writes a received event and read gives it back', () => {
    const { store } = setup()
    expect(store.create(newCommission())).toBe('Created')
    const found = store.read(ID_A)
    expect(found?.commission).toEqual({
      id: ID_A,
      kind: 'voice',
      createdAt: '2026-11-14T10:00:00.000Z',
      status: 'received',
      next: ['quoted', 'declined'],
      fields: VOICE_FIELDS,
      quote: null,
    })
    expect(found?.events).toEqual([
      { status: 'received', note: null, at: '2026-11-14T10:00:00.000Z' },
    ])
  })

  test('creating the same id again changes nothing', () => {
    const { store } = setup()
    store.create(newCommission())
    clock = new Date('2026-11-14T11:00:00Z')
    expect(store.create(newCommission())).toBe('Exists')
    expect(store.read(ID_A)?.events).toHaveLength(1)
    expect(store.read(ID_A)?.commission.createdAt).toBe(
      '2026-11-14T10:00:00.000Z',
    )
  })

  test('an unknown id reads as nothing', () => {
    const { store } = setup()
    expect(store.read(ID_A)).toBeUndefined()
    expect(store.find(ID_A)).toBeUndefined()
  })

  test('unposted lists oldest first and drops a posted commission', () => {
    const { store } = setup()
    store.create(newCommission(ID_B))
    clock = new Date('2026-11-14T10:05:00Z')
    store.create(newCommission(ID_A))
    clock = new Date('2026-11-14T10:00:00Z')
    store.create(newCommission(ID_C))
    expect(store.listUnposted().map(({ id }) => id)).toEqual([ID_B, ID_C, ID_A])
    store.markPosted(ID_B, CHANNEL, MESSAGE)
    expect(store.listUnposted().map(({ id }) => id)).toEqual([ID_C, ID_A])
  })

  test('markPosted is idempotent for a pair and conflicts on another', () => {
    const { store } = setup()
    store.create(newCommission())
    expect(store.markPosted(ID_A, CHANNEL, MESSAGE).kind).toBe('Posted')
    expect(store.markPosted(ID_A, CHANNEL, MESSAGE).kind).toBe('Posted')
    expect(store.markPosted(ID_A, CHANNEL, '444444444444444444').kind).toBe(
      'Conflict',
    )
    expect(store.read(ID_A)?.commission).toMatchObject({
      channelId: CHANNEL,
      messageId: MESSAGE,
    })
    expect(store.markPosted(ID_B, CHANNEL, MESSAGE).kind).toBe('Unknown')
  })

  test('the current status is the latest event and survives a reopen', () => {
    const { store } = setup()
    store.create(newCommission())
    store.addEvent(ID_A, 'quoted', 'Rp300.000', MANAGER)
    const reopened = openCommissionStore({ path: dbPath, now })
    expect(reopened.read(ID_A)?.commission.status).toBe('quoted')
    expect(reopened.read(ID_A)?.events.map(({ status }) => status)).toEqual([
      'received',
      'quoted',
    ])
  })
})

describe('status machine', () => {
  const reach = (store: CommissionStore, status: Status) => {
    store.create({
      id: ID_A,
      kind: 'voice',
      payload: '{}',
      quote: null,
      ipHash: 'hash',
    })
    for (const step of PATH_TO[status]) {
      expect(store.addEvent(ID_A, step, null, MANAGER).kind).toBe('Recorded')
    }
  }

  const pairs = STATUSES.flatMap(from =>
    STATUSES.map(to => [from, to] as const),
  )

  test.each(pairs)('%s then %s', (from, to) => {
    const { store } = setup()
    reach(store, from)
    const before = store.read(ID_A)?.events.length ?? 0
    const result = store.addEvent(ID_A, to, null, MANAGER)
    const allowed = (NEXT_STATUSES[from] as readonly Status[]).includes(to)
    if (from === to) {
      expect(result.kind).toBe('Repeated')
      expect(store.read(ID_A)?.events).toHaveLength(before)
    } else if (allowed) {
      expect(result.kind).toBe('Recorded')
      expect(store.read(ID_A)?.commission.status).toBe(to)
      expect(store.read(ID_A)?.events).toHaveLength(before + 1)
    } else {
      expect(result).toEqual({ kind: 'Forbidden', from })
      expect(store.read(ID_A)?.commission.status).toBe(from)
      expect(store.read(ID_A)?.events).toHaveLength(before)
    }
  })

  test('the table is the one from the plan', () => {
    expect(NEXT_STATUSES).toEqual({
      received: ['quoted', 'declined'],
      quoted: ['deposit_paid', 'declined'],
      deposit_paid: ['in_progress'],
      in_progress: ['preview'],
      preview: ['draft'],
      draft: ['revision', 'final'],
      revision: ['draft', 'final'],
      final: [],
      declined: [],
    })
  })

  test('an event for an unknown commission is unknown', () => {
    const { store } = setup()
    expect(store.addEvent(ID_A, 'quoted', null, MANAGER)).toEqual({
      kind: 'Unknown',
    })
  })

  test('the actor and note are kept on the event row', () => {
    const { store } = setup()
    reach(store, 'received')
    store.addEvent(ID_A, 'quoted', 'Rp300.000', MANAGER)
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    expect(
      raw
        .prepare(
          "SELECT note, actor_discord_id FROM commission_event WHERE status = 'quoted'",
        )
        .get(),
    ).toMatchObject({ note: 'Rp300.000', actor_discord_id: MANAGER })
  })
})

describe('POST /api/inquiry', () => {
  test('a new inquiry answers 201 with its tracking link', () => {
    const { submit } = setup()
    const answer = submit(inquiry())
    expect(answer.status).toBe(201)
    const token = createHmac('sha256', SECRET).update(ID_A).digest('base64url')
    expect(answer.body).toEqual({
      id: ID_A,
      trackingUrl: `/commission/${ID_A}?t=${token}`,
    })
    expect(trackingToken(SECRET, ID_A)).toBe(token)
    expect(() =>
      Schema.decodeUnknownSync(InquiryReply)(answer.body),
    ).not.toThrow()
  })

  test('the same id with the same payload answers 200 with the same reply', () => {
    const { submit, store } = setup()
    const first = submit(inquiry())
    const second = submit(inquiry())
    expect(second).toEqual({ status: 200, body: first.body })
    expect(store.read(ID_A)?.events).toHaveLength(1)
  })

  test('the same payload with keys in another order still replays', () => {
    const { submit } = setup()
    submit(inquiry())
    const reordered = JSON.stringify({
      quote: null,
      fields: Object.fromEntries(Object.entries(VOICE_FIELDS).reverse()),
      kind: 'voice',
      id: ID_A,
    })
    expect(submit(reordered).status).toBe(200)
  })

  test('the same id with a different payload answers 409 and keeps the first', () => {
    const { submit, store } = setup()
    submit(inquiry())
    const other = submit(
      inquiry({ fields: { ...VOICE_FIELDS, name: 'Someone else' } }),
    )
    expect(other.status).toBe(409)
    expect(store.read(ID_A)?.commission.fields['name']).toBe('Mika')
    expect(
      submit(inquiry({ kind: 'endorse', fields: ENDORSE_FIELDS })).status,
    ).toBe(409)
  })

  test.each(['voice', 'studio', 'endorse'] as const)(
    'a valid %s inquiry is accepted',
    kind => {
      const { submit } = setup()
      expect(submit(inquiry({ kind, fields: FIELDS[kind] })).status).toBe(201)
    },
  )

  const requiredCases = (['voice', 'studio', 'endorse'] as const).flatMap(
    kind => REQUIRED_FIELDS[kind].map(key => [kind, key] as const),
  )

  test.each(requiredCases)('%s without %s is refused', (kind, key) => {
    const { submit, store } = setup()
    const missing = Object.fromEntries(
      Object.entries(FIELDS[kind]).filter(([name]) => name !== key),
    )
    const blank = { ...FIELDS[kind], [key]: '   ' }
    expect(submit(inquiry({ kind, fields: missing })).status).toBe(400)
    expect(submit(inquiry({ kind, fields: blank })).status).toBe(400)
    expect(store.read(ID_A)).toBeUndefined()
  })

  test('the id must be a UUID', () => {
    const { submit } = setup()
    for (const id of [
      '',
      'abc',
      ID_A.toUpperCase(),
      `${ID_A}0`,
      '../etc/passwd',
    ]) {
      expect(submit(inquiry({ id })).status).toBe(400)
    }
  })

  test('field count, key shape and value length are capped', () => {
    const { submit } = setup()
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`extra_${index}`, 'x']),
    )
    expect(
      submit(inquiry({ fields: { ...VOICE_FIELDS, ...many } })).status,
    ).toBe(400)
    expect(
      submit(inquiry({ fields: { ...VOICE_FIELDS, 'Bad Key': 'x' } })).status,
    ).toBe(400)
    expect(
      submit(inquiry({ fields: { ...VOICE_FIELDS, notes: 'x'.repeat(2001) } }))
        .status,
    ).toBe(400)
    expect(
      submit(inquiry({ fields: { ...VOICE_FIELDS, notes: 'x'.repeat(2000) } }))
        .status,
    ).toBe(201)
  })

  test('a body that is not the payload shape is refused', () => {
    const { submit } = setup()
    expect(submit('not json').status).toBe(400)
    expect(submit('[]').status).toBe(400)
    expect(submit({ id: ID_A }).status).toBe(400)
    expect(submit(inquiry({ kind: 'mystery' as InquiryKind })).status).toBe(400)
    expect(submit(inquiry({ fields: { name: 5 } as never })).status).toBe(400)
  })

  test('answers that are not a selection the form offers are refused', () => {
    const { submit } = setup()
    expect(
      submit(inquiry({ fields: { ...VOICE_FIELDS, usage: 'Free' } })).status,
    ).toBe(400)
    expect(
      submit(
        inquiry({
          kind: 'studio',
          fields: { ...STUDIO_FIELDS, tracks: '99' },
        }),
      ).status,
    ).toBe(400)
  })

  test('the stored quote is the server price, not the client snapshot', () => {
    const { submit, store } = setup()
    const forged = {
      _tag: 'Priced',
      lines: [{ label: 'Free', idr: 1, usd: 1 }],
      total: { idr: 1, usd: 1 },
      deposit: null,
    }
    expect(submit(inquiry({ quote: forged })).status).toBe(201)
    expect(store.read(ID_A)?.commission.quote).toEqual({
      _tag: 'Priced',
      lines: [
        { label: 'Commercial licence, full song', idr: 600000, usd: 120 },
      ],
      total: { idr: 600000, usd: 120 },
      deposit: null,
    })
    expect(submit(inquiry({ quote: forged })).status).toBe(200)
    expect(submit(inquiry({ quote: null })).status).toBe(409)
  })

  test('a long studio cover is priced by case', () => {
    const { submit, store } = setup()
    submit(
      inquiry({
        kind: 'studio',
        fields: {
          ...STUDIO_FIELDS,
          service: 'Full Production',
          cover_length: 'Long',
          first_commission: 'no',
        },
      }),
    )
    expect(store.read(ID_A)?.commission.quote).toMatchObject({ _tag: 'ByCase' })
  })

  test('a studio quote above the threshold carries its deposit', () => {
    const { submit, store } = setup()
    submit(
      inquiry({
        kind: 'studio',
        fields: {
          ...STUDIO_FIELDS,
          service: 'Full Production',
          add_ons: 'Main vocal guide, Complex adlibs',
          first_commission: 'no',
        },
      }),
    )
    expect(store.read(ID_A)?.commission.quote).toMatchObject({
      _tag: 'Priced',
      total: { idr: 700000 },
      deposit: { idr: 350000 },
    })
  })

  test('an endorsement stores no quote', () => {
    const { submit, store } = setup()
    submit(inquiry({ kind: 'endorse', fields: ENDORSE_FIELDS }))
    expect(store.read(ID_A)?.commission.quote).toBeNull()
  })

  test('the sixth new inquiry from one address in an hour answers 429', () => {
    const { submit } = setup()
    const ids = [ID_A, ID_B, ID_C, 'a', 'b', 'c'].map(
      (_, index) => `6f0e5d0a-5a43-4c52-9a56-2a8f0f6d000${index}`,
    )
    const statuses = ids.map(id => submit(inquiry({ id })).status)
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
    expect(submit(inquiry({ id: ids[0] ?? '' })).status).toBe(200)
    expect(submit(inquiry({ id: ID_B }), '198.51.100.9').status).toBe(201)
    clock = new Date('2026-11-14T11:00:01Z')
    expect(submit(inquiry({ id: ids[5] ?? '' }), IP).status).toBe(201)
  })

  test('a body over the cap answers 413', () => {
    const { submit } = setup()
    const padded = inquiry({
      fields: { ...VOICE_FIELDS, notes: 'x'.repeat(MAX_BODY_BYTES) },
    })
    expect(submit(padded).status).toBe(413)
  })

  test('only POST is allowed', () => {
    const { api } = setup()
    expect(api.submit({ method: 'GET', ip: IP, body: '' }).status).toBe(405)
  })

  test('the raw address is never stored, only a keyed hash', () => {
    const { submit } = setup()
    submit(inquiry())
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    const row = raw
      .prepare('SELECT * FROM commission WHERE id = ?')
      .get(ID_A) as { ip_hash: string }
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(IP)
    expect(row.ip_hash).toBe(
      createHmac('sha256', SECRET).update(`ip:${IP}`).digest('hex'),
    )
  })
})

describe('GET /api/commission/:id', () => {
  test('the right token shows the status timeline and no contact details', () => {
    const { submit, track, move } = setup()
    const { trackingUrl } = submit(inquiry()).body as { trackingUrl: string }
    const token = new URL(trackingUrl, 'http://x').searchParams.get('t') ?? ''
    clock = new Date('2026-11-14T12:00:00Z')
    move(ID_A, 'quoted', 'Rp600.000')
    const answer = track(ID_A, token)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      id: ID_A,
      kind: 'voice',
      createdAt: '2026-11-14T10:00:00.000Z',
      status: 'quoted',
      events: [
        { status: 'received', note: null, at: '2026-11-14T10:00:00.000Z' },
        { status: 'quoted', note: 'Rp600.000', at: '2026-11-14T12:00:00.000Z' },
      ],
    })
    const text = JSON.stringify(answer.body)
    expect(text).not.toContain('Mika')
    expect(text).not.toContain('mika#0001')
  })

  test('a bad token, a missing token and a missing id all answer the same 404', () => {
    const { submit, track } = setup()
    submit(inquiry())
    const good = trackingToken(SECRET, ID_A)
    const bad = track(
      ID_A,
      `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`,
    )
    const none = track(ID_A, undefined)
    const wrongSecret = track(ID_A, trackingToken('other', ID_A))
    const missing = track(ID_B, trackingToken(SECRET, ID_B))
    const malformed = track('nope', trackingToken(SECRET, 'nope'))
    for (const answer of [bad, none, wrongSecret, missing, malformed]) {
      expect(answer.status).toBe(404)
      expect(answer.body).toEqual(missing.body)
    }
  })

  test("one commission's token does not open another", () => {
    const { submit, track } = setup()
    submit(inquiry())
    submit(inquiry({ id: ID_B }))
    expect(track(ID_B, trackingToken(SECRET, ID_A)).status).toBe(404)
  })

  test('only GET is allowed', () => {
    const { api } = setup()
    expect(api.track({ method: 'POST', id: ID_A, token: 'x' }).status).toBe(405)
  })
})

describe('admin api', () => {
  const seed = (submit: ReturnType<typeof setup>['submit']) => {
    submit(inquiry({ id: ID_A }))
    clock = new Date('2026-11-14T10:01:00Z')
    submit(inquiry({ id: ID_B, kind: 'endorse', fields: ENDORSE_FIELDS }))
  }

  test('a wrong or missing secret answers 403 on every route', () => {
    const { call } = setup()
    for (const authorization of [
      undefined,
      'Bearer nope',
      ADMIN,
      'Basic abc',
    ]) {
      expect(
        call('GET', '/admin/commissions/unposted', '', { authorization })
          .status,
      ).toBe(403)
      expect(
        call(
          'POST',
          `/admin/commissions/${ID_A}/events`,
          { status: 'quoted' },
          {
            authorization,
          },
        ).status,
      ).toBe(403)
      expect(
        call('POST', `/admin/commissions/${ID_A}/posted`, {}, { authorization })
          .status,
      ).toBe(403)
    }
  })

  test('unposted lists full commissions oldest first', () => {
    const { submit, call } = setup()
    seed(submit)
    const answer = call('GET', '/admin/commissions/unposted')
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual([
      {
        id: ID_A,
        kind: 'voice',
        createdAt: '2026-11-14T10:00:00.000Z',
        status: 'received',
        next: ['quoted', 'declined'],
        fields: VOICE_FIELDS,
        quote: {
          _tag: 'Priced',
          lines: [
            { label: 'Commercial licence, full song', idr: 600000, usd: 120 },
          ],
          total: { idr: 600000, usd: 120 },
          deposit: null,
        },
      },
      {
        id: ID_B,
        kind: 'endorse',
        createdAt: '2026-11-14T10:01:00.000Z',
        status: 'received',
        next: ['quoted', 'declined'],
        fields: ENDORSE_FIELDS,
        quote: null,
      },
    ])
  })

  test('posted records the thread once and rejects a different one', () => {
    const { submit, call } = setup()
    seed(submit)
    const path = `/admin/commissions/${ID_A}/posted`
    const pair = { channelId: CHANNEL, messageId: MESSAGE }
    const first = call('POST', path, pair)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ id: ID_A, ...pair })
    expect(call('POST', path, pair)).toEqual(first)
    expect(
      call('POST', path, {
        channelId: CHANNEL,
        messageId: '444444444444444444',
      }).status,
    ).toBe(409)
    const listed = call('GET', '/admin/commissions/unposted').body as {
      id: string
    }[]
    expect(listed.map(({ id }) => id)).toEqual([ID_B])
  })

  test('posted refuses bad ids and unknown commissions', () => {
    const { call } = setup()
    const path = `/admin/commissions/${ID_A}/posted`
    expect(
      call('POST', path, { channelId: CHANNEL, messageId: MESSAGE }).status,
    ).toBe(404)
    expect(
      call('POST', path, { channelId: 'x', messageId: MESSAGE }).status,
    ).toBe(400)
    expect(call('POST', path, { channelId: CHANNEL }).status).toBe(400)
    expect(call('POST', path, 'nope').status).toBe(400)
  })

  test('events move a commission along the table and return it with next', () => {
    const { submit, move } = setup()
    seed(submit)
    const quoted = move(ID_A, 'quoted', 'Rp600.000')
    expect(quoted.status).toBe(200)
    expect(quoted.body).toMatchObject({
      id: ID_A,
      status: 'quoted',
      next: ['deposit_paid', 'declined'],
      fields: VOICE_FIELDS,
    })
    expect((quoted.body as { quote: unknown }).quote).toMatchObject({
      _tag: 'Priced',
    })
    expect(move(ID_A, 'deposit_paid').status).toBe(200)
    const progress = move(ID_A, 'in_progress')
    expect(progress.body).toMatchObject({
      status: 'in_progress',
      next: ['preview'],
    })
  })

  test('a forbidden transition answers 400 with an error and changes nothing', () => {
    const { submit, move, store } = setup()
    seed(submit)
    const answer = move(ID_A, 'final')
    expect(answer.status).toBe(400)
    expect(answer.body).toEqual({
      error: 'A commission that is received cannot become final',
    })
    expect(store.read(ID_A)?.events).toHaveLength(1)
    move(ID_A, 'declined')
    expect(move(ID_A, 'quoted').status).toBe(400)
  })

  test('repeating the current status answers 200 and adds no row', () => {
    const { submit, move, store } = setup()
    seed(submit)
    move(ID_A, 'quoted')
    const again = move(ID_A, 'quoted')
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ status: 'quoted' })
    expect(store.read(ID_A)?.events).toHaveLength(2)
  })

  test('an unknown or malformed id answers 404', () => {
    const { move, call } = setup()
    expect(move(ID_A, 'quoted').status).toBe(404)
    expect(
      call('POST', '/admin/commissions/not-a-uuid/events', { status: 'quoted' })
        .status,
    ).toBe(404)
  })

  test('events need an acting Discord id', () => {
    const { submit, call, store } = setup()
    seed(submit)
    const path = `/admin/commissions/${ID_A}/events`
    for (const acting of [undefined, '', 'abc', '12345']) {
      expect(call('POST', path, { status: 'quoted' }, { acting }).status).toBe(
        400,
      )
    }
    expect(store.read(ID_A)?.events).toHaveLength(1)
  })

  test('events refuse an unknown status or a bad note', () => {
    const { submit, call } = setup()
    seed(submit)
    const path = `/admin/commissions/${ID_A}/events`
    expect(call('POST', path, { status: 'paid' }).status).toBe(400)
    expect(call('POST', path, {}).status).toBe(400)
    expect(call('POST', path, { status: 'quoted', note: 5 }).status).toBe(400)
    expect(
      call('POST', path, { status: 'quoted', note: 'x'.repeat(1001) }).status,
    ).toBe(400)
    expect(call('POST', path, 'nope').status).toBe(400)
  })

  test('a blank note is stored as no note', () => {
    const { submit, move, store } = setup()
    seed(submit)
    move(ID_A, 'quoted', '   ')
    expect(store.read(ID_A)?.events[1]?.note).toBeNull()
  })

  test('unknown routes, wrong methods and big bodies', () => {
    const { call } = setup()
    expect(call('GET', '/admin/commissions').status).toBe(404)
    expect(call('GET', `/admin/commissions/${ID_A}/events`).status).toBe(405)
    expect(call('POST', '/admin/commissions/unposted').status).toBe(405)
    expect(call('GET', `/admin/commissions/${ID_A}/other`).status).toBe(404)
    expect(
      call(
        'POST',
        `/admin/commissions/${ID_A}/events`,
        'x'.repeat(MAX_BODY_BYTES + 1),
      ).status,
    ).toBe(413)
  })
})
