import { isDiscordId } from './playlists.ts'
import type { NdjsonReply, StatReply } from './stats.ts'

export const STATS_REPORT_ROUTE = '/api/stats-page/report'
export const STATS_EXPORT_ROUTE = '/api/stats-page/export'

export const parseStatsUserIds = (
  raw: string | undefined,
): ReadonlySet<string> | undefined => {
  const ids = (raw ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '')
  return ids.length > 0 && ids.every(isDiscordId) ? new Set(ids) : undefined
}

type Gate = Readonly<{
  allowedIds: ReadonlySet<string> | undefined
  signedInId: ((cookie: string | undefined) => string | undefined) | undefined
}>

const UNAVAILABLE: StatReply = {
  status: 503,
  body: { error: 'The statistics page is unavailable right now' },
}

const refusal = (
  { allowedIds, signedInId }: Gate,
  cookie: string | undefined,
): StatReply | undefined => {
  if (!allowedIds || !signedInId) return UNAVAILABLE
  const id = signedInId(cookie)
  if (id === undefined) {
    return { status: 401, body: { error: 'Not signed in' } }
  }
  return allowedIds.has(id)
    ? undefined
    : { status: 403, body: { error: 'No access' } }
}

export const createGatedReport =
  ({
    report,
    ...gate
  }: Gate &
    Readonly<{ report: ((days: string | null) => StatReply) | undefined }>) =>
  (cookie: string | undefined, days: string | null): StatReply =>
    report ? (refusal(gate, cookie) ?? report(days)) : UNAVAILABLE

export const createGatedExport =
  ({
    exportRows,
    ...gate
  }: Gate &
    Readonly<{
      exportRows:
        | ((days: string | null, table: string | null) => StatReply | NdjsonReply)
        | undefined
    }>) =>
  (
    cookie: string | undefined,
    days: string | null,
    table: string | null,
  ): StatReply | NdjsonReply =>
    exportRows
      ? (refusal(gate, cookie) ?? exportRows(days, table))
      : UNAVAILABLE
