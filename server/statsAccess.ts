import { isDiscordId } from './playlists.ts'
import type { StatReply } from './stats.ts'

export const STATS_REPORT_ROUTE = '/api/stats-page/report'

export const parseStatsUserIds = (
  raw: string | undefined,
): ReadonlySet<string> | undefined => {
  const ids = (raw ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '')
  return ids.length > 0 && ids.every(isDiscordId) ? new Set(ids) : undefined
}

export const createGatedReport =
  ({
    allowedIds,
    signedInId,
    report,
  }: Readonly<{
    allowedIds: ReadonlySet<string> | undefined
    signedInId: ((cookie: string | undefined) => string | undefined) | undefined
    report: ((days: string | null) => StatReply) | undefined
  }>) =>
  (cookie: string | undefined, days: string | null): StatReply => {
    if (!allowedIds || !signedInId || !report) {
      return {
        status: 503,
        body: { error: 'The statistics page is unavailable right now' },
      }
    }
    const id = signedInId(cookie)
    if (id === undefined) {
      return { status: 401, body: { error: 'Not signed in' } }
    }
    return allowedIds.has(id)
      ? report(days)
      : { status: 403, body: { error: 'No access' } }
  }
