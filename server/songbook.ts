import type { Songbook } from '../src/domain.ts'

const SHEET_ID =
  process.env.SONGBOOK_SHEET_ID ??
  '1Y6yqx2nnDwQI9i_Kak4E6ZnyOwEw7n43LxyHtQphv2E'
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`
const FRESH_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000

export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const isRequestLabel = (label: string) =>
  label === '' || /^requests?$/i.test(label)

const isNotesLabel = (label: string) => /^cat[ae]tan/i.test(label)

/** The first row with any text is the header. A labelled column holds the songs
 *  of that language, the unlabelled or Request column holds viewer requests, and
 *  a catatan column holds songs Fiona is still noting down. */
export const toSongbook = (
  rows: ReadonlyArray<ReadonlyArray<string>>,
): Songbook => {
  const headerIndex = rows.findIndex(row =>
    row.some(cell => cell.trim() !== ''),
  )
  if (headerIndex === -1) {
    return { songs: [], requests: [], notes: [] }
  }
  const labels = (rows[headerIndex] ?? []).map(cell => cell.trim())
  const body = rows.slice(headerIndex + 1)
  const width = Math.max(...rows.map(row => row.length))
  const columns = Array.from({ length: width }, (_, column) => ({
    label: labels[column] ?? '',
    titles: body
      .map(row => (row[column] ?? '').trim())
      .filter(title => title !== ''),
  }))
  return {
    songs: columns
      .filter(({ label }) => !isRequestLabel(label) && !isNotesLabel(label))
      .flatMap(({ label, titles }) =>
        titles.map(title => ({ title, language: label })),
      ),
    requests: columns
      .filter(({ label }) => isRequestLabel(label))
      .flatMap(({ titles }) => titles),
    notes: columns
      .filter(({ label }) => isNotesLabel(label))
      .flatMap(({ titles }) => titles),
  }
}

export type SongbookLookup =
  | { kind: 'Answered'; songbook: Songbook }
  | { kind: 'Unavailable' }

let cached: { songbook: Songbook; fetchedAt: number } | undefined
let pending: Promise<SongbookLookup> | undefined

const fetchSongbook = async (): Promise<SongbookLookup> => {
  try {
    const response = await fetch(SHEET_CSV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`the sheet responded with ${response.status}`)
    }
    const songbook = toSongbook(parseCsv(await response.text()))
    cached = { songbook, fetchedAt: Date.now() }
    return { kind: 'Answered', songbook }
  } catch (error) {
    console.warn('Could not read the songbook sheet:', error)
    return cached
      ? { kind: 'Answered', songbook: cached.songbook }
      : { kind: 'Unavailable' }
  }
}

// NOTE: when the sheet is unreachable the last good copy keeps being served.
export const loadSongbook = (): Promise<SongbookLookup> => {
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return Promise.resolve({ kind: 'Answered', songbook: cached.songbook })
  }
  pending ??= fetchSongbook().finally(() => {
    pending = undefined
  })
  return pending
}
