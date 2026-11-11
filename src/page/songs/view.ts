import { Array } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Songbook } from '../../domain.ts'
import { radioRouter } from '../../route'
import {
  type LanguageGroup,
  Message,
  type Model,
  visibleGroups,
  visibleRequests,
} from './songs'

const LANGUAGE_NAMES: Record<string, string> = {
  JP: 'Japanese',
  ID: 'Indonesian',
  EN: 'English',
}

const languageName = (label: string): string =>
  LANGUAGE_NAMES[label.toUpperCase()] ?? label

const sectionHeading = (
  text: string,
  count: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.h2(
    [
      h.Class(
        'flex items-baseline gap-2 text-lg font-black uppercase tracking-tight text-[#7fb0d8]',
      ),
    ],
    [
      text,
      h.span([h.Class('text-xs font-semibold text-gray-400')], [`${count}`]),
    ],
  )

const titleList = (
  titles: ReadonlyArray<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.ul(
    [h.Class('grid gap-y-1')],
    titles.map(title =>
      h.li(
        [h.Class('border-b border-white/5 py-1.5 text-sm text-gray-100')],
        [title],
      ),
    ),
  )

const languageSection = (group: LanguageGroup, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('space-y-2')],
    [
      sectionHeading(languageName(group.language), group.songs.length, h),
      titleList(
        group.songs.map(song => song.title),
        h,
      ),
    ],
  )

const requestsSection = (
  requests: ReadonlyArray<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.Class('space-y-2 rounded-lg border border-white/10 bg-white/5 p-4')],
    [
      sectionHeading('Requested by viewers', requests.length, h),
      h.p(
        [h.Class('text-xs text-gray-400')],
        ['Songs viewers asked for. Fiona has not learned these yet.'],
      ),
      titleList(requests, h),
    ],
  )

const songbookView = (
  songbook: Songbook,
  search: string,
  h: HtmlBuilder<Message>,
): Html => {
  const groups = visibleGroups(songbook, search).filter(group =>
    Array.isReadonlyArrayNonEmpty(group.songs),
  )
  const requests = visibleRequests(songbook, search)
  return Array.isReadonlyArrayEmpty(groups) &&
    Array.isReadonlyArrayEmpty(requests)
    ? h.p(
        [h.Class('py-10 text-center text-sm text-gray-300')],
        ['No song matches that search.'],
      )
    : h.div(
        [h.Class('grid items-start gap-8 md:auto-cols-fr md:grid-flow-col')],
        [
          ...groups.map(group => languageSection(group, h)),
          Array.isReadonlyArrayNonEmpty(requests)
            ? requestsSection(requests, h)
            : h.empty,
        ],
      )
}

const errorView = (error: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('py-10 text-center text-gray-200')],
    [
      h.p([h.Class('font-semibold')], ['Could not load the song list']),
      h.p([h.Class('mt-2 text-sm opacity-75')], [error]),
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedRetryFetch()),
          h.Class(
            'mt-4 rounded-full bg-[#446e92] px-4 py-1.5 text-xs font-medium text-white',
          ),
        ],
        ['Try again'],
      ),
    ],
  )

const spinnerView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex h-40 items-center justify-center')],
    [
      h.div([
        h.Class('h-8 w-8 animate-spin rounded-full border-b-2 border-white'),
        h.AriaLabel('Loading songs'),
      ]),
    ],
  )

const searchView = (search: string, h: HtmlBuilder<Message>): Html =>
  h.input([
    h.Type('search'),
    h.AriaLabel('Search songs'),
    h.Placeholder('Search songs...'),
    h.Value(search),
    h.OnInput(value => Message.UpdatedSearch({ value })),
    h.Class(
      'w-full rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm text-white placeholder:text-gray-300 focus:border-[#446e92] focus:outline-none',
    ),
  ])

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  h.main(
    [h.Class('w-full grow px-4 py-4')],
    [
      h.div(
        [
          h.Class(
            'space-y-5 rounded-xl border border-white/10 bg-black/75 p-5 text-white shadow-2xl backdrop-blur-xl',
          ),
        ],
        [
          h.div(
            [h.Class('flex flex-wrap items-center justify-between gap-3')],
            [
              h.h1(
                [
                  h.Class(
                    'text-2xl font-black uppercase tracking-tight text-[#7fb0d8]',
                  ),
                ],
                ['Songs Fiona can sing'],
              ),
              h.a(
                [
                  h.Href(radioRouter()),
                  h.Class(
                    'flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 text-sm font-semibold hover:bg-white/20',
                  ),
                ],
                [
                  h.i([h.Class('fas fa-radio'), h.AriaHidden(true)]),
                  'Fio Radio',
                ],
              ),
            ],
          ),
          searchView(model.search, h),
          AsyncData.matchData(model.songbook, {
            onEmpty: () => spinnerView(h),
            onFailure: error => errorView(error, h),
            onData: songbook => songbookView(songbook, model.search, h),
          }),
        ],
      ),
    ],
  ),
)
