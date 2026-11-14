import { Array, Option, Schema } from 'effect'
import { Submodel } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import {
  Agreed,
  type Draft,
  type FormSpec,
  Link,
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
  ADD_ONS,
  type AddOn,
  type AddOnId,
  DEPOSIT_THRESHOLD,
  STUDIO_PRICES,
  type Service,
  type StudioSelection,
  TRACKS_INCLUDED,
  formatIdr,
  formatMoney,
  quoteStudio,
} from './pricing'
import {
  type Choice,
  type StepBody,
  agreeBox,
  checkPills,
  fieldOf,
  quoteCard,
  radioPills,
  reviewList,
  selectField,
  textArea,
  textField,
  wizardView,
} from './widgets'

// SPEC

const FIELD = {
  name: 'name',
  contact: 'contact',
  song: 'song',
  service: 'service',
  length: 'length',
  tracks: 'tracks',
  singers: 'singers',
  addOns: 'add_ons',
  vocalLink: 'vocal_link',
  deadline: 'deadline',
  complexity: 'complexity',
  firstCommission: 'first_commission',
  details: 'details',
  agree: 'agree',
}

const STEPS: ReadonlyArray<Step> = [
  { id: 'you', title: 'About you', fields: [FIELD.name, FIELD.contact] },
  { id: 'cover', title: 'Your cover', fields: [FIELD.song, FIELD.vocalLink] },
  {
    id: 'service',
    title: 'Service',
    fields: [
      FIELD.service,
      FIELD.length,
      FIELD.tracks,
      FIELD.singers,
      FIELD.addOns,
    ],
  },
  {
    id: 'options',
    title: 'Timing',
    fields: [FIELD.deadline, FIELD.complexity, FIELD.firstCommission],
  },
  {
    id: 'notes',
    title: 'Notes and terms',
    fields: [FIELD.details, FIELD.agree],
  },
  { id: 'review', title: 'Review and send', fields: [] },
]

const ServiceChoice = Schema.Literals([
  'Full Production',
  'Mix & Master',
  'Tuning Only',
])
const LengthChoice = Schema.Literals(['Short', 'Standard', 'Long'])
const TRACK_COUNTS: ReadonlyArray<number> = Array.makeBy(10, index => index + 1)
const TracksChoice = Schema.Literals(
  Array.map(TRACK_COUNTS, count => `${count}`),
)
const SingersChoice = Schema.Literals(['1', '2', '3', '4'])
const DeadlineChoice = Schema.Literals(['rush', 'regular'])
const Toggle = Schema.Literals(['', 'yes'])

const CHOSEN_ADD_ONS: ReadonlyArray<AddOn> = Array.filter(
  ADD_ONS,
  addOn => addOn.chosenByClient,
)

const addOnIdsOf = (draft: Draft): ReadonlyArray<AddOnId> => {
  const chosen = listOf(answer(draft, FIELD.addOns))
  return Array.map(
    Array.filter(CHOSEN_ADD_ONS, addOn => chosen.includes(addOn.id)),
    addOn => addOn.id,
  )
}

export const studioSelectionOf = (
  draft: Draft,
): Option.Option<StudioSelection> =>
  Option.all({
    service: Schema.decodeUnknownOption(ServiceChoice)(
      answer(draft, FIELD.service),
    ),
    length: Schema.decodeUnknownOption(LengthChoice)(
      answer(draft, FIELD.length),
    ),
    tracks: Option.map(
      Schema.decodeOption(TracksChoice)(answer(draft, FIELD.tracks)),
      Number,
    ),
    singers: Option.map(
      Schema.decodeUnknownOption(SingersChoice)(answer(draft, FIELD.singers)),
      Number,
    ),
  }).pipe(
    Option.map(picked => ({
      ...picked,
      addOns: addOnIdsOf(draft),
      extraComplexity: answer(draft, FIELD.complexity) === 'yes',
      rush: answer(draft, FIELD.deadline) === 'rush',
      firstCommission: answer(draft, FIELD.firstCommission) === 'yes',
    })),
  )

const SINGER_LABELS: Readonly<Record<string, string>> = {
  '1': 'Solo (1)',
  '2': 'Duet (2)',
  '3': 'Group (3)',
  '4': 'Group (4+)',
}

const addOnLabels = (draft: Draft): string =>
  Array.map(
    addOnIdsOf(draft),
    id => ADD_ONS.find(addOn => addOn.id === id)?.label ?? id,
  ).join(', ')

export const spec: FormSpec = {
  steps: STEPS,
  rules: {
    [FIELD.name]: NonEmpty,
    [FIELD.contact]: NonEmpty,
    [FIELD.song]: NonEmpty,
    [FIELD.service]: ServiceChoice,
    [FIELD.length]: LengthChoice,
    [FIELD.tracks]: TracksChoice,
    [FIELD.singers]: SingersChoice,
    [FIELD.addOns]: Schema.String,
    [FIELD.vocalLink]: Link,
    [FIELD.deadline]: DeadlineChoice,
    [FIELD.complexity]: Toggle,
    [FIELD.firstCommission]: Toggle,
    [FIELD.details]: NonEmpty,
    [FIELD.agree]: Agreed,
  },
  initialDraft: {
    [FIELD.name]: '',
    [FIELD.contact]: '',
    [FIELD.song]: '',
    [FIELD.service]: '',
    [FIELD.length]: '',
    [FIELD.tracks]: '1',
    [FIELD.singers]: '1',
    [FIELD.addOns]: '',
    [FIELD.vocalLink]: '',
    [FIELD.deadline]: '',
    [FIELD.complexity]: '',
    [FIELD.firstCommission]: '',
    [FIELD.details]: '',
    [FIELD.agree]: '',
  },
  kind: 'studio',
  answers: draft => ({
    name: answer(draft, FIELD.name).trim(),
    contact: answer(draft, FIELD.contact).trim(),
    song: answer(draft, FIELD.song).trim(),
    service: answer(draft, FIELD.service),
    cover_length: answer(draft, FIELD.length),
    tracks: answer(draft, FIELD.tracks),
    singers: SINGER_LABELS[answer(draft, FIELD.singers)] ?? '',
    add_ons: addOnLabels(draft),
    vocal_link: answer(draft, FIELD.vocalLink).trim(),
    deadline:
      answer(draft, FIELD.deadline) === 'rush'
        ? '1-3 days (rush)'
        : answer(draft, FIELD.deadline) === 'regular'
          ? '4-7 days (regular)'
          : '',
    extra_complexity: answer(draft, FIELD.complexity) === 'yes' ? 'yes' : 'no',
    first_commission:
      answer(draft, FIELD.firstCommission) === 'yes' ? 'yes' : 'no',
    notes: answer(draft, FIELD.details).trim(),
    agreed: answer(draft, FIELD.agree) === 'yes' ? 'yes' : '',
  }),
  quote: draft => Option.map(studioSelectionOf(draft), quoteStudio),
}

// MODEL

export { Message, Model } from './inquiry'

export const init = (): Model => initInquiry(spec)

export const update = makeUpdate(spec)

// VIEW

export const QUEUE_URL =
  'https://docs.google.com/spreadsheets/d/1pmCewJOKmFbvdDtTVqU15SC3TQP4enBwfvpuNMv9J7o/edit?usp=sharing'

const PROCESS: ReadonlyArray<Readonly<{ title: string; note: string }>> = [
  {
    title: 'Reach out',
    note: 'Contact Fio directly and send this form.',
  },
  {
    title: 'Confirmation and invoice',
    note: 'Fio confirms the details and sends your invoice.',
  },
  {
    title: 'Preview mix',
    note: 'A short preview so you can hear the direction.',
  },
  { title: 'Draft mix', note: 'The full mix, ready for your feedback.' },
  {
    title: 'Revision',
    note: 'Tweaks until it feels right, up to 2 revisions.',
  },
  { title: 'Final mix', note: 'Polished master delivered.' },
]

const SERVICE_CHOICES: ReadonlyArray<Choice> = [
  {
    value: 'Full Production',
    label: 'Full Production',
    note: 'time, tune, mix, master',
  },
  {
    value: 'Mix & Master',
    label: 'Mix & Master',
    note: 'already tuned and timed',
  },
  {
    value: 'Tuning Only',
    label: 'Tuning Only',
    note: 'pitch fixes, per track',
  },
]

const LENGTH_CHOICES: ReadonlyArray<Choice> = [
  { value: 'Short', label: 'Short', note: 'under 90s' },
  { value: 'Standard', label: 'Standard', note: '91 to 300s' },
  { value: 'Long', label: 'Long', note: 'over 300s, by case' },
]

const TRACK_OPTIONS: ReadonlyArray<Choice> = Array.map(TRACK_COUNTS, count => ({
  value: `${count}`,
  label: `${count} ${count === 1 ? 'track' : 'tracks'}`,
}))

const SINGER_OPTIONS: ReadonlyArray<Choice> = [
  { value: '1', label: 'Solo (1)' },
  { value: '2', label: 'Duet (2), 1 extra vocalist' },
  { value: '3', label: 'Group (3), 2 extra vocalists' },
  { value: '4', label: 'Group (4+), at least 3 extra vocalists' },
]

const DEADLINE_CHOICES: ReadonlyArray<Choice> = [
  { value: 'rush', label: 'Rush', note: '1 to 3 days, +50%' },
  { value: 'regular', label: 'Regular', note: '4 to 7 days' },
]

const PER_LABELS: Readonly<Record<AddOn['per'], string>> = {
  project: '',
  track: ' per track',
  person: ' per person',
}

const addOnChoices = (service: Option.Option<Service>): ReadonlyArray<Choice> =>
  Array.map(
    Array.filter(CHOSEN_ADD_ONS, addOn =>
      Option.match(service, {
        onNone: () => true,
        onSome: picked => addOn.services.includes(picked),
      }),
    ),
    addOn => ({
      value: addOn.id,
      label: addOn.label,
      note: `+${formatMoney(addOn.price)}${PER_LABELS[addOn.per]}`,
    }),
  )

const priceOverview = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('grid gap-2 sm:grid-cols-3')],
    Array.map(
      [
        'Full Production',
        'Mix & Master',
        'Tuning Only',
      ] satisfies ReadonlyArray<Service>,
      service =>
        h.div(
          [
            h.Class(
              'space-y-1 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-gray-100',
            ),
          ],
          [
            h.div([h.Class('text-sm font-bold text-white')], [service]),
            ...Array.map(
              ['Short', 'Standard'] satisfies ReadonlyArray<
                'Short' | 'Standard'
              >,
              length =>
                h.div(
                  [h.Class('flex justify-between gap-2')],
                  [
                    h.span([], [length]),
                    h.span(
                      [h.Class('tabular-nums')],
                      [formatMoney(STUDIO_PRICES[service][length].base)],
                    ),
                  ],
                ),
            ),
            h.div(
              [h.Class('text-gray-300')],
              [
                service === 'Tuning Only'
                  ? 'Per track. Long covers by case.'
                  : `Up to ${TRACKS_INCLUDED} tracks. Extra tracks add on. Long covers by case.`,
              ],
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
  cover: (model, h) => {
    const view = fieldOf(model)
    return [
      textField(
        {
          ...view(FIELD.song, 'Song and original artist', true),
          placeholder: 'e.g. Gurenge - LiSA',
        },
        h,
      ),
      textField(
        {
          ...view(
            FIELD.vocalLink,
            'Vocal and instrumental or karaoke files link',
            true,
          ),
          kind: 'url',
          placeholder: 'Drive, Dropbox or WeTransfer link to your files',
          problem: 'Use a full link that starts with https://',
        },
        h,
      ),
    ]
  },
  service: (model, h) => {
    const view = fieldOf(model)
    return [
      priceOverview(h),
      radioPills(
        { ...view(FIELD.service, 'Service', true), options: SERVICE_CHOICES },
        h,
      ),
      radioPills(
        {
          ...view(FIELD.length, 'Cover length', true),
          options: LENGTH_CHOICES,
        },
        h,
      ),
      selectField(
        {
          ...view(FIELD.tracks, 'Number of vocal tracks'),
          options: TRACK_OPTIONS,
        },
        h,
      ),
      selectField(
        {
          ...view(FIELD.singers, 'Number of singers'),
          options: SINGER_OPTIONS,
        },
        h,
      ),
      checkPills(
        {
          ...view(FIELD.addOns, 'Add-ons and vocal support'),
          options: addOnChoices(
            Option.map(studioSelectionOf(model.draft), pick => pick.service),
          ),
        },
        h,
      ),
    ]
  },
  options: (model, h) => {
    const view = fieldOf(model)
    return [
      radioPills(
        {
          ...view(FIELD.deadline, 'Deadline', true),
          options: DEADLINE_CHOICES,
        },
        h,
      ),
      checkPills(
        {
          ...view(FIELD.complexity, 'Extra complexity'),
          options: [
            {
              value: 'yes',
              label:
                'Dense harmony (4+ stacks) or heavy FX and manual tweaking',
              note: '+25%',
            },
          ],
        },
        h,
      ),
      checkPills(
        {
          ...view(FIELD.firstCommission, 'Intro price'),
          options: [
            {
              value: 'yes',
              label: 'This is my first commission',
              note: '25% off',
            },
          ],
        },
        h,
      ),
    ]
  },
  notes: (model, h) => [
    textArea(
      {
        ...fieldOf(model)(FIELD.details, 'Reference and notes', true),
        placeholder:
          'Reference track, vibe you want, BPM or key, anything else',
      },
      h,
    ),
    agreeBox(
      {
        ...fieldOf(model)(FIELD.agree, 'Agreement'),
        statement: [
          "I've read the ",
          h.b([], ['recording and submission guide']),
          ' and understand the terms: max ',
          h.b([], ['2 revisions']),
          ', ',
          h.b([], ['50% deposit']),
          ` on invoices over ${formatMoney(DEPOSIT_THRESHOLD)}, and that Fio may request a `,
          h.b([], ['vocal retake']),
          ' after QC.',
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
  const fields = spec.answers(model.draft)
  const row = (label: string, key: string) => ({
    label,
    value: fields[key] ?? '',
  })
  return [
    reviewList(
      [
        row('Name', 'name'),
        row('Contact', 'contact'),
        row('Song', 'song'),
        row('Service', 'service'),
        row('Cover length', 'cover_length'),
        row('Vocal tracks', 'tracks'),
        row('Singers', 'singers'),
        row('Add-ons', 'add_ons'),
        row('Files link', 'vocal_link'),
        row('Deadline', 'deadline'),
        row('Extra complexity', 'extra_complexity'),
        row('First commission', 'first_commission'),
        row('Notes', 'notes'),
      ],
      h,
    ),
  ]
}

const blurb = (h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.p(
    [],
    [
      'Your cover song production partner. Paopoa Studio helps creators make their vocals and songs clean, warm and stream-ready. Recording quality matters, since mixing cannot fully fix a noisy, distorted or muffled take.',
    ],
  ),
  h.a(
    [
      h.Href(QUEUE_URL),
      h.Target('_blank'),
      h.Rel('noopener noreferrer'),
      h.Class(
        'inline-flex items-center gap-2 font-semibold text-[#7fb0d8] underline',
      ),
    ],
    [
      h.i([h.Class('fas fa-table-list'), h.AriaHidden(true)]),
      'Commission Queue',
    ],
  ),
  h.details(
    [h.Class('rounded-lg border border-white/10 bg-white/5 p-3')],
    [
      h.summary([h.Class('cursor-pointer font-semibold')], ['How it works']),
      h.ol(
        [h.Class('mt-2 list-decimal space-y-1 pl-5 text-xs text-gray-200')],
        Array.map(PROCESS, item =>
          h.li([], [h.b([], [item.title]), `: ${item.note}`]),
        ),
      ),
      h.p(
        [h.Class('mt-2 text-xs text-gray-300')],
        [
          `Delivery takes 4 to 7 days, or 1 to 3 days for rush. Invoices over ${formatIdr(DEPOSIT_THRESHOLD.idr)} need a 50% deposit.`,
        ],
      ),
    ],
  ),
]

export const view = Submodel.defineView<Model, Message>((model, h): Html =>
  wizardView(
    {
      page: 'studio',
      heading: 'Paopoa Studio',
      blurb: blurb(h),
      spec,
      model,
      stepBody: step => STEP_BODIES[step.id]?.(model, h) ?? [],
      reviewBody: reviewBody(model, h),
      quote: Option.map(studioSelectionOf(model.draft), pick =>
        quoteCard(
          quoteStudio(pick),
          'An estimate only. Extra complexity and rush add to the subtotal, then the intro discount comes off. Fio confirms the final invoice.',
          h,
        ),
      ),
      sentNote:
        'Fio replies within 1 to 2 days to confirm details and send your invoice.',
    },
    h,
  ),
)
