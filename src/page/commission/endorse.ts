import { Array, Option, Schema } from 'effect'
import { Submodel } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import {
  type FormSpec,
  Message,
  type Model,
  NonEmpty,
  type Step,
  answer,
  init as initInquiry,
  listOf,
  makeUpdate,
} from './inquiry'
import {
  type Choice,
  type StepBody,
  checkPills,
  fieldOf,
  reviewList,
  selectField,
  textArea,
  textField,
  wizardView,
} from './widgets'

// SPEC

const FIELD = {
  brand: 'brand',
  contact: 'contact',
  channels: 'channels',
  campaignType: 'campaign_type',
  budget: 'budget',
  details: 'details',
}

const STEPS: ReadonlyArray<Step> = [
  {
    id: 'who',
    title: 'Who you are',
    fields: [FIELD.brand, FIELD.contact],
  },
  {
    id: 'campaign',
    title: 'The campaign',
    fields: [FIELD.channels, FIELD.campaignType, FIELD.budget],
  },
  { id: 'details', title: 'Details', fields: [FIELD.details] },
  { id: 'review', title: 'Review and send', fields: [] },
]

const CHANNELS: ReadonlyArray<string> = [
  'YouTube',
  'X',
  'TikTok',
  'Instagram',
  'Live Stream',
]

const CAMPAIGN_TYPES: ReadonlyArray<string> = [
  'Sponsored stream / video',
  'Product placement',
  'Brand ambassador',
  'Social posts',
  'Other',
]

const BUDGETS: ReadonlyArray<string> = [
  "Let's discuss",
  '$100 – $300',
  '$300 – $700',
  '$700 – $1500',
  '$1500+',
]

const toChoices = (values: ReadonlyArray<string>): ReadonlyArray<Choice> =>
  Array.map(values, value => ({ value, label: value }))

const ChannelList = Schema.String.check(
  Schema.makeFilter(
    value =>
      Array.isReadonlyArrayNonEmpty(listOf(value)) &&
      listOf(value).every(channel => CHANNELS.includes(channel)),
  ),
)

export const spec: FormSpec = {
  steps: STEPS,
  rules: {
    [FIELD.brand]: NonEmpty,
    [FIELD.contact]: NonEmpty,
    [FIELD.channels]: ChannelList,
    [FIELD.campaignType]: Schema.Literals(CAMPAIGN_TYPES),
    [FIELD.budget]: Schema.Literals(BUDGETS),
    [FIELD.details]: NonEmpty,
  },
  initialDraft: {
    [FIELD.brand]: '',
    [FIELD.contact]: '',
    [FIELD.channels]: '',
    [FIELD.campaignType]: CAMPAIGN_TYPES[0] ?? '',
    [FIELD.budget]: BUDGETS[0] ?? '',
    [FIELD.details]: '',
  },
  kind: 'endorse',
  answers: draft => ({
    brand: answer(draft, FIELD.brand).trim(),
    contact: answer(draft, FIELD.contact).trim(),
    channels: listOf(answer(draft, FIELD.channels)).join(', '),
    campaign_type: answer(draft, FIELD.campaignType),
    budget: answer(draft, FIELD.budget),
    details: answer(draft, FIELD.details).trim(),
  }),
  quote: () => Option.none(),
}

// MODEL

export { Message, Model } from './inquiry'

export const init = (): Model => initInquiry(spec)

export const update = makeUpdate(spec)

// VIEW

const STEP_BODIES: Readonly<Record<string, StepBody>> = {
  who: (model, h) => {
    const view = fieldOf(model)
    return [
      textField(
        {
          ...view(FIELD.brand, 'Brand or company', true),
          placeholder: 'Your company name',
        },
        h,
      ),
      textField(
        {
          ...view(FIELD.contact, 'Contact person and email', true),
          placeholder: 'name, you@company.com',
        },
        h,
      ),
    ]
  },
  campaign: (model, h) => {
    const view = fieldOf(model)
    return [
      checkPills(
        {
          ...view(FIELD.channels, 'Feature on', true),
          options: toChoices(CHANNELS),
          problem: 'Pick at least one channel.',
        },
        h,
      ),
      selectField(
        {
          ...view(FIELD.campaignType, 'Campaign type'),
          options: toChoices(CAMPAIGN_TYPES),
        },
        h,
      ),
      selectField(
        { ...view(FIELD.budget, 'Budget range'), options: toChoices(BUDGETS) },
        h,
      ),
    ]
  },
  details: (model, h) => [
    textArea(
      {
        ...fieldOf(model)(FIELD.details, 'Campaign details', true),
        placeholder: 'Product, goals, timeline, deliverables, any links',
      },
      h,
    ),
  ],
}

const reviewBody = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const fields = spec.answers(model.draft)
  const row = (label: string, key: string) => ({
    label,
    value: fields[key] ?? '',
  })
  return [
    reviewList(
      [
        row('Brand', 'brand'),
        row('Contact', 'contact'),
        row('Channels', 'channels'),
        row('Campaign type', 'campaign_type'),
        row('Budget', 'budget'),
        row('Details', 'details'),
      ],
      h,
    ),
  ]
}

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  wizardView(
    {
      page: 'endorse',
      heading: 'Endorse Fio',
      blurb: [
        h.p(
          [],
          [
            "For brands and sponsors who'd like to work with Fio. There is no price list, so tell Fio what you have in mind and she answers with a quote.",
          ],
        ),
      ],
      spec,
      model,
      stepBody: step => STEP_BODIES[step.id]?.(model, h) ?? [],
      reviewBody: reviewBody(model, h),
      quote: Option.none(),
      sentNote: 'Business inquiries are answered within 2 to 3 days.',
    },
    h,
  ),
)
