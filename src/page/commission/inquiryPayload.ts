import { Array, Option, Schema } from 'effect'

import type { Quote } from './pricing.ts'

export const INQUIRY_ROUTE = '/api/inquiry'

export const InquiryKind = Schema.Literals(['voice', 'studio', 'endorse'])
export type InquiryKind = typeof InquiryKind.Type

const MoneySnapshot = Schema.Struct({ idr: Schema.Number, usd: Schema.Number })

const QuoteLineSnapshot = Schema.Struct({
  label: Schema.String,
  idr: Schema.Number,
  usd: Schema.Number,
})

export const QuoteSnapshot = Schema.Union([
  Schema.TaggedStruct('Priced', {
    lines: Schema.Array(QuoteLineSnapshot),
    total: MoneySnapshot,
    deposit: Schema.NullOr(MoneySnapshot),
  }),
  Schema.TaggedStruct('ByCase', { reason: Schema.String }),
])
export type QuoteSnapshot = typeof QuoteSnapshot.Type

export const InquiryPayload = Schema.Struct({
  id: Schema.String,
  kind: InquiryKind,
  fields: Schema.Record(Schema.String, Schema.String),
  quote: Schema.NullOr(QuoteSnapshot),
})
export type InquiryPayload = typeof InquiryPayload.Type

export const SameSiteTrackingPath = Schema.String.check(
  Schema.isPattern(/^\/commission\/[0-9a-f-]{36}\?t=[A-Za-z0-9_-]+$/),
)

export const InquiryReply = Schema.Struct({
  id: Schema.String,
  trackingUrl: SameSiteTrackingPath,
})

export const snapshotOf = (quote: Quote): QuoteSnapshot =>
  quote._tag === 'ByCase'
    ? { _tag: 'ByCase', reason: quote.reason }
    : {
        _tag: 'Priced',
        lines: Array.map(quote.lines, line => ({
          label: line.label,
          idr: line.amount.idr,
          usd: line.amount.usd,
        })),
        total: quote.total,
        deposit: Option.getOrNull(quote.deposit),
      }
