import type { DayRow, MoodDayRow } from './report.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

type Attributes = Readonly<Record<string, string | number>>

export const svgEl = (
  tag: string,
  attributes: Attributes,
  children: ReadonlyArray<Element | string> = [],
) => {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value))
  }
  element.append(...children)
  return element
}

const title = (text: string) => svgEl('title', {}, [text])

export const niceMax = (value: number) => {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find(
    factor => factor * magnitude >= value / 4,
  )
  return (
    Math.ceil(value / ((step ?? 10) * magnitude)) * (step ?? 10) * magnitude
  )
}

const W = 640
const H = 240
const PAD = { left: 40, right: 12, top: 12, bottom: 28 }
const innerW = W - PAD.left - PAD.right
const innerH = H - PAD.top - PAD.bottom

const frame = (max: number, label: string) => {
  const ticks = [0, 1, 2, 3, 4].map(i => (max / 4) * i)
  return [
    ...ticks.flatMap(tick => {
      const y = PAD.top + innerH - (tick / max) * innerH
      return [
        svgEl('line', {
          x1: PAD.left,
          x2: W - PAD.right,
          y1: y,
          y2: y,
          class: 'grid',
        }),
        svgEl('text', { x: PAD.left - 6, y: y + 4, class: 'axis end' }, [
          String(Math.round(tick)),
        ]),
      ]
    }),
    svgEl('title', {}, [label]),
  ]
}

export const timeSeries = (daily: readonly DayRow[]) => {
  const max = niceMax(
    Math.max(
      1,
      ...daily.flatMap(day => [
        day.plays.Visitor + day.plays.Autoplay,
        day.clicks,
        day.skips.Visitor + day.skips.Autoplay,
      ]),
    ),
  )
  const slot = innerW / Math.max(daily.length, 1)
  const barW = Math.max(Math.min(slot * 0.7, 36), 1)
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH
  const x = (index: number) => PAD.left + slot * index + slot / 2
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8))
  const bars = daily.flatMap((day, index) => {
    const visitor = day.plays.Visitor
    const autoplay = day.plays.Autoplay
    return [
      svgEl('g', { class: 'bars', 'data-day': day.day }, [
        svgEl('rect', {
          x: x(index) - barW / 2,
          y: y(visitor),
          width: barW,
          height: PAD.top + innerH - y(visitor),
          class: 'bar-visitor',
        }),
        svgEl('rect', {
          x: x(index) - barW / 2,
          y: y(visitor + autoplay),
          width: barW,
          height: y(visitor) - y(visitor + autoplay),
          class: 'bar-autoplay',
        }),
        svgEl('rect', {
          x: x(index) - slot / 2,
          y: PAD.top,
          width: slot,
          height: innerH,
          class: 'hit',
        }),
        title(
          `${day.day}: ${visitor} visitor plays, ${autoplay} autoplay plays, ${day.clicks} clicks, ${day.skips.Visitor + day.skips.Autoplay} skips`,
        ),
      ]),
    ]
  })
  const line = (values: readonly number[], className: string) =>
    svgEl('polyline', {
      points: values.map((value, index) => `${x(index)},${y(value)}`).join(' '),
      class: `line ${className}`,
    })
  const dots = (values: readonly number[], className: string) =>
    values.map((value, index) =>
      svgEl('circle', { cx: x(index), cy: y(value), r: 2.5, class: className }),
    )
  const clicks = daily.map(day => day.clicks)
  const skips = daily.map(day => day.skips.Visitor + day.skips.Autoplay)
  const labels = daily.flatMap((day, index) =>
    index % labelEvery === 0
      ? [
          svgEl('text', { x: x(index), y: H - 8, class: 'axis middle' }, [
            day.day.slice(5),
          ]),
        ]
      : [],
  )
  return svgEl(
    'svg',
    {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': 'Plays per day by origin, with clicks and skips',
      class: 'chart',
      'data-chart': 'daily',
    },
    [
      ...frame(max, 'Plays per day'),
      ...bars,
      line(clicks, 'line-clicks'),
      ...dots(clicks, 'dot-clicks'),
      line(skips, 'line-skips'),
      ...dots(skips, 'dot-skips'),
      ...labels,
    ],
  )
}

export const moodTimeSeries = (daily: readonly MoodDayRow[]) => {
  const max = niceMax(Math.max(1, ...daily.map(day => day.votes)))
  const slot = innerW / Math.max(daily.length, 1)
  const barW = Math.max(Math.min(slot * 0.7, 36), 1)
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8))
  const bars = daily.map((day, index) => {
    const height = (day.votes / max) * innerH
    const x = PAD.left + slot * index + slot / 2
    return svgEl('g', { class: 'bars', 'data-day': day.day }, [
      svgEl('rect', {
        x: x - barW / 2,
        y: PAD.top + innerH - height,
        width: barW,
        height,
        class: 'bar-mood',
      }),
      svgEl('rect', {
        x: x - slot / 2,
        y: PAD.top,
        width: slot,
        height: innerH,
        class: 'hit',
      }),
      title(`${day.day}: ${day.votes} mood votes`),
    ])
  })
  const labels = daily.flatMap((day, index) =>
    index % labelEvery === 0
      ? [
          svgEl(
            'text',
            {
              x: PAD.left + slot * index + slot / 2,
              y: H - 8,
              class: 'axis middle',
            },
            [day.day.slice(5)],
          ),
        ]
      : [],
  )
  return svgEl(
    'svg',
    {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': 'Mood votes per day',
      class: 'chart',
      'data-chart': 'mood-daily',
    },
    [...frame(max, 'Mood votes per day'), ...bars, ...labels],
  )
}

export const stackedBar = (
  shares: ReadonlyArray<Readonly<{ mood: string; votes: number }>>,
  label: string,
  className: string,
) => {
  const total = shares.reduce((sum, share) => sum + share.votes, 0)
  let offset = 0
  const segments = shares.flatMap(({ mood, votes }) => {
    if (votes === 0 || total === 0) return []
    const width = (votes / total) * 100
    const segment = svgEl(
      'rect',
      {
        x: offset,
        y: 0,
        width,
        height: 10,
        class: `mood-${mood}`,
        'data-mood-segment': mood,
      },
      [title(`${mood}: ${votes} (${Math.round((votes / total) * 100)}%)`)],
    )
    offset += width
    return [segment]
  })
  return svgEl(
    'svg',
    {
      viewBox: '0 0 100 10',
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': label,
      class: className,
    },
    [
      svgEl('rect', {
        x: 0,
        y: 0,
        width: 100,
        height: 10,
        class: 'mood-empty',
      }),
      ...segments,
    ],
  )
}

export const histogram = (bars: readonly number[], bucketSeconds: number) => {
  const max = niceMax(Math.max(1, ...bars))
  const slot = innerW / Math.max(bars.length, 1)
  const last = bars.length - 1
  const rangeOf = (index: number) =>
    index === last
      ? `${index * bucketSeconds}s and later`
      : `${index * bucketSeconds}-${(index + 1) * bucketSeconds - 1}s`
  const rects = bars.map((value, index) => {
    const height = (value / max) * innerH
    return svgEl('g', { class: 'bars', 'data-bucket': index }, [
      svgEl('rect', {
        x: PAD.left + slot * index + 1,
        y: PAD.top + innerH - height,
        width: Math.max(slot - 2, 1),
        height,
        class: 'bar-skip',
      }),
      svgEl('rect', {
        x: PAD.left + slot * index,
        y: PAD.top,
        width: slot,
        height: innerH,
        class: 'hit',
      }),
      title(`${rangeOf(index)}: ${value} skips`),
    ])
  })
  const labels = bars.flatMap((_, index) =>
    index % 5 === 0
      ? [
          svgEl(
            'text',
            { x: PAD.left + slot * index, y: H - 8, class: 'axis start' },
            [
              index === last
                ? `${index * bucketSeconds}+`
                : `${index * bucketSeconds}s`,
            ],
          ),
        ]
      : [],
  )
  return svgEl(
    'svg',
    {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': 'Skips by seconds into the song',
      class: 'chart',
      'data-chart': 'skips',
    },
    [...frame(max, 'Skips by seconds into the song'), ...rects, ...labels],
  )
}
