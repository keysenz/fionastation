import { Array, Match, Option, pipe } from 'effect'

// MONEY

export type Money = Readonly<{ idr: number; usd: number }>

export const money = (idr: number, usd: number): Money => ({ idr, usd })

const ZERO: Money = money(0, 0)

const roundUsd = (usd: number): number => Math.round(usd * 100) / 100

const scale = (amount: Money, factor: number): Money =>
  money(Math.round(amount.idr * factor), roundUsd(amount.usd * factor))

const plus = (left: Money, right: Money): Money =>
  money(left.idr + right.idr, roundUsd(left.usd + right.usd))

const sumMoney = (amounts: ReadonlyArray<Money>): Money =>
  Array.reduce(amounts, ZERO, plus)

const withThousands = (value: number): string =>
  `${Math.abs(value)}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export const formatIdr = (idr: number): string =>
  `${idr < 0 ? '-' : ''}Rp${withThousands(idr)}`

export const formatUsd = (usd: number): string =>
  `${usd < 0 ? '-' : ''}$${Number.isInteger(usd) ? Math.abs(usd) : Math.abs(usd).toFixed(2)}`

export const formatMoney = (amount: Money): string =>
  `${formatIdr(amount.idr)} / ${formatUsd(amount.usd)}`

// QUOTE

export type QuoteLine = Readonly<{ label: string; amount: Money }>

export type Quote =
  | Readonly<{
      _tag: 'Priced'
      lines: ReadonlyArray<QuoteLine>
      total: Money
      deposit: Option.Option<Money>
    }>
  | Readonly<{ _tag: 'ByCase'; reason: string }>

const priced = (
  lines: ReadonlyArray<QuoteLine>,
  deposit: (total: Money) => Option.Option<Money>,
): Quote => {
  const total = sumMoney(Array.map(lines, line => line.amount))
  return { _tag: 'Priced', lines, total, deposit: deposit(total) }
}

export const quoteText = (quote: Quote): string =>
  Match.value(quote).pipe(
    Match.tag('ByCase', ({ reason }) => `Priced by case. ${reason}`),
    Match.tag('Priced', ({ lines, total, deposit }) =>
      [
        ...Array.map(
          lines,
          line => `${line.label}: ${formatMoney(line.amount)}`,
        ),
        `Estimated total: ${formatMoney(total)}`,
        ...Option.match(deposit, {
          onNone: () => [],
          onSome: amount => [`50% deposit: ${formatMoney(amount)}`],
        }),
      ].join('\n'),
    ),
    Match.exhaustive,
  )

// VOICE

export type Usage = 'Personal' | 'Commercial'
export type VoiceLength = 'Short' | 'Full'

export const VOICE_PRICES: Readonly<Record<Usage, Record<VoiceLength, Money>>> =
  {
    Personal: { Short: money(150_000, 30), Full: money(300_000, 60) },
    Commercial: { Short: money(300_000, 60), Full: money(600_000, 120) },
  }

export type VoiceSelection = Readonly<{ usage: Usage; length: VoiceLength }>

export const quoteVoice = ({ usage, length }: VoiceSelection): Quote =>
  priced(
    [
      {
        label: `${usage} licence, ${length === 'Short' ? 'short (up to 2:00)' : 'full song'}`,
        amount: VOICE_PRICES[usage][length],
      },
    ],
    Option.none,
  )

// STUDIO

export type Service = 'Full Production' | 'Mix & Master' | 'Tuning Only'
export type StudioLength = 'Short' | 'Standard' | 'Long'
type PricedLength = Exclude<StudioLength, 'Long'>

export type ServicePrice = Readonly<{ base: Money; extraTrack: Money }>

export const STUDIO_PRICES: Readonly<
  Record<Service, Record<PricedLength, ServicePrice>>
> = {
  'Full Production': {
    Short: { base: money(100_000, 20), extraTrack: money(25_000, 5) },
    Standard: { base: money(200_000, 40), extraTrack: money(50_000, 10) },
  },
  'Mix & Master': {
    Short: { base: money(75_000, 15), extraTrack: money(20_000, 4) },
    Standard: { base: money(150_000, 30), extraTrack: money(40_000, 8) },
  },
  'Tuning Only': {
    Short: { base: money(40_000, 8), extraTrack: ZERO },
    Standard: { base: money(50_000, 10), extraTrack: ZERO },
  },
}

export const TRACKS_INCLUDED = 3

export type AddOnId =
  | 'artificial-harmony'
  | 'extra-vocalist'
  | 'recording-consultation'
  | 'main-vocal-guide'
  | 'harmony-guide'
  | 'simple-adlibs'
  | 'complex-adlibs'

export type AddOn = Readonly<{
  id: AddOnId
  label: string
  price: Money
  per: 'project' | 'track' | 'person'
  services: ReadonlyArray<Service>
  chosenByClient: boolean
}>

const PRODUCTION: ReadonlyArray<Service> = ['Full Production', 'Mix & Master']
const ANY_SERVICE: ReadonlyArray<Service> = [
  'Full Production',
  'Mix & Master',
  'Tuning Only',
]

export const ADD_ONS: ReadonlyArray<AddOn> = [
  {
    id: 'artificial-harmony',
    label: 'Artificial harmony',
    price: money(25_000, 5),
    per: 'project',
    services: PRODUCTION,
    chosenByClient: true,
  },
  {
    id: 'extra-vocalist',
    label: 'Extra vocalist',
    price: money(150_000, 30),
    per: 'person',
    services: PRODUCTION,
    chosenByClient: false,
  },
  {
    id: 'recording-consultation',
    label: 'Recording consultation',
    price: money(50_000, 10),
    per: 'project',
    services: ANY_SERVICE,
    chosenByClient: true,
  },
  {
    id: 'main-vocal-guide',
    label: 'Main vocal guide',
    price: money(100_000, 20),
    per: 'track',
    services: ANY_SERVICE,
    chosenByClient: true,
  },
  {
    id: 'harmony-guide',
    label: 'Harmony guide',
    price: money(50_000, 10),
    per: 'track',
    services: ANY_SERVICE,
    chosenByClient: true,
  },
  {
    id: 'simple-adlibs',
    label: 'Simple adlibs',
    price: money(100_000, 20),
    per: 'project',
    services: ANY_SERVICE,
    chosenByClient: true,
  },
  {
    id: 'complex-adlibs',
    label: 'Complex adlibs',
    price: money(150_000, 30),
    per: 'project',
    services: ANY_SERVICE,
    chosenByClient: true,
  },
]

export const COMPLEXITY_SURCHARGE = 0.25
export const RUSH_SURCHARGE = 0.5
export const INTRO_DISCOUNT = 0.25
export const DEPOSIT_SHARE = 0.5
export const DEPOSIT_THRESHOLD = money(300_000, 60)

export type StudioSelection = Readonly<{
  service: Service
  length: StudioLength
  tracks: number
  singers: number
  addOns: ReadonlyArray<AddOnId>
  extraComplexity: boolean
  rush: boolean
  firstCommission: boolean
}>

const quantityOf = (
  per: AddOn['per'],
  { tracks, singers }: StudioSelection,
): number =>
  Match.value(per).pipe(
    Match.when('project', () => 1),
    Match.when('track', () => tracks),
    Match.when('person', () => Math.max(0, singers - 1)),
    Match.exhaustive,
  )

const addOnLines = (selection: StudioSelection): ReadonlyArray<QuoteLine> =>
  pipe(
    ADD_ONS,
    Array.filter(
      addOn =>
        addOn.services.includes(selection.service) &&
        (addOn.chosenByClient
          ? selection.addOns.includes(addOn.id)
          : quantityOf(addOn.per, selection) > 0),
    ),
    Array.map(addOn => {
      const quantity = quantityOf(addOn.per, selection)
      return {
        label:
          addOn.per === 'project' ? addOn.label : `${addOn.label} x${quantity}`,
        amount: scale(addOn.price, quantity),
      }
    }),
  )

const baseLines = (
  selection: StudioSelection,
  price: ServicePrice,
): ReadonlyArray<QuoteLine> => {
  if (selection.service === 'Tuning Only') {
    return [
      {
        label: `Tuning x${selection.tracks} ${selection.tracks === 1 ? 'track' : 'tracks'}`,
        amount: scale(price.base, selection.tracks),
      },
    ]
  }
  const extraTracks = Math.max(0, selection.tracks - TRACKS_INCLUDED)
  return [
    {
      label: `${selection.service}, ${selection.length.toLowerCase()} (up to ${TRACKS_INCLUDED} tracks)`,
      amount: price.base,
    },
    ...(extraTracks > 0
      ? [
          {
            label: `Extra tracks x${extraTracks}`,
            amount: scale(price.extraTrack, extraTracks),
          },
        ]
      : []),
  ]
}

const LONG_REASON =
  'Covers over 300s, medleys and multi-part songs are priced by case. Chat with Fio first.'

export const quoteStudio = (selection: StudioSelection): Quote => {
  if (selection.length === 'Long') {
    return { _tag: 'ByCase', reason: LONG_REASON }
  }
  const subtotalLines = [
    ...baseLines(selection, STUDIO_PRICES[selection.service][selection.length]),
    ...addOnLines(selection),
  ]
  const subtotal = sumMoney(Array.map(subtotalLines, line => line.amount))
  const surcharges: ReadonlyArray<QuoteLine> = [
    ...(selection.extraComplexity
      ? [
          {
            label: 'Extra complexity +25%',
            amount: scale(subtotal, COMPLEXITY_SURCHARGE),
          },
        ]
      : []),
    ...(selection.rush
      ? [
          {
            label: 'Rush delivery +50%',
            amount: scale(subtotal, RUSH_SURCHARGE),
          },
        ]
      : []),
  ]
  const beforeDiscount = sumMoney([
    subtotal,
    ...Array.map(surcharges, line => line.amount),
  ])
  const discount: ReadonlyArray<QuoteLine> = selection.firstCommission
    ? [
        {
          label: 'Intro price, 25% off',
          amount: scale(beforeDiscount, -INTRO_DISCOUNT),
        },
      ]
    : []
  return priced([...subtotalLines, ...surcharges, ...discount], total =>
    total.idr > DEPOSIT_THRESHOLD.idr
      ? Option.some(scale(total, DEPOSIT_SHARE))
      : Option.none(),
  )
}
