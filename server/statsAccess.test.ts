// @vitest-environment node
import { describe, expect, test } from 'vitest'

import { createGatedReport, parseStatsUserIds } from './statsAccess.ts'

const MOD = '244661517356761089'
const FIONA = '927090060480905276'
const STRANGER = '111111111111111111'

const gate = (
  options: Partial<Parameters<typeof createGatedReport>[0]> = {},
) => {
  const asked: Array<string | null> = []
  const gated = createGatedReport({
    allowedIds: new Set([MOD, FIONA]),
    signedInId: cookie => cookie?.replace('as=', ''),
    report: days => (asked.push(days), { status: 200, body: { days } }),
    ...options,
  })
  return { gated, asked }
}

describe('who may read the report', () => {
  test('a signed out visitor gets 401 and the report is never read', () => {
    const { gated, asked } = gate()
    expect(gated(undefined, '7').status).toBe(401)
    expect(asked).toEqual([])
  })

  test('a signed in user who is not listed gets 403 and the report is never read', () => {
    const { gated, asked } = gate()
    expect(gated(`as=${STRANGER}`, '7')).toEqual({
      status: 403,
      body: { error: 'No access' },
    })
    expect(asked).toEqual([])
  })

  test.each([MOD, FIONA])(
    'listed user %s reads the report for the days asked',
    id => {
      const { gated, asked } = gate()
      expect(gated(`as=${id}`, '7')).toEqual({
        status: 200,
        body: { days: '7' },
      })
      expect(asked).toEqual(['7'])
    },
  )

  test.each([
    ['STATS_USER_IDS is unset', { allowedIds: undefined }],
    ['Discord login is not configured', { signedInId: undefined }],
    ['the statistics database is missing', { report: undefined }],
  ])('answers 503 to everyone when %s', (_, change) => {
    const { gated } = gate(change)
    expect(gated(undefined, null).status).toBe(503)
    expect(gated(`as=${MOD}`, null).status).toBe(503)
  })
})

describe('STATS_USER_IDS', () => {
  test('reads a comma separated list and trims it', () => {
    expect([...(parseStatsUserIds(` ${MOD}, ${FIONA} `) ?? [])]).toEqual([
      MOD,
      FIONA,
    ])
  })

  test.each([undefined, '', ' , ', 'mod', `${MOD},nope`])(
    'treats %j as unset',
    raw => {
      expect(parseStatsUserIds(raw)).toBeUndefined()
    },
  )
})
