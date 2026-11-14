import { Array, Option, Schema } from 'effect'
import { Submodel } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import {
  Agreed,
  type Draft,
  type FormSpec,
  Message,
  type Model,
  NonEmpty,
  OptionalLink,
  type Step,
  answer,
  init as initInquiry,
  makeUpdate,
} from './inquiry'
import {
  type Usage,
  VOICE_PRICES,
  type VoiceLength,
  type VoiceSelection,
  formatMoney,
  quoteVoice,
} from './pricing'
import {
  type Choice,
  type StepBody,
  agreeBox,
  fieldOf,
  quoteCard,
  radioPills,
  reviewList,
  textArea,
  textField,
  wizardView,
} from './widgets'

// SPEC

const FIELD = {
  name: 'name',
  contact: 'contact',
  usage: 'usage',
  length: 'length',
  brief: 'brief',
  referenceLink: 'reference_link',
  deadline: 'deadline',
  details: 'details',
  agree: 'agree',
}

const STEPS: ReadonlyArray<Step> = [
  { id: 'you', title: 'About you', fields: [FIELD.name, FIELD.contact] },
  { id: 'license', title: 'Licence', fields: [FIELD.usage, FIELD.length] },
  {
    id: 'song',
    title: 'Your song',
    fields: [FIELD.brief, FIELD.referenceLink, FIELD.deadline, FIELD.details],
  },
  { id: 'terms', title: 'The rules', fields: [FIELD.agree] },
  { id: 'review', title: 'Review and send', fields: [] },
]

const UsageChoice = Schema.Literals(['Personal', 'Commercial'])
const LengthChoice = Schema.Literals(['Short', 'Full'])
const OptionalDate = Schema.Union([
  Schema.Literal(''),
  Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
])

export const voiceSelectionOf = (draft: Draft): Option.Option<VoiceSelection> =>
  Option.all({
    usage: Schema.decodeUnknownOption(UsageChoice)(answer(draft, FIELD.usage)),
    length: Schema.decodeUnknownOption(LengthChoice)(
      answer(draft, FIELD.length),
    ),
  })

const USAGE_LABELS: Readonly<Record<Usage, string>> = {
  Personal: 'Personal (non-exclusive)',
  Commercial: 'Commercial (exclusive)',
}

export const spec: FormSpec = {
  steps: STEPS,
  rules: {
    [FIELD.name]: NonEmpty,
    [FIELD.contact]: NonEmpty,
    [FIELD.usage]: UsageChoice,
    [FIELD.length]: LengthChoice,
    [FIELD.brief]: NonEmpty,
    [FIELD.referenceLink]: OptionalLink,
    [FIELD.deadline]: OptionalDate,
    [FIELD.details]: Schema.String,
    [FIELD.agree]: Agreed,
  },
  initialDraft: {
    [FIELD.name]: '',
    [FIELD.contact]: '',
    [FIELD.usage]: '',
    [FIELD.length]: '',
    [FIELD.brief]: '',
    [FIELD.referenceLink]: '',
    [FIELD.deadline]: '',
    [FIELD.details]: '',
    [FIELD.agree]: '',
  },
  kind: 'voice',
  answers: draft => {
    const selection = voiceSelectionOf(draft)
    return {
      name: answer(draft, FIELD.name).trim(),
      contact: answer(draft, FIELD.contact).trim(),
      usage: Option.match(selection, {
        onNone: () => '',
        onSome: ({ usage }) => USAGE_LABELS[usage],
      }),
      length: Option.match(selection, {
        onNone: () => '',
        onSome: ({ length }) => length,
      }),
      song_details: answer(draft, FIELD.brief).trim(),
      reference_link: answer(draft, FIELD.referenceLink).trim(),
      deadline: answer(draft, FIELD.deadline),
      notes: answer(draft, FIELD.details).trim(),
      agreed: answer(draft, FIELD.agree) === 'yes' ? 'yes' : '',
    }
  },
  quote: draft => Option.map(voiceSelectionOf(draft), quoteVoice),
}

// MODEL

export { Message, Model } from './inquiry'

export const init = (): Model => initInquiry(spec)

export const update = makeUpdate(spec)

// VIEW

const USAGE_CHOICES: ReadonlyArray<Choice> = [
  {
    value: 'Personal',
    label: 'Personal',
    note: 'non-exclusive, Fio may post it',
  },
  {
    value: 'Commercial',
    label: 'Commercial',
    note: 'exclusive, monetized or no-post',
  },
]

const LENGTH_CHOICES: ReadonlyArray<Choice> = [
  { value: 'Short', label: 'Short', note: 'up to 2:00' },
  { value: 'Full', label: 'Full song' },
]

const RULES: ReadonlyArray<string> = [
  'Vocals only, for producers and creators. Fio records and sends clean vocal stems.',
  'No AI training or voice cloning, ever.',
  'A down payment starts the work.',
  'Fio may decline songs that do not fit.',
]

const USAGES: ReadonlyArray<Usage> = ['Personal', 'Commercial']
const LENGTHS: ReadonlyArray<VoiceLength> = ['Short', 'Full']

const priceTable = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('grid gap-3 sm:grid-cols-2')],
    Array.map(USAGES, usage =>
      h.div(
        [h.Class('space-y-1 rounded-lg border border-white/10 bg-white/5 p-3')],
        [
          h.div([h.Class('text-sm font-bold text-white')], [usage]),
          h.div(
            [h.Class('text-xs text-gray-300')],
            [
              usage === 'Personal'
                ? 'Non-exclusive. Fio may post it.'
                : 'Exclusive. Monetized or no-post.',
            ],
          ),
          ...Array.map(LENGTHS, length =>
            h.div(
              [h.Class('flex justify-between gap-3 text-sm text-gray-100')],
              [
                h.span(
                  [],
                  [length === 'Short' ? 'Short, up to 2:00' : 'Full song'],
                ),
                h.span(
                  [h.Class('tabular-nums')],
                  [formatMoney(VOICE_PRICES[usage][length])],
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  )

const STEP_BODIES: Readonly<Record<string, StepBody>> = {
  you: (model, h) => {
    const view = fieldOf(model)
    return [
      textField(
        {
          ...view(FIELD.name, 'Your name', true),
          placeholder: 'How should I call you?',
        },
        h,
      ),
      textField(
        {
          ...view(FIELD.contact, 'Contact (Discord or email)', true),
          placeholder: 'name#0000 or you@mail.com',
        },
        h,
      ),
    ]
  },
  license: (model, h) => {
    const view = fieldOf(model)
    return [
      priceTable(h),
      radioPills(
        { ...view(FIELD.usage, 'Usage', true), options: USAGE_CHOICES },
        h,
      ),
      radioPills(
        { ...view(FIELD.length, 'Song length', true), options: LENGTH_CHOICES },
        h,
      ),
    ]
  },
  song: (model, h) => {
    const view = fieldOf(model)
    return [
      textArea(
        {
          ...view(FIELD.brief, 'Song details', true),
          placeholder:
            'Which song would you like Fio to sing? Include the length if you know it.',
        },
        h,
      ),
      textField(
        {
          ...view(FIELD.referenceLink, 'Reference link'),
          kind: 'url',
          placeholder:
            'Instrumental or reference link (Drive, Dropbox, YouTube)',
          problem: 'Use a full link that starts with https://',
        },
        h,
      ),
      textField(
        { ...view(FIELD.deadline, 'Deadline'), kind: 'date', placeholder: '' },
        h,
      ),
      textArea(
        {
          ...view(FIELD.details, 'Notes'),
          placeholder: 'Key, vibe, tone, anything else',
        },
        h,
      ),
    ]
  },
  terms: (model, h) => [
    h.ul(
      [h.Class('list-disc space-y-1 pl-5 text-sm text-gray-100')],
      Array.map(RULES, rule => h.li([], [rule])),
    ),
    agreeBox(
      {
        ...fieldOf(model)(FIELD.agree, 'Agreement'),
        statement: [
          'I understand pricing depends on length and usage, a ',
          h.b([], ['down payment']),
          ' starts the work, and Fio ',
          h.b([], ['never allows AI training or voice cloning']),
          ' and may ',
          h.b([], ['decline']),
          " songs that don't fit.",
        ],
      },
      h,
    ),
  ],
}

const reviewBody = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const payload = spec.answers(model.draft)
  return [
    reviewList(
      [
        { label: 'Name', value: payload['name'] ?? '' },
        { label: 'Contact', value: payload['contact'] ?? '' },
        { label: 'Usage', value: payload['usage'] ?? '' },
        { label: 'Length', value: payload['length'] ?? '' },
        { label: 'Song details', value: payload['song_details'] ?? '' },
        { label: 'Reference link', value: payload['reference_link'] ?? '' },
        { label: 'Deadline', value: payload['deadline'] ?? '' },
        { label: 'Notes', value: payload['notes'] ?? '' },
      ],
      h,
    ),
  ]
}

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  wizardView(
    {
      page: 'hire',
      heading: "Hire Fio's voice",
      blurb: [
        'Vocals only, for producers and creators. Fio records and sends clean vocal stems. Pick a licence and the estimate follows.',
      ],
      spec,
      model,
      stepBody: step => STEP_BODIES[step.id]?.(model, h) ?? [],
      reviewBody: reviewBody(model, h),
      quote: Option.map(voiceSelectionOf(model.draft), selection =>
        quoteCard(
          quoteVoice(selection),
          'A down payment starts the work. Fio confirms the final price and the payment details.',
          h,
        ),
      ),
      sentNote: 'Fio replies within 1 to 2 days.',
    },
    h,
  ),
)
