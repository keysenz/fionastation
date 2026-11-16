// Fiona's own caption tracks for her cover and original videos, kept in
// lyrics-translations.json by scripts/caption-translations. They ride along
// with whatever lyrics the server answers for the song.
import { existsSync, readFileSync } from 'node:fs'

import type { Lyrics, Translation } from '../src/lyrics.ts'

export type Translations = ReadonlyMap<string, Translation>

export const noTranslations: Translations = new Map()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseTranslations(json: unknown): Translations {
  if (!isRecord(json)) throw new Error('$: expected an object')
  const translations = new Map<string, Translation>()
  for (const [id, value] of Object.entries(json)) {
    const path = `$[${JSON.stringify(id)}]`
    if (!isRecord(value)) throw new Error(`${path}: expected an object`)
    const { language, lines } = value
    if (typeof language !== 'string' || language === '') {
      throw new Error(`${path}.language: expected a non-empty string`)
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error(`${path}.lines: expected at least one line`)
    }
    let previous = -1
    const parsed = lines.map((line: unknown, index) => {
      const linePath = `${path}.lines[${index}]`
      if (
        !isRecord(line) ||
        typeof line.atMs !== 'number' ||
        !Number.isInteger(line.atMs) ||
        line.atMs < previous ||
        typeof line.text !== 'string'
      ) {
        throw new Error(
          `${linePath}: expected { atMs, text } with atMs in order`,
        )
      }
      previous = line.atMs
      return { atMs: line.atMs, text: line.text }
    })
    const [first, ...rest] = parsed
    translations.set(id, { language, lines: [first!, ...rest] })
  }
  return translations
}

export function loadTranslations(path: string): Translations {
  if (!existsSync(path)) return noTranslations
  try {
    return parseTranslations(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid lyrics translations in ${path}: ${reason}`, {
      cause: error,
    })
  }
}

export function withTranslation(
  lyrics: Lyrics,
  translation: Translation | undefined,
): Lyrics {
  return translation === undefined ? lyrics : { ...lyrics, translation }
}
