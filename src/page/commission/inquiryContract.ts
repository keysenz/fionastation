import { Array, Option, pipe } from 'effect'

import {
  type InquiryKind,
  type QuoteSnapshot,
  snapshotOf,
} from './inquiryPayload.ts'
import {
  ADD_ONS,
  type AddOnId,
  STUDIO_PRICES,
  type Service,
  type StudioLength,
  type StudioSelection,
  type Usage,
  type VoiceLength,
  quoteStudio,
  quoteVoice,
} from './pricing.ts'

// NOTE: server/ imports this file at runtime, so keep it free of Foldkit and use `.ts` in relative imports.

export const MAX_TRACKS = 10

/** An inquiry id, as the form makes it with `crypto.randomUUID()`. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const USAGE_LABELS: Readonly<Record<Usage, string>> = {
  Personal: 'Personal (non-exclusive)',
  Commercial: 'Commercial (exclusive)',
}

export const SINGER_LABELS: Readonly<Record<string, string>> = {
  '1': 'Solo (1)',
  '2': 'Duet (2)',
  '3': 'Group (3)',
  '4': 'Group (4+)',
}

export const DEADLINE_LABELS = {
  rush: '1-3 days (rush)',
  regular: '4-7 days (regular)',
} as const

/** The answer keys each form must send non-empty, as `spec.answers` names them. */
export const REQUIRED_FIELDS: Readonly<
  Record<InquiryKind, ReadonlyArray<string>>
> = {
  voice: ['name', 'contact', 'usage', 'length', 'song_details', 'agreed'],
  studio: [
    'name',
    'contact',
    'song',
    'service',
    'cover_length',
    'tracks',
    'singers',
    'vocal_link',
    'deadline',
    'notes',
    'agreed',
  ],
  endorse: [
    'brand',
    'contact',
    'channels',
    'campaign_type',
    'budget',
    'details',
  ],
}

type Fields = Readonly<Record<string, string>>

const keyOfLabel = (
  labels: Readonly<Record<string, string>>,
  label: string | undefined,
): Option.Option<string> =>
  pipe(
    Object.entries(labels),
    Array.findFirst(([, candidate]) => candidate === label),
    Option.map(([key]) => key),
  )

const oneOf = <A extends string>(
  choices: ReadonlyArray<A>,
  value: string | undefined,
): Option.Option<A> => Array.findFirst(choices, choice => choice === value)

const USAGES: ReadonlyArray<Usage> = ['Personal', 'Commercial']

const voiceQuote = (fields: Fields): Option.Option<QuoteSnapshot> =>
  Option.all({
    usage: Array.findFirst(
      USAGES,
      usage => USAGE_LABELS[usage] === fields['usage'],
    ),
    length: oneOf<VoiceLength>(['Short', 'Full'], fields['length']),
  }).pipe(Option.map(selection => snapshotOf(quoteVoice(selection))))

const addOnIdsOf = (labels: string): Option.Option<ReadonlyArray<AddOnId>> =>
  Option.all(
    Array.map(labels === '' ? [] : labels.split(', '), label =>
      Array.findFirst(
        ADD_ONS,
        addOn => addOn.chosenByClient && addOn.label === label,
      ).pipe(Option.map(addOn => addOn.id)),
    ),
  )

const yesNo = (value: string | undefined): Option.Option<boolean> =>
  value === 'yes'
    ? Option.some(true)
    : value === 'no'
      ? Option.some(false)
      : Option.none()

const isService = (value: string): value is Service =>
  Object.hasOwn(STUDIO_PRICES, value)

const studioSelection = (fields: Fields): Option.Option<StudioSelection> =>
  Option.all({
    service: Option.fromNullishOr(fields['service']).pipe(
      Option.filter(isService),
    ),
    length: oneOf<StudioLength>(
      ['Short', 'Standard', 'Long'],
      fields['cover_length'],
    ),
    tracks: Option.fromNullishOr(fields['tracks']).pipe(
      Option.filter(value => /^\d+$/.test(value)),
      Option.map(Number),
      Option.filter(count => count >= 1 && count <= MAX_TRACKS),
    ),
    singers: keyOfLabel(SINGER_LABELS, fields['singers']).pipe(
      Option.map(Number),
    ),
    addOns: addOnIdsOf(fields['add_ons'] ?? ''),
    rush: Option.map(
      oneOf(
        [DEADLINE_LABELS.rush, DEADLINE_LABELS.regular],
        fields['deadline'],
      ),
      deadline => deadline === DEADLINE_LABELS.rush,
    ),
    extraComplexity: yesNo(fields['extra_complexity']),
    firstCommission: yesNo(fields['first_commission']),
  })

/**
 * Reads the form's answers back into a selection and prices it, so a stored quote never rests
 * on the client's own snapshot. `none` means the answers are not a selection the form can send.
 * `some(null)` means the kind has no price list.
 */
export const quoteFromFields = (
  kind: InquiryKind,
  fields: Fields,
): Option.Option<QuoteSnapshot | null> => {
  switch (kind) {
    case 'voice':
      return voiceQuote(fields)
    case 'studio':
      return studioSelection(fields).pipe(
        Option.map(selection => snapshotOf(quoteStudio(selection))),
      )
    case 'endorse':
      return Option.some(null)
  }
}
