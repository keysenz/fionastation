import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { spec as endorse } from './endorse'
import { spec as hire } from './hire'
import { MAX_TRACKS, REQUIRED_FIELDS, quoteFromFields } from './inquiryContract'
import { type InquiryKind, snapshotOf } from './inquiryPayload'
import { ADD_ONS } from './pricing'
import { spec as studio } from './studio'

const CHOSEN = ADD_ONS.filter(addOn => addOn.chosenByClient).map(
  addOn => addOn.id,
)

const draftOf = (
  initial: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string>>,
) => ({ ...initial, ...changes })

const studioDrafts = () =>
  ['Full Production', 'Mix & Master', 'Tuning Only'].flatMap(service =>
    ['Short', 'Standard', 'Long'].flatMap(length =>
      Array.from({ length: MAX_TRACKS }, (_, index) => `${index + 1}`).flatMap(
        tracks =>
          ['1', '2', '3', '4'].flatMap(singers =>
            [[], CHOSEN, CHOSEN.slice(0, 2)].flatMap(addOns =>
              ['rush', 'regular'].flatMap(deadline =>
                ['', 'yes'].map(flag =>
                  draftOf(studio.initialDraft, {
                    service,
                    length,
                    tracks,
                    singers,
                    add_ons: addOns.join(','),
                    deadline,
                    complexity: flag,
                    first_commission: flag === 'yes' ? '' : 'yes',
                  }),
                ),
              ),
            ),
          ),
      ),
    ),
  )

const clientSnapshot = (
  quote: Option.Option<Parameters<typeof snapshotOf>[0]>,
) => Option.getOrNull(Option.map(quote, snapshotOf))

describe('the server reads back what the forms send', () => {
  test('every voice selection prices the same as the form did', () => {
    for (const usage of ['Personal', 'Commercial']) {
      for (const length of ['Short', 'Full']) {
        const draft = draftOf(hire.initialDraft, { usage, length })
        expect(quoteFromFields('voice', hire.answers(draft))).toEqual(
          Option.some(clientSnapshot(hire.quote(draft))),
        )
      }
    }
  })

  test('every studio selection prices the same as the form did', () => {
    const drafts = studioDrafts()
    expect(drafts.length).toBeGreaterThan(1000)
    for (const draft of drafts) {
      expect(
        quoteFromFields('studio', studio.answers(draft)),
        JSON.stringify(studio.answers(draft)),
      ).toEqual(Option.some(clientSnapshot(studio.quote(draft))))
    }
  })

  test('an endorsement has no quote', () => {
    expect(
      quoteFromFields('endorse', endorse.answers(endorse.initialDraft)),
    ).toEqual(Option.some(null))
  })

  test('answers that are not a selection give no quote', () => {
    expect(quoteFromFields('voice', { usage: 'Gold', length: 'Full' })).toEqual(
      Option.none(),
    )
    expect(quoteFromFields('studio', { service: 'Full Production' })).toEqual(
      Option.none(),
    )
    const answers = studio.answers(
      draftOf(studio.initialDraft, {
        service: 'Tuning Only',
        length: 'Short',
        deadline: 'regular',
      }),
    )
    expect(quoteFromFields('studio', { ...answers, tracks: '11' })).toEqual(
      Option.none(),
    )
    expect(quoteFromFields('studio', { ...answers, add_ons: 'Nope' })).toEqual(
      Option.none(),
    )
  })
})

describe('the required answer keys', () => {
  const filled = {
    voice: hire.answers(
      draftOf(hire.initialDraft, {
        name: 'Mika',
        contact: 'mika#0001',
        usage: 'Personal',
        length: 'Short',
        brief: 'Homura',
        agree: 'yes',
      }),
    ),
    studio: studio.answers(
      draftOf(studio.initialDraft, {
        name: 'Mika',
        contact: 'mika#0001',
        song: 'Homura',
        service: 'Mix & Master',
        length: 'Short',
        vocal_link: 'https://example.com/v',
        deadline: 'regular',
        details: 'None',
        agree: 'yes',
      }),
    ),
    endorse: endorse.answers(
      draftOf(endorse.initialDraft, {
        brand: 'Acme',
        contact: 'hi@acme.test',
        channels: 'YouTube,X',
        details: 'A sponsored stream',
      }),
    ),
  }
  const blank = {
    voice: hire.answers(hire.initialDraft),
    studio: studio.answers(studio.initialDraft),
    endorse: endorse.answers(endorse.initialDraft),
  }
  const kinds: ReadonlyArray<InquiryKind> = ['voice', 'studio', 'endorse']

  test.each(kinds)('a filled %s form sends every required key', kind => {
    for (const key of REQUIRED_FIELDS[kind]) {
      expect(filled[kind][key], key).toBeTruthy()
    }
  })

  test.each(kinds)('a blank %s form leaves required keys empty', kind => {
    expect(REQUIRED_FIELDS[kind].some(key => !blank[kind][key])).toBe(true)
  })
})
