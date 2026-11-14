import { Option } from 'effect'
import { expect, test } from 'vitest'

import {
  type Quote,
  type StudioSelection,
  formatIdr,
  formatMoney,
  formatUsd,
  quoteStudio,
  quoteText,
  quoteVoice,
} from './pricing'

const studio = (overrides: Partial<StudioSelection>): StudioSelection => ({
  service: 'Full Production',
  length: 'Short',
  tracks: 1,
  singers: 1,
  addOns: [],
  extraComplexity: false,
  rush: false,
  firstCommission: false,
  ...overrides,
})

const totalOf = (quote: Quote) =>
  quote._tag === 'Priced' ? quote.total : { idr: NaN, usd: NaN }

const depositOf = (quote: Quote) =>
  quote._tag === 'Priced' ? quote.deposit : Option.none()

test.each([
  ['Personal', 'Short', 150_000, 30],
  ['Personal', 'Full', 300_000, 60],
  ['Commercial', 'Short', 300_000, 60],
  ['Commercial', 'Full', 600_000, 120],
] as const)('voice %s %s costs Rp%i / $%i', (usage, length, idr, usd) => {
  expect(totalOf(quoteVoice({ usage, length }))).toEqual({ idr, usd })
})

test.each([
  ['Full Production', 'Short', 100_000, 20],
  ['Full Production', 'Standard', 200_000, 40],
  ['Mix & Master', 'Short', 75_000, 15],
  ['Mix & Master', 'Standard', 150_000, 30],
  ['Tuning Only', 'Short', 40_000, 8],
  ['Tuning Only', 'Standard', 50_000, 10],
] as const)('%s %s base is Rp%i / $%i', (service, length, idr, usd) => {
  expect(totalOf(quoteStudio(studio({ service, length })))).toEqual({
    idr,
    usd,
  })
})

test('three tracks are included, each extra track is charged on top', () => {
  expect(totalOf(quoteStudio(studio({ tracks: 3 }))).idr).toBe(100_000)
  expect(totalOf(quoteStudio(studio({ tracks: 5 })))).toEqual({
    idr: 150_000,
    usd: 30,
  })
  expect(
    totalOf(quoteStudio(studio({ length: 'Standard', tracks: 4 }))),
  ).toEqual({ idr: 250_000, usd: 50 })
  expect(
    totalOf(quoteStudio(studio({ service: 'Mix & Master', tracks: 5 }))),
  ).toEqual({ idr: 115_000, usd: 23 })
})

test('tuning is priced per track with no included tracks', () => {
  expect(
    totalOf(quoteStudio(studio({ service: 'Tuning Only', tracks: 4 }))),
  ).toEqual({ idr: 160_000, usd: 32 })
})

test('add-ons charge per project, per track and per extra vocalist', () => {
  const quote = (selection: Partial<StudioSelection>) =>
    totalOf(quoteStudio(studio(selection)))
  expect(quote({ addOns: ['artificial-harmony'] }).idr).toBe(125_000)
  expect(quote({ addOns: ['recording-consultation'] }).idr).toBe(150_000)
  expect(quote({ addOns: ['simple-adlibs'] }).idr).toBe(200_000)
  expect(quote({ addOns: ['complex-adlibs'] })).toEqual({
    idr: 250_000,
    usd: 50,
  })
  expect(quote({ tracks: 2, addOns: ['main-vocal-guide'] }).idr).toBe(300_000)
  expect(quote({ tracks: 2, addOns: ['harmony-guide'] }).idr).toBe(200_000)
  expect(quote({ singers: 3 })).toEqual({ idr: 400_000, usd: 80 })
})

test('add-ons that do not apply to the service are ignored', () => {
  expect(
    totalOf(
      quoteStudio(
        studio({
          service: 'Tuning Only',
          singers: 3,
          addOns: ['artificial-harmony'],
        }),
      ),
    ),
  ).toEqual({ idr: 40_000, usd: 8 })
})

test('complexity and rush each add a share of the subtotal', () => {
  const base = { length: 'Standard', addOns: ['simple-adlibs'] } as const
  expect(
    totalOf(quoteStudio(studio({ ...base, extraComplexity: true }))),
  ).toEqual({ idr: 375_000, usd: 75 })
  expect(totalOf(quoteStudio(studio({ ...base, rush: true })))).toEqual({
    idr: 450_000,
    usd: 90,
  })
  expect(
    totalOf(
      quoteStudio(studio({ ...base, extraComplexity: true, rush: true })),
    ),
  ).toEqual({ idr: 525_000, usd: 105 })
})

test('the intro discount takes 25% off after the surcharges', () => {
  const quote = quoteStudio(
    studio({ length: 'Standard', rush: true, firstCommission: true }),
  )
  expect(totalOf(quote)).toEqual({ idr: 225_000, usd: 45 })
  expect(totalOf(quoteStudio(studio({ firstCommission: true })))).toEqual({
    idr: 75_000,
    usd: 15,
  })
})

test('the deposit applies only above Rp300k', () => {
  const atThreshold = quoteStudio(
    studio({ length: 'Standard', addOns: ['complex-adlibs'] }),
  )
  expect(totalOf(atThreshold).idr).toBe(350_000)
  expect(depositOf(atThreshold)).toEqual(Option.some({ idr: 175_000, usd: 35 }))
  const exactly = quoteStudio(
    studio({ length: 'Standard', addOns: ['main-vocal-guide'] }),
  )
  expect(totalOf(exactly).idr).toBe(300_000)
  expect(depositOf(exactly)).toEqual(Option.none())
  expect(depositOf(quoteStudio(studio({})))).toEqual(Option.none())
})

test('a long cover is priced by case whatever else is picked', () => {
  const quote = quoteStudio(
    studio({ length: 'Long', rush: true, addOns: ['simple-adlibs'] }),
  )
  expect(quote._tag).toBe('ByCase')
  expect(quoteText(quote)).toContain('priced by case')
})

test('formatting writes rupiah with dots and trims whole dollars', () => {
  expect(formatIdr(1_250_000)).toBe('Rp1.250.000')
  expect(formatIdr(-18_750)).toBe('-Rp18.750')
  expect(formatUsd(30)).toBe('$30')
  expect(formatUsd(1.25)).toBe('$1.25')
  expect(formatMoney({ idr: 150_000, usd: 30 })).toBe('Rp150.000 / $30')
})

test('the quote text carries every line, the total and the deposit', () => {
  const text = quoteText(
    quoteStudio(studio({ length: 'Standard', addOns: ['complex-adlibs'] })),
  )
  expect(text).toContain('Complex adlibs: Rp150.000 / $30')
  expect(text).toContain('Estimated total: Rp350.000 / $70')
  expect(text).toContain('50% deposit: Rp175.000 / $35')
})
