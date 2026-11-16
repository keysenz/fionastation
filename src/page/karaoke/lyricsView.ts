import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { twMerge } from 'tailwind-merge'

import { songLabel } from '../../domain.ts'
import {
  LyricCursor,
  Lyrics,
  type LyricsCredit,
  type LyricLine,
  type MissingReason,
  NUDGE_STEP_MS,
  type Translation,
  translationOf,
} from '../../lyrics.ts'
import {
  LyricsFetch,
  Message,
  type NowSinging,
  loadedLyricsOf,
} from './karaoke'

const ROW_REM = 3.25
const WINDOW_ROWS = 5

const MISSING_TEXT: Record<MissingReason, string> = {
  NotFound: 'No synced lyrics for this song',
  Unsure: 'Not sure which song this is, so no lyrics',
  Hidden: '',
}

type SyncedLyrics = Extract<Lyrics, { _tag: 'Synced' }>

const syncedOf = (singing: NowSinging): Option.Option<SyncedLyrics> =>
  Option.flatMap(Option.flatMap(singing.maybeLyrics, loadedLyricsOf), lyrics =>
    Lyrics.match(lyrics, {
      Synced: synced => Option.some(synced),
      Missing: () => Option.none(),
    }),
  )

/** The line the bar shows: the one being sung, or through an intro or a break, the next one. */
export const barLineOf = (singing: NowSinging): Option.Option<string> =>
  Option.flatMap(syncedOf(singing), ({ lines }) => {
    const sungFrom = (index: number) =>
      Option.map(
        Array.findFirst(lines.slice(index), ({ text }) => text !== ''),
        ({ text }) => text,
      )
    return Option.flatMap(singing.maybeCursor, cursor =>
      LyricCursor.match(cursor, {
        Before: () => sungFrom(0),
        After: () => Option.none(),
        OnLine: ({ index }) => sungFrom(index),
      }),
    )
  })

export const hasLyricsPanel = (singing: NowSinging): boolean =>
  Option.match(Option.flatMap(singing.maybeLyrics, loadedLyricsOf), {
    onNone: () => true,
    onSome: lyrics =>
      Lyrics.match(lyrics, {
        Synced: () => true,
        Missing: ({ reason }) => reason !== 'Hidden',
      }),
  })

const activeIndexOf = (singing: NowSinging, lineCount: number): number =>
  Option.match(singing.maybeCursor, {
    onNone: () => -1,
    onSome: cursor =>
      LyricCursor.match(cursor, {
        Before: () => -1,
        OnLine: ({ index }) => index,
        After: () => lineCount,
      }),
  })

const formatNudge = (steps: number): string => {
  const seconds = (steps * NUDGE_STEP_MS) / 1000
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)} s`
}

const loadedOf = (singing: NowSinging): Option.Option<Lyrics> =>
  Option.flatMap(singing.maybeLyrics, loadedLyricsOf)

const translationOfSinging = (
  singing: NowSinging,
): Option.Option<Translation> =>
  Option.flatMap(loadedOf(singing), translationOf)

const translationActiveIndexOf = (
  singing: NowSinging,
  translation: Translation,
): number =>
  Option.match(singing.maybeTranslationCursor, {
    onNone: () => -1,
    onSome: cursor =>
      LyricCursor.match(cursor, {
        Before: () => -1,
        OnLine: ({ index }) => index,
        After: () => translation.lines.length,
      }),
  })

/** The translation line under the active sung line, none through a gap. */
const translationTextOf = (singing: NowSinging): Option.Option<string> =>
  Option.flatMap(translationOfSinging(singing), translation =>
    Option.filter(
      Option.map(
        Array.get(
          translation.lines,
          translationActiveIndexOf(singing, translation),
        ),
        ({ text }) => text,
      ),
      text => text !== '',
    ),
  )

const lyricLinesView = (
  singing: NowSinging,
  lines: ReadonlyArray<LyricLine>,
  active: number,
  maybeUnderActive: Option.Option<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'absolute inset-x-0 top-1/2 transition-transform duration-300 ease-out motion-reduce:transition-none',
      ),
      h.Style({
        transform: `translateY(${-(active + 0.5) * ROW_REM}rem)`,
      }),
    ],
    lines.map(({ atMs, text }, index) => {
      const distance = Math.abs(index - active)
      return h.keyed('div')(
        `${singing.segment.song.id}-${atMs}-${text}`,
        [
          h.Class(
            twMerge(
              'flex flex-col items-center justify-center px-2 text-center leading-snug transition-colors duration-300',
              distance === 0
                ? 'text-white text-base font-semibold'
                : distance === 1
                  ? 'text-white/60 text-sm'
                  : 'text-white/30 text-sm',
            ),
          ),
          h.Style({ height: `${ROW_REM}rem` }),
        ],
        [
          text === '' ? '♪' : text,
          distance === 0
            ? Option.match(maybeUnderActive, {
                onNone: () => h.empty,
                onSome: underActive =>
                  h.span(
                    [
                      h.Class(
                        'text-xs font-normal text-white/50 leading-tight',
                      ),
                    ],
                    [underActive],
                  ),
              })
            : h.empty,
        ],
      )
    }),
  )

const skeletonView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col items-center justify-center gap-3 h-full py-4')],
    [28, 40, 32, 36, 24].map(width =>
      h.div([
        h.Class('h-3 rounded-full bg-white/10 animate-pulse'),
        h.Style({ width: `${width * 0.25}rem` }),
      ]),
    ),
  )

const noteView = (text: string, h: HtmlBuilder<Message>): Html =>
  h.p(
    [
      h.Class(
        'flex items-center justify-center h-full px-4 py-4 text-center text-sm text-gray-400',
      ),
    ],
    [text],
  )

const retryView = (
  songId: string,
  retry: 'Waiting' | 'GaveUp',
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.DataAttribute('lyrics-retry', retry),
      h.Class(
        'flex flex-col items-center justify-center gap-2 h-full px-4 py-4 text-center text-sm text-gray-400',
      ),
    ],
    [
      h.p(
        [],
        [
          retry === 'Waiting'
            ? 'Lyrics are unavailable right now, trying again soon'
            : 'Lyrics are unavailable right now',
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedRetryLyrics({ songId })),
          h.Class(
            'min-h-10 px-4 rounded-full border border-white/20 text-white hover:bg-white/10 transition',
          ),
        ],
        ['Try again'],
      ),
    ],
  )

const nudgeButtonClass =
  'min-h-10 px-3 rounded-full border border-white/20 text-xs text-gray-200 hover:bg-white/10 active:scale-95 transition'

const nudgeControlsView = (
  singing: NowSinging,
  credit: LyricsCredit,
  h: HtmlBuilder<Message>,
): Html => {
  const songId = singing.segment.song.id
  return h.div(
    [h.Class('flex flex-col items-center gap-2 pt-2')],
    [
      h.div(
        [h.Class('flex items-center justify-center gap-2')],
        [
          h.button(
            [
              h.Type('button'),
              h.OnClick(Message.ClickedNudgeLyrics({ songId, by: -1 })),
              h.Class(nudgeButtonClass),
            ],
            ['Lyrics earlier'],
          ),
          h.span(
            [
              h.Class(
                'min-w-14 text-center text-xs tabular-nums text-gray-300',
              ),
            ],
            [formatNudge(singing.nudge)],
          ),
          h.button(
            [
              h.Type('button'),
              h.OnClick(Message.ClickedNudgeLyrics({ songId, by: 1 })),
              h.Class(nudgeButtonClass),
            ],
            ['Lyrics later'],
          ),
          singing.nudge === 0
            ? h.empty
            : h.button(
                [
                  h.Type('button'),
                  h.OnClick(Message.ClickedResetLyricsNudge({ songId })),
                  h.Class(nudgeButtonClass),
                ],
                ['Reset'],
              ),
        ],
      ),
      h.p(
        [h.Class('text-xs text-gray-500 text-center truncate max-w-full')],
        [`Lyrics: ${credit.source} · ${credit.track}, ${credit.artist}`],
      ),
    ],
  )
}

const captionView = (
  singing: NowSinging,
  clickedSongId: string,
  h: HtmlBuilder<Message>,
): Html =>
  singing.segment.song.id === clickedSongId
    ? h.empty
    : h.p(
        [h.Class('text-xs text-gray-400 text-center truncate pb-1')],
        [`Now singing: ${songLabel(singing.segment.song)}`],
      )

const lyricsBodyView = (
  singing: NowSinging,
  maybeHeightRem: Option.Option<number>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        twMerge(
          'relative overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]',
          Option.isNone(maybeHeightRem) && 'flex-1',
        ),
      ),
      h.Style(
        Option.match(maybeHeightRem, {
          onNone: () => ({}),
          onSome: heightRem => ({ height: `${heightRem}rem` }),
        }),
      ),
    ],
    [
      Option.match(singing.maybeLyrics, {
        onNone: () => skeletonView(h),
        onSome: fetch =>
          LyricsFetch.match(fetch, {
            Loading: () => skeletonView(h),
            Failed: () => retryView(singing.segment.song.id, 'Waiting', h),
            GaveUp: () => retryView(singing.segment.song.id, 'GaveUp', h),
            Loaded: ({ lyrics }) =>
              Lyrics.match(lyrics, {
                Synced: synced =>
                  lyricLinesView(
                    singing,
                    synced.lines,
                    activeIndexOf(singing, synced.lines.length),
                    translationTextOf(singing),
                    h,
                  ),
                Missing: ({ reason, translation }) =>
                  translation === undefined || reason === 'Hidden'
                    ? noteView(MISSING_TEXT[reason], h)
                    : lyricLinesView(
                        singing,
                        translation.lines,
                        translationActiveIndexOf(singing, translation),
                        Option.none(),
                        h,
                      ),
              }),
          }),
      }),
    ],
  )

const creditOf = (singing: NowSinging): Option.Option<LyricsCredit> =>
  Option.map(syncedOf(singing), ({ credit }) => credit)

const creditClass = 'text-xs text-gray-500 text-center truncate max-w-full'

const translationCreditView = (
  singing: NowSinging,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(translationOfSinging(singing), {
    onNone: () => h.empty,
    onSome: ({ language }) =>
      h.p(
        [h.Class(twMerge(creditClass, 'pt-1'))],
        [`Translation (${language}) · captions by Fiona Clearesta`],
      ),
  })

const footerView = (singing: NowSinging, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col items-center')],
    [
      Option.match(creditOf(singing), {
        onNone: () => h.empty,
        onSome: credit => nudgeControlsView(singing, credit, h),
      }),
      translationCreditView(singing, h),
    ],
  )

export const lyricsColumnView = (
  singing: NowSinging,
  clickedSongId: string,
  h: HtmlBuilder<Message>,
): Html =>
  hasLyricsPanel(singing)
    ? h.div(
        [h.Class('hidden sm:flex flex-col shrink-0 w-80 lg:w-96 self-stretch')],
        [
          captionView(singing, clickedSongId, h),
          lyricsBodyView(singing, Option.none(), h),
          footerView(singing, h),
        ],
      )
    : h.empty

export const lyricsWindowView = (
  singing: NowSinging,
  clickedSongId: string,
  h: HtmlBuilder<Message>,
): Html =>
  hasLyricsPanel(singing)
    ? h.div(
        [h.Class('sm:hidden mb-4')],
        [
          captionView(singing, clickedSongId, h),
          lyricsBodyView(singing, Option.some(WINDOW_ROWS * ROW_REM), h),
          footerView(singing, h),
        ],
      )
    : h.empty
