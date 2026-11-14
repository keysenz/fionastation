import { histogram, moodTimeSeries, stackedBar, timeSeries } from './charts.ts'
import {
  EXPORT_TABLES,
  FEW_MOOD_VOTES,
  MIN_PLAYS_CHOICES,
  RANGES,
  SONG_COLUMNS,
  TRANSITION_COLUMNS,
  type Report,
  type SongColumn,
  type SongMoodRow,
  type SortDirection,
  type TransitionColumn,
  type VideoRow,
  exportUrl,
  formatCount,
  formatPercent,
  formatSeconds,
  histogramOf,
  moodMix,
  moodRowsFor,
  parseReport,
  ratio,
  sortSongs,
  sortTransitions,
  summarizeMoods,
  topMoods,
  totalsOf,
} from './report.ts'

type Screen =
  | Readonly<{ kind: 'Loading' }>
  | Readonly<{ kind: 'SignedOut'; notice: string | undefined }>
  | Readonly<{ kind: 'NoAccess'; name: string | undefined }>
  | Readonly<{ kind: 'Unavailable'; message: string }>
  | Readonly<{
      kind: 'Dashboard'
      report: Report
      name: string | undefined
    }>

type View = {
  days: number
  screen: Screen
  sortColumn: SongColumn
  sortDirection: SortDirection
  selectedSongId: string | null
  transitionColumn: TransitionColumn
  transitionDirection: SortDirection
  minTransitionPlays: number
  moodFilter: string | null
}

const view: View = {
  days: 7,
  screen: { kind: 'Loading' },
  sortColumn: 'visitorPlays',
  sortDirection: 'desc',
  selectedSongId: null,
  transitionColumn: 'plays',
  transitionDirection: 'desc',
  minTransitionPlays: MIN_PLAYS_CHOICES[0],
  moodFilter: null,
}

const NOTICES: Readonly<Record<string, string>> = {
  state: 'The sign-in link expired. Try again.',
  refused: 'Discord did not confirm the sign-in. Try again.',
  limit: 'Too many sign-in attempts. Wait a few minutes.',
}

type Child = Node | string | undefined

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Readonly<Record<string, string | number | boolean>> = {},
  children: readonly Child[] = [],
) => {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(props)) {
    if (name === 'class') element.className = String(value)
    else if (name.startsWith('aria-')) element.setAttribute(name, String(value))
    else if (value === true) element.setAttribute(name, '')
    else if (value !== false) element.setAttribute(name, String(value))
  }
  element.append(...children.filter(child => child !== undefined))
  return element
}

const root = document.getElementById('app') as HTMLElement

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { credentials: 'same-origin', ...init })
  const body: unknown = await response.json().catch(() => undefined)
  return { status: response.status, body }
}

const accountName = async () => {
  const { status, body } = await fetchJson('/api/auth/me')
  const name = (body as { name?: unknown } | undefined)?.name
  return status === 200 && typeof name === 'string' ? name : undefined
}

const load = async () => {
  view.screen = { kind: 'Loading' }
  render()
  try {
    const { status, body } = await fetchJson(
      `/api/stats-page/report?days=${view.days}`,
    )
    if (status === 401) {
      const notice = new URLSearchParams(location.search).get('login')
      view.screen = {
        kind: 'SignedOut',
        notice: notice ? NOTICES[notice] : undefined,
      }
    } else if (status === 403) {
      view.screen = { kind: 'NoAccess', name: await accountName() }
    } else if (status === 200) {
      const report = parseReport(body)
      view.screen = report
        ? { kind: 'Dashboard', report, name: await accountName() }
        : {
            kind: 'Unavailable',
            message: 'The server sent a report this page cannot read.',
          }
    } else {
      view.screen = {
        kind: 'Unavailable',
        message:
          status === 503
            ? 'The statistics page is not set up on this server.'
            : `The server answered ${status}.`,
      }
    }
  } catch {
    view.screen = {
      kind: 'Unavailable',
      message: 'Could not reach the server.',
    }
  }
  render()
}

const logout = async () => {
  await fetchJson('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  history.replaceState(null, '', '/stats')
  await load()
}

const centered = (children: readonly Child[]) =>
  h('main', { class: 'center', 'data-screen': 'message' }, [
    h('section', { class: 'panel gate' }, children),
  ])

const logoutButton = () =>
  h('button', { type: 'button', class: 'btn', 'data-action': 'logout' }, [
    'Log out',
  ])

const bar = (name: string | undefined) =>
  h('header', { class: 'topbar' }, [
    h('h1', {}, ['Fio Radio stats']),
    h(
      'div',
      { class: 'ranges', role: 'group', 'aria-label': 'Time range' },
      RANGES.map(range =>
        h(
          'button',
          {
            type: 'button',
            class: range.days === view.days ? 'btn on' : 'btn',
            'aria-pressed': range.days === view.days,
            'data-range': range.days,
          },
          [range.label],
        ),
      ),
    ),
    h('div', { class: 'who' }, [
      h('span', { 'data-user': true }, [name ?? 'Signed in']),
      logoutButton(),
    ]),
  ])

const tile = (key: string, label: string, value: string, note: string) =>
  h('section', { class: 'panel tile', 'data-tile': key }, [
    h('h2', {}, [label]),
    h('p', { class: 'big', 'data-value': true }, [value]),
    h('p', { class: 'note' }, [note]),
  ])

const legendItem = (className: string, label: string) =>
  h('li', {}, [h('span', { class: `swatch ${className}` }), label])

const sortHeader = (column: SongColumn, label: string) => {
  const active = view.sortColumn === column
  return h(
    'th',
    {
      scope: 'col',
      class: column === 'title' ? 'text' : 'num',
      'aria-sort': active
        ? view.sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none',
    },
    [
      h('button', { type: 'button', class: 'sort', 'data-sort': column }, [
        label,
        active ? (view.sortDirection === 'asc' ? ' ▲' : ' ▼') : '',
      ]),
    ],
  )
}

const num = (value: number | string) =>
  h('td', { class: 'num' }, [String(value)])

const songTable = (report: Report) => {
  const songs = sortSongs(
    report.songs,
    view.sortColumn,
    view.sortDirection,
  ).slice(0, 100)
  const labels: Readonly<Record<SongColumn, string>> = {
    title: 'Song',
    clicks: 'Clicks',
    visitorPlays: 'Visitor plays',
    autoplayPlays: 'Autoplay plays',
    finishes: 'Finishes',
    skips: 'Skips',
    medianSkip: 'Median skip',
  }
  return h('div', { class: 'scroll' }, [
    h('table', { 'data-table': 'songs' }, [
      h('thead', {}, [
        h(
          'tr',
          {},
          SONG_COLUMNS.map(column => sortHeader(column, labels[column])),
        ),
      ]),
      h(
        'tbody',
        {},
        songs.map(song =>
          h(
            'tr',
            {
              'data-song': song.songId,
              class: song.songId === view.selectedSongId ? 'picked' : '',
            },
            [
              h('td', { class: 'text' }, [
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'link',
                    'data-pick': song.songId,
                    'aria-pressed': song.songId === view.selectedSongId,
                  },
                  [song.title ?? `Unknown song ${song.songId}`],
                ),
                song.artist
                  ? h('span', { class: 'note' }, [` ${song.artist}`])
                  : undefined,
              ]),
              num(song.clicks),
              num(song.plays.Visitor),
              num(song.plays.Autoplay),
              num(song.finishes.Visitor + song.finishes.Autoplay),
              num(song.skips.Visitor + song.skips.Autoplay),
              num(formatSeconds(song.medianSecondsIntoSkip)),
            ],
          ),
        ),
      ),
    ]),
  ])
}

const videoTable = (videos: readonly VideoRow[]) =>
  h('div', { class: 'scroll' }, [
    h('table', { 'data-table': 'videos' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { class: 'text', scope: 'col' }, ['Video']),
          ...[
            'Clicks',
            'Visitor plays',
            'Autoplay plays',
            'Finishes',
            'Skips',
          ].map(label => h('th', { class: 'num', scope: 'col' }, [label])),
        ]),
      ]),
      h(
        'tbody',
        {},
        videos
          .slice(0, 50)
          .map(video =>
            h('tr', { 'data-video': video.videoId }, [
              h('td', { class: 'text' }, [video.videoTitle]),
              num(video.clicks),
              num(video.plays.Visitor),
              num(video.plays.Autoplay),
              num(video.finishes.Visitor + video.finishes.Autoplay),
              num(video.skips.Visitor + video.skips.Autoplay),
            ]),
          ),
      ),
    ]),
  ])

const outcomesTable = (report: Report) =>
  h('div', { class: 'scroll' }, [
    h('table', { 'data-table': 'outcomes' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { class: 'text', scope: 'col' }, ['Picked by']),
          ...['Plays', 'Finish rate', 'Skip rate', 'Median skip'].map(label =>
            h('th', { class: 'num', scope: 'col' }, [label]),
          ),
        ]),
      ]),
      h(
        'tbody',
        {},
        report.outcomes.map(row =>
          h('tr', { 'data-origin': row.origin }, [
            h('td', { class: 'text' }, [
              row.origin === 'Visitor' ? 'Visitor' : 'Autoplay',
            ]),
            num(formatCount(row.plays)),
            num(formatPercent(ratio(row.finishes, row.plays))),
            num(formatPercent(ratio(row.skips, row.plays))),
            num(formatSeconds(row.medianSecondsIntoSkip)),
          ]),
        ),
      ),
    ]),
  ])

const transitionHeader = (column: TransitionColumn, label: string) => {
  const active = view.transitionColumn === column
  return h(
    'th',
    {
      scope: 'col',
      class: column === 'transition' ? 'text' : 'num',
      'aria-sort': active
        ? view.transitionDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none',
    },
    [
      h(
        'button',
        { type: 'button', class: 'sort', 'data-sort-transition': column },
        [
          label,
          active ? (view.transitionDirection === 'asc' ? ' ▲' : ' ▼') : '',
        ],
      ),
    ],
  )
}

const transitionTable = (report: Report) => {
  const rows = sortTransitions(
    report.transitions,
    view.minTransitionPlays,
    view.transitionColumn,
    view.transitionDirection,
  ).slice(0, 100)
  const labels: Readonly<Record<TransitionColumn, string>> = {
    transition: 'From song, to song',
    plays: 'Plays',
    finishRate: 'Finish rate',
    skipRate: 'Skip rate',
  }
  return h('div', { class: 'scroll' }, [
    h('table', { 'data-table': 'transitions' }, [
      h('thead', {}, [
        h(
          'tr',
          {},
          TRANSITION_COLUMNS.map(column =>
            transitionHeader(column, labels[column]),
          ),
        ),
      ]),
      h(
        'tbody',
        {},
        rows.map(row =>
          h('tr', { 'data-transition': `${row.prevSongId}>${row.songId}` }, [
            h('td', { class: 'text' }, [
              `${row.prevTitle ?? row.prevSongId} → ${row.title ?? row.songId}`,
            ]),
            num(row.plays),
            num(formatPercent(ratio(row.finishes, row.plays))),
            num(formatPercent(ratio(row.skips, row.plays))),
          ]),
        ),
      ),
    ]),
  ])
}

const moodTop = (row: SongMoodRow, names: readonly string[]) => {
  const top = topMoods(row, names)
  return top.length === 0
    ? '-'
    : top.length === 1
      ? (top[0] ?? '-')
      : `${top.join(' / ')} (tie)`
}

const moodTable = (report: Report) => {
  const rows = moodRowsFor(report.moods, report.moodNames, view.moodFilter)
  return h('div', { class: 'scroll' }, [
    h('table', { 'data-table': 'moods' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { scope: 'col', class: 'text' }, ['Song']),
          h('th', { scope: 'col', class: 'num' }, ['Votes']),
          h('th', { scope: 'col', class: 'text' }, ['Mix']),
          h('th', { scope: 'col', class: 'text' }, ['Top mood']),
        ]),
      ]),
      h(
        'tbody',
        {},
        rows.slice(0, 100).map(row => {
          const label = row.title ?? `Unknown song ${row.songId}`
          const detail = report.moodNames
            .map(name => `${name} ${row.votes[name] ?? 0}`)
            .join(', ')
          return h('tr', { 'data-mood-song': row.songId }, [
            h('td', { class: 'text' }, [
              row.videoUrl
                ? h(
                    'a',
                    {
                      class: 'link',
                      href: row.videoUrl,
                      target: '_blank',
                      rel: 'noreferrer',
                    },
                    [label],
                  )
                : label,
              row.artist
                ? h('span', { class: 'note' }, [` ${row.artist}`])
                : undefined,
            ]),
            num(row.total),
            h('td', { class: 'text', title: detail }, [
              stackedBar(
                report.moodNames.map(mood => ({
                  mood,
                  votes: row.votes[mood] ?? 0,
                })),
                detail,
                'mood-mini',
              ),
            ]),
            h('td', { class: 'text', 'data-top-mood': true }, [
              moodTop(row, report.moodNames),
              row.total < FEW_MOOD_VOTES
                ? h('span', { class: 'few', 'data-few-votes': true }, [
                    'few votes',
                  ])
                : undefined,
            ]),
          ])
        }),
      ),
    ]),
  ])
}

const moodSection = (report: Report) => {
  const summary = summarizeMoods(report)
  const mix = moodMix(report.moods, report.moodNames)
  return [
    h('div', { class: 'tiles', 'data-moods-tiles': true }, [
      tile(
        'mood-votes',
        'Mood votes',
        formatCount(summary.totalVotes),
        'moods tapped by viewers',
      ),
      tile(
        'mood-songs',
        'Songs with votes',
        formatCount(summary.songsWithVotes),
        'at least one mood',
      ),
      tile(
        'mood-top',
        'Top mood',
        summary.topMood.length === 0 ? '-' : summary.topMood.join(' / '),
        summary.topMood.length > 1 ? 'tied' : 'most voted overall',
      ),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'mood-daily' }, [
      h('h2', {}, ['Mood votes per day']),
      h('p', { class: 'note' }, [
        'Shows whether viewers answer the question at all.',
      ]),
      moodTimeSeries(report.moodDaily),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'mood-mix' }, [
      h('h2', {}, ['Mood mix']),
      stackedBar(mix, 'Mood mix overall', 'mood-mix'),
      h(
        'ul',
        { class: 'legend' },
        mix.map(({ mood, votes }) =>
          h('li', { 'data-mood-share': mood }, [
            h('span', { class: `swatch mood-${mood}` }),
            `${mood} ${formatCount(votes)} (${formatPercent(ratio(votes, summary.totalVotes))})`,
          ]),
        ),
      ),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'moods' }, [
      h('h2', {}, ['Mood votes by song']),
      h('p', { class: 'note' }, [
        'Most voted first. Pick a mood to list only the songs it leads, then pick it again to clear. A tie lists the song under each tied mood.',
      ]),
      h(
        'div',
        { class: 'chips' },
        report.moodNames.map(mood =>
          h(
            'button',
            {
              type: 'button',
              class: view.moodFilter === mood ? 'chip on' : 'chip',
              'aria-pressed': view.moodFilter === mood,
              'data-mood-filter': mood,
            },
            [h('span', { class: `swatch mood-${mood}` }), mood],
          ),
        ),
      ),
      report.moods.length > 0
        ? moodTable(report)
        : h('p', { class: 'note' }, ['No mood votes in this range yet.']),
    ]),
  ]
}

const minPlaysButtons = () =>
  h(
    'div',
    { class: 'ranges', role: 'group', 'aria-label': 'Minimum plays' },
    MIN_PLAYS_CHOICES.map(choice =>
      h(
        'button',
        {
          type: 'button',
          class: choice === view.minTransitionPlays ? 'btn on' : 'btn',
          'aria-pressed': choice === view.minTransitionPlays,
          'data-min-plays': choice,
        },
        [`${choice}+ plays`],
      ),
    ),
  )

const exportLinks = () =>
  h(
    'div',
    { class: 'ranges' },
    EXPORT_TABLES.map(({ table, label }) =>
      h(
        'a',
        {
          class: 'btn',
          href: exportUrl(table, view.days),
          download: `fio-radio-${table}-${view.days}d.ndjson`,
          'data-export': table,
        },
        [label],
      ),
    ),
  )

const dashboard = (report: Report, name: string | undefined) => {
  const totals = totalsOf(report.daily)
  const picked = report.songs.find(song => song.songId === view.selectedSongId)
  const bars = histogramOf(report, picked ? picked.songId : null)
  const skipTotal = bars.reduce((total, value) => total + value, 0)
  return h('div', { class: 'page', 'data-screen': 'dashboard' }, [
    bar(name),
    h('p', { class: 'hint' }, [
      `UTC days from ${report.since}. 24 h is today so far.`,
    ]),
    h('div', { class: 'tiles' }, [
      tile(
        'plays',
        'Total plays',
        formatCount(totals.totalPlays),
        `${formatCount(totals.clicks)} clicks`,
      ),
      tile(
        'share',
        'Visitor share',
        formatPercent(totals.visitorShare),
        `${formatCount(totals.plays.Visitor)} visitor, ${formatCount(totals.plays.Autoplay)} autoplay`,
      ),
      tile(
        'finishes',
        'Finishes',
        formatCount(totals.finishes),
        'songs played to the end',
      ),
      tile(
        'skips',
        'Skips',
        formatCount(totals.skips),
        'Next pressed mid song',
      ),
      tile(
        'finish-rate',
        'Finish rate',
        formatPercent(totals.finishRate),
        'finishes per play',
      ),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'daily' }, [
      h('h2', {}, ['Plays per day']),
      h('ul', { class: 'legend' }, [
        legendItem('visitor', 'Visitor plays'),
        legendItem('autoplay', 'Autoplay plays'),
        legendItem('clicks', 'Clicks'),
        legendItem('skips', 'Skips'),
      ]),
      timeSeries(report.daily),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'skip-times' }, [
      h('h2', {}, [
        picked
          ? `When people skip: ${picked.title ?? picked.songId}`
          : 'When people skip: all songs',
      ]),
      h('p', { class: 'note', 'data-skip-total': skipTotal }, [
        `${formatCount(skipTotal)} skips, ${report.skipBucketSeconds} second buckets`,
      ]),
      picked
        ? h('button', { type: 'button', class: 'btn', 'data-pick': '' }, [
            'Show all songs',
          ])
        : h('p', { class: 'note' }, [
            'Pick a song in the table to narrow this.',
          ]),
      histogram(bars, report.skipBucketSeconds),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'origin-outcomes' }, [
      h('h2', {}, ['Autoplay vs visitor outcome']),
      h('p', { class: 'note' }, [
        'How plays end, by who picked the song. Counts only visits that recorded a listening trail.',
      ]),
      outcomesTable(report),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'transitions' }, [
      h('h2', {}, ['Top transitions']),
      h('p', { class: 'note' }, [
        'Song to the next song in the same visit, with how the second play ended.',
      ]),
      minPlaysButtons(),
      transitionTable(report),
    ]),
    ...moodSection(report),
    h('section', { class: 'panel wide', 'data-panel': 'export' }, [
      h('h2', {}, ['Export for offline modeling']),
      h('p', { class: 'note' }, [
        `One JSON object per line, UTC days from ${report.since}.`,
      ]),
      exportLinks(),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'songs' }, [
      h('h2', {}, ['Top songs']),
      songTable(report),
    ]),
    h('section', { class: 'panel wide', 'data-panel': 'videos' }, [
      h('h2', {}, ['Top videos']),
      videoTable(report.videos),
    ]),
  ])
}

const signInScreen = (notice: string | undefined) =>
  centered([
    h('h1', {}, ['Fio Radio stats']),
    notice ? h('p', { class: 'notice', role: 'alert' }, [notice]) : undefined,
    h('p', {}, ['Only moderators and Fiona can see this page.']),
    h(
      'a',
      {
        class: 'btn primary',
        'data-action': 'sign-in',
        href: '/api/auth/discord/start?return=/stats',
      },
      ['Sign in with Discord'],
    ),
  ])

const render = () => {
  const { screen } = view
  switch (screen.kind) {
    case 'Loading':
      root.replaceChildren(centered([h('p', { role: 'status' }, ['Loading'])]))
      return
    case 'SignedOut':
      root.replaceChildren(signInScreen(screen.notice))
      return
    case 'NoAccess':
      root.replaceChildren(
        centered([
          h('h1', {}, ['No access']),
          h('p', { 'data-user': true }, [
            screen.name
              ? `${screen.name} is signed in, but this account is not on the list.`
              : 'This account is not on the list.',
          ]),
          logoutButton(),
        ]),
      )
      return
    case 'Unavailable':
      root.replaceChildren(
        centered([h('h1', {}, ['Unavailable']), h('p', {}, [screen.message])]),
      )
      return
    case 'Dashboard':
      root.replaceChildren(dashboard(screen.report, screen.name))
  }
}

const isTransitionColumn = (
  value: string | undefined,
): value is TransitionColumn =>
  TRANSITION_COLUMNS.some(column => column === value)

const isSortColumn = (value: string | undefined): value is SongColumn =>
  SONG_COLUMNS.some(column => column === value)

root.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null
  const action = target?.closest<HTMLElement>(
    '[data-action], [data-range], [data-sort], [data-pick], [data-sort-transition], [data-min-plays], [data-mood-filter]',
  )
  if (!action) return
  if (action.dataset.action === 'logout') {
    void logout()
  } else if (action.dataset.range !== undefined) {
    view.days = Number(action.dataset.range)
    void load()
  } else if (
    action.dataset.sort !== undefined &&
    isSortColumn(action.dataset.sort)
  ) {
    const column = action.dataset.sort
    view.sortDirection =
      view.sortColumn === column && view.sortDirection === 'desc'
        ? 'asc'
        : column === 'title'
          ? 'asc'
          : 'desc'
    view.sortColumn = column
    render()
  } else if (
    action.dataset.sortTransition !== undefined &&
    isTransitionColumn(action.dataset.sortTransition)
  ) {
    const column = action.dataset.sortTransition
    view.transitionDirection =
      view.transitionColumn === column && view.transitionDirection === 'desc'
        ? 'asc'
        : column === 'transition'
          ? 'asc'
          : 'desc'
    view.transitionColumn = column
    render()
  } else if (action.dataset.moodFilter !== undefined) {
    view.moodFilter =
      action.dataset.moodFilter === view.moodFilter
        ? null
        : action.dataset.moodFilter
    render()
  } else if (action.dataset.minPlays !== undefined) {
    view.minTransitionPlays = Number(action.dataset.minPlays)
    render()
  } else if (action.dataset.pick !== undefined) {
    view.selectedSongId =
      action.dataset.pick === '' || action.dataset.pick === view.selectedSongId
        ? null
        : action.dataset.pick
    render()
  }
})

void load()
