import { Array, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Songbook } from '../../domain.ts'
import { radioRouter } from '../../route'
import {
  type LanguageGroup,
  Message,
  type Model,
  NOTES_BUTTON_ID,
  NOTES_PANEL_ID,
  visibleGroups,
  visibleNotes,
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

const NOTES_TITLE_ID = 'songbook-notes-title'

const notesButton = (isOpen: boolean, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(NOTES_BUTTON_ID),
      h.AriaHasPopup('dialog'),
      h.AriaExpanded(isOpen),
      h.OnClick(Message.ClickedOpenNotes()),
      h.Class(
        'mx-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-gray-200',
      ),
    ],
    [
      'lagi nyatet jangan ditagih',
      h.img([h.Src('/FioTSKR.webp'), h.Alt(':<'), h.Class('h-5 w-5')]),
    ],
  )

const notesModal = (
  notes: ReadonlyArray<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4',
      ),
      h.OnKeyDownPreventDefault(key =>
        key === 'Escape'
          ? Option.some(Message.ClickedCloseNotes())
          : Option.none(),
      ),
    ],
    [
      h.div([
        h.Class('absolute inset-0 bg-black/60 motion-safe:animate-fade-in'),
        h.AriaHidden(true),
        h.OnClick(Message.ClickedCloseNotes()),
      ]),
      h.div(
        [
          h.Id(NOTES_PANEL_ID),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy(NOTES_TITLE_ID),
          h.Tabindex(-1),
          h.Class(
            'relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border-t border-white/10 bg-neutral-950/95 pb-[env(safe-area-inset-bottom)] text-white shadow-2xl outline-none backdrop-blur-xl motion-safe:animate-sheet-up sm:max-w-md sm:rounded-xl sm:border sm:pb-0 sm:motion-safe:animate-pop-in',
          ),
        ],
        [
          h.div([
            h.Class(
              'mx-auto mt-2 h-1.5 w-10 rounded-full bg-white/25 sm:hidden',
            ),
            h.AriaHidden(true),
          ]),
          h.div(
            [
              h.Class(
                'flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3',
              ),
            ],
            [
              h.h2(
                [
                  h.Id(NOTES_TITLE_ID),
                  h.Class(
                    'flex items-center gap-2 text-lg font-black uppercase tracking-tight text-[#7fb0d8]',
                  ),
                ],
                [
                  'Lagi nyatet',
                  h.span(
                    [h.Class('text-xs font-semibold text-gray-400')],
                    [`${notes.length}`],
                  ),
                ],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.AriaLabel('Close'),
                  h.OnClick(Message.ClickedCloseNotes()),
                  h.Class(
                    'flex size-9 items-center justify-center rounded-full border border-white/15 bg-white/10 hover:bg-white/20',
                  ),
                ],
                [h.i([h.Class('fas fa-times'), h.AriaHidden(true)])],
              ),
            ],
          ),
          h.p(
            [h.Class('px-5 pt-3 text-xs text-gray-400')],
            [
              'Songs Fiona is still noting down. Not ready yet, so no hounding :<',
            ],
          ),
          h.div(
            [
              h.Class(
                'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5',
              ),
            ],
            [titleList(notes, h)],
          ),
        ],
      ),
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

export const view = Submodel.defineView<Model, Message>((model, h): Html => {
  const notes = Option.match(AsyncData.getData(model.songbook), {
    onNone: () => [],
    onSome: songbook => visibleNotes(songbook, model.search),
  })
  return h.main(
    [h.Class('flex h-dvh w-full flex-col p-4')],
    [
      h.div(
        [
          h.Class(
            'flex min-h-0 flex-1 flex-col gap-5 rounded-xl border border-white/10 bg-black/75 p-5 text-white shadow-2xl backdrop-blur-xl',
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
          h.div(
            [
              h.Class(
                '-mr-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2',
              ),
            ],
            [
              AsyncData.matchData(model.songbook, {
                onEmpty: () => spinnerView(h),
                onFailure: error => errorView(error, h),
                onData: songbook => songbookView(songbook, model.search, h),
              }),
            ],
          ),
          Array.isReadonlyArrayNonEmpty(notes)
            ? notesButton(model.isNotesOpen, h)
            : h.empty,
        ],
      ),
      model.isNotesOpen && Array.isReadonlyArrayNonEmpty(notes)
        ? notesModal(notes, h)
        : h.empty,
    ],
  )
})
