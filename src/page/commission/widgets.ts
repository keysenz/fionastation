import { Array, Match, Option } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { hireRouter, radioRouter, studioRouter } from '../../route'
import {
  type FormSpec,
  Message,
  type Model,
  type Step,
  answer,
  isReviewStep,
  listOf,
  stepIndex,
} from './inquiry'
import { type Quote, formatIdr, formatMoney, formatUsd } from './pricing'

const DISCORD = 'fioyo.work'

// FIELDS

export type FieldView = Readonly<{
  field: string
  label: string
  model: Model
  required?: boolean
  problem?: string
}>

const isInvalid = ({ model, field }: FieldView): boolean =>
  model.submission._tag === 'Invalid' && model.submission.fields.includes(field)

const INPUT_CLASS =
  'w-full rounded-lg border bg-black/60 px-3 py-2 text-sm text-white placeholder:text-gray-400 focus:outline-none'

const inputClass = (view: FieldView): string =>
  `${INPUT_CLASS} ${isInvalid(view) ? 'border-red-400' : 'border-white/10 focus:border-[#446e92]'}`

const fieldFrame = (
  view: FieldView,
  control: Html,
  h: HtmlBuilder<Message>,
  asGroup: boolean = false,
): Html => {
  const label = [
    view.label,
    view.required === true
      ? h.span([h.Class('ml-1 text-red-300'), h.AriaHidden(true)], ['*'])
      : h.empty,
  ]
  return h.div(
    [h.Class('space-y-1.5')],
    [
      asGroup
        ? h.div([h.Class('text-sm font-semibold text-gray-100')], label)
        : h.label(
            [
              h.For(`field-${view.field}`),
              h.Class('block text-sm font-semibold text-gray-100'),
            ],
            label,
          ),
      control,
      isInvalid(view)
        ? h.p(
            [h.Class('text-xs text-red-300'), h.Role('alert')],
            [view.problem ?? 'This one needs an answer.'],
          )
        : h.empty,
    ],
  )
}

export const textField = (
  view: FieldView &
    Readonly<{ placeholder: string; kind?: 'text' | 'url' | 'date' }>,
  h: HtmlBuilder<Message>,
): Html =>
  fieldFrame(
    view,
    h.input([
      h.Id(`field-${view.field}`),
      h.Type(view.kind ?? 'text'),
      h.Placeholder(view.placeholder),
      h.Value(answer(view.model.draft, view.field)),
      h.AriaInvalid(isInvalid(view)),
      h.OnInput(value => Message.UpdatedField({ field: view.field, value })),
      h.Class(inputClass(view)),
    ]),
    h,
  )

export const textArea = (
  view: FieldView & Readonly<{ placeholder: string }>,
  h: HtmlBuilder<Message>,
): Html =>
  fieldFrame(
    view,
    h.textarea([
      h.Id(`field-${view.field}`),
      h.Rows(4),
      h.Placeholder(view.placeholder),
      h.Value(answer(view.model.draft, view.field)),
      h.AriaInvalid(isInvalid(view)),
      h.OnInput(value => Message.UpdatedField({ field: view.field, value })),
      h.Class(inputClass(view)),
    ]),
    h,
  )

export type Choice = Readonly<{ value: string; label: string; note?: string }>

export const selectField = (
  view: FieldView & Readonly<{ options: ReadonlyArray<Choice> }>,
  h: HtmlBuilder<Message>,
): Html =>
  fieldFrame(
    view,
    h.select(
      [
        h.Id(`field-${view.field}`),
        h.AriaInvalid(isInvalid(view)),
        h.OnChange(value => Message.UpdatedField({ field: view.field, value })),
        h.Class(inputClass(view)),
      ],
      Array.map(view.options, option =>
        h.option(
          [
            h.Value(option.value),
            h.Selected(answer(view.model.draft, view.field) === option.value),
          ],
          [option.label],
        ),
      ),
    ),
    h,
  )

const pill = (
  input: Readonly<{
    kind: 'radio' | 'checkbox'
    name: string
    option: Choice
    checked: boolean
    onChange: Message
  }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.label(
    [
      h.Class(
        `flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition focus-within:ring-2 focus-within:ring-[#7fb0d8] ${
          input.checked
            ? 'border-[#7fb0d8] bg-[#446e92]/60 text-white'
            : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
        }`,
      ),
    ],
    [
      h.input([
        h.Type(input.kind),
        h.Name(input.name),
        h.Checked(input.checked),
        h.OnClick(input.onChange),
        h.Class('sr-only'),
      ]),
      h.span([], [input.option.label]),
      input.option.note === undefined
        ? h.empty
        : h.span([h.Class('text-xs text-gray-300')], [input.option.note]),
    ],
  )

export const radioPills = (
  view: FieldView & Readonly<{ options: ReadonlyArray<Choice> }>,
  h: HtmlBuilder<Message>,
): Html => {
  const selected = answer(view.model.draft, view.field)
  return fieldFrame(
    view,
    h.div(
      [
        h.Class('flex flex-wrap gap-2'),
        h.Role('radiogroup'),
        h.AriaLabel(view.label),
      ],
      Array.map(view.options, option =>
        pill(
          {
            kind: 'radio',
            name: view.field,
            option,
            checked: selected === option.value,
            onChange: Message.UpdatedField({
              field: view.field,
              value: option.value,
            }),
          },
          h,
        ),
      ),
    ),
    h,
    true,
  )
}

export const checkPills = (
  view: FieldView & Readonly<{ options: ReadonlyArray<Choice> }>,
  h: HtmlBuilder<Message>,
): Html => {
  const selected = listOf(answer(view.model.draft, view.field))
  return fieldFrame(
    view,
    h.div(
      [
        h.Class('flex flex-wrap gap-2'),
        h.Role('group'),
        h.AriaLabel(view.label),
      ],
      Array.map(view.options, option =>
        pill(
          {
            kind: 'checkbox',
            name: view.field,
            option,
            checked: selected.includes(option.value),
            onChange: Message.ToggledChoice({
              field: view.field,
              value: option.value,
            }),
          },
          h,
        ),
      ),
    ),
    h,
    true,
  )
}

export const agreeBox = (
  view: FieldView & Readonly<{ statement: ReadonlyArray<Html | string> }>,
  h: HtmlBuilder<Message>,
): Html => {
  const checked = answer(view.model.draft, view.field) === 'yes'
  return h.div(
    [h.Class('space-y-1.5')],
    [
      h.label(
        [
          h.Class(
            `flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm text-gray-100 ${isInvalid(view) ? 'border-red-400' : 'border-white/10 bg-white/5'}`,
          ),
        ],
        [
          h.input([
            h.Id(`field-${view.field}`),
            h.Type('checkbox'),
            h.Checked(checked),
            h.AriaInvalid(isInvalid(view)),
            h.OnClick(
              Message.UpdatedField({
                field: view.field,
                value: checked ? '' : 'yes',
              }),
            ),
            h.Class('mt-0.5 size-4 shrink-0 accent-[#7fb0d8]'),
          ]),
          h.span([], view.statement),
        ],
      ),
      isInvalid(view)
        ? h.p(
            [h.Class('text-xs text-red-300'), h.Role('alert')],
            ['Tick this to continue.'],
          )
        : h.empty,
    ],
  )
}

export type StepBody = (
  model: Model,
  h: HtmlBuilder<Message>,
) => ReadonlyArray<Html>

export const fieldOf =
  (model: Model) =>
  (field: string, label: string, required: boolean = false) => ({
    field,
    label,
    model,
    required,
  })

// QUOTE

export const quoteCard = (
  quote: Quote,
  note: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.aside(
    [
      h.Class(
        'space-y-3 rounded-xl border border-[#7fb0d8]/40 bg-[#446e92]/20 p-4',
      ),
      h.AriaLive('polite'),
      h.AriaLabel('Price estimate'),
    ],
    [
      h.h2(
        [h.Class('text-sm font-black uppercase tracking-tight text-[#7fb0d8]')],
        ['Your estimate'],
      ),
      Match.value(quote).pipe(
        Match.tag('ByCase', ({ reason }) =>
          h.p(
            [h.Class('text-sm text-gray-100')],
            [`Priced by case. ${reason}`],
          ),
        ),
        Match.tag('Priced', ({ lines, total, deposit }) =>
          h.div(
            [h.Class('space-y-3')],
            [
              h.ul(
                [h.Class('space-y-1.5')],
                Array.map(lines, line =>
                  h.li(
                    [
                      h.Class(
                        'flex justify-between gap-3 text-sm text-gray-100',
                      ),
                    ],
                    [
                      h.span([], [line.label]),
                      h.span(
                        [h.Class('shrink-0 text-right tabular-nums')],
                        [formatMoney(line.amount)],
                      ),
                    ],
                  ),
                ),
              ),
              h.div(
                [h.Class('border-t border-white/15 pt-3')],
                [
                  h.div(
                    [h.Class('flex items-baseline justify-between gap-3')],
                    [
                      h.span(
                        [h.Class('text-sm font-semibold')],
                        ['Estimated total'],
                      ),
                      h.span(
                        [h.Class('text-xl font-black tabular-nums text-fiona')],
                        [formatIdr(total.idr)],
                      ),
                    ],
                  ),
                  h.p(
                    [h.Class('text-right text-sm tabular-nums text-gray-200')],
                    [formatUsd(total.usd)],
                  ),
                  Option.match(deposit, {
                    onNone: () => h.empty,
                    onSome: amount =>
                      h.p(
                        [h.Class('mt-2 text-xs text-gray-200')],
                        [`50% deposit up front: ${formatMoney(amount)}`],
                      ),
                  }),
                ],
              ),
            ],
          ),
        ),
        Match.exhaustive,
      ),
      h.p([h.Class('text-xs text-gray-300')], [note]),
    ],
  )

// REVIEW

export type ReviewRow = Readonly<{ label: string; value: string }>

export const reviewList = (
  rows: ReadonlyArray<ReviewRow>,
  h: HtmlBuilder<Message>,
): Html =>
  h.dl(
    [h.Class('divide-y divide-white/10 rounded-lg border border-white/10')],
    Array.flatMap(rows, row => [
      h.div(
        [h.Class('grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4')],
        [
          h.dt(
            [h.Class('text-xs uppercase tracking-wide text-gray-300')],
            [row.label],
          ),
          h.dd(
            [h.Class('whitespace-pre-line break-words text-sm text-white')],
            [row.value === '' ? 'Not given' : row.value],
          ),
        ],
      ),
    ]),
  )

// WIZARD

type CommissionPage = 'hire' | 'studio'

const NAV_LINKS: ReadonlyArray<
  Readonly<{ page: CommissionPage; label: string; href: string }>
> = [
  { page: 'hire', label: "Hire Fio's voice", href: hireRouter() },
  { page: 'studio', label: 'Paopoa Studio', href: studioRouter() },
]

const commissionNav = (
  current: CommissionPage,
  h: HtmlBuilder<Message>,
): Html =>
  h.nav(
    [h.AriaLabel('Commissions'), h.Class('flex flex-wrap gap-2')],
    Array.map(NAV_LINKS, link =>
      h.a(
        [
          h.Href(link.href),
          ...(link.page === current ? [h.AriaCurrent('page')] : []),
          h.Class(
            `flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${
              link.page === current
                ? 'border-[#7fb0d8] bg-[#446e92]/60 text-white'
                : 'border-white/15 bg-white/10 text-gray-100 hover:bg-white/20'
            }`,
          ),
        ],
        [link.label],
      ),
    ),
  )

const stepper = (
  spec: FormSpec,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const currentIndex = stepIndex(spec, model.step)
  return h.ol(
    [h.AriaLabel('Progress'), h.Class('flex flex-wrap gap-x-4 gap-y-1')],
    Array.map(spec.steps, (step, index) =>
      h.li(
        [
          ...(index === currentIndex ? [h.AriaCurrent('step')] : []),
          h.Class(
            `flex items-center gap-1.5 text-xs font-semibold ${index === currentIndex ? 'text-white' : index < currentIndex ? 'text-[#7fb0d8]' : 'text-gray-400'}`,
          ),
        ],
        [
          h.span(
            [
              h.Class(
                `flex size-5 items-center justify-center rounded-full text-[0.7rem] ${index === currentIndex ? 'bg-[#446e92] text-white' : 'bg-white/10'}`,
              ),
            ],
            [`${index + 1}`],
          ),
          step.title,
        ],
      ),
    ),
  )
}

const banner = (
  submission: Model['submission'],
  h: HtmlBuilder<Message>,
): Html =>
  Match.value(submission).pipe(
    Match.tag('Invalid', () =>
      h.p(
        [
          h.Role('alert'),
          h.Class(
            'rounded-lg border border-red-400/60 bg-red-950/40 p-3 text-sm text-red-100',
          ),
        ],
        ['Some answers need another look. They are marked below.'],
      ),
    ),
    Match.tag('Failed', ({ error }) =>
      h.p(
        [
          h.Role('alert'),
          h.Class(
            'rounded-lg border border-red-400/60 bg-red-950/40 p-3 text-sm text-red-100',
          ),
        ],
        [error, ' Your answers are still here.'],
      ),
    ),
    Match.orElse(() => h.empty),
  )

const buttonClass = (primary: boolean): string =>
  `flex min-h-10 items-center justify-center rounded-full px-5 text-sm font-semibold transition disabled:opacity-60 ${
    primary
      ? 'bg-[#446e92] text-white hover:bg-[#557fa3]'
      : 'border border-white/15 bg-white/10 text-gray-100 hover:bg-white/20'
  }`

const footer = (
  spec: FormSpec,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const isSending = model.submission._tag === 'Sending'
  const isFirst = stepIndex(spec, model.step) === 0
  return h.div(
    [h.Class('flex items-center justify-between gap-3 pt-2')],
    [
      isFirst
        ? h.span([])
        : h.button(
            [
              h.Type('button'),
              h.Disabled(isSending),
              h.OnClick(Message.ClickedBack()),
              h.Class(buttonClass(false)),
            ],
            ['Back'],
          ),
      h.button(
        [h.Type('submit'), h.Disabled(isSending), h.Class(buttonClass(true))],
        [
          isReviewStep(spec, model.step)
            ? isSending
              ? 'Sending...'
              : 'Send inquiry'
            : 'Next',
        ],
      ),
    ],
  )
}

export type WizardView = Readonly<{
  page: CommissionPage
  heading: string
  blurb: ReadonlyArray<Html | string>
  spec: FormSpec
  model: Model
  stepBody: (step: Step) => ReadonlyArray<Html>
  reviewBody: ReadonlyArray<Html>
  quote: Option.Option<Html>
  sentNote: string
}>

const sentView = (props: WizardView, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('space-y-4 py-6 text-center'), h.Role('status')],
    [
      h.h2(
        [h.Class('text-xl font-black text-[#7fb0d8]')],
        ['Sent! Talk soon.'],
      ),
      h.p([h.Class('text-sm text-gray-100')], [props.sentNote]),
      h.div(
        [h.Class('flex flex-wrap justify-center gap-3')],
        [
          h.button(
            [
              h.Type('button'),
              h.OnClick(Message.ClickedStartOver()),
              h.Class(buttonClass(false)),
            ],
            ['Send another'],
          ),
          h.a(
            [h.Href(radioRouter()), h.Class(buttonClass(true))],
            ['Back to Fio Radio'],
          ),
        ],
      ),
    ],
  )

const formView = (props: WizardView, h: HtmlBuilder<Message>): Html => {
  const { spec, model } = props
  const step = spec.steps[stepIndex(spec, model.step)]
  const isReview = isReviewStep(spec, model.step)
  return h.form(
    [
      h.OnSubmit(isReview ? Message.ClickedSend() : Message.ClickedNext()),
      h.Class('space-y-4'),
    ],
    [
      h.h2(
        [h.Class('text-lg font-black uppercase tracking-tight text-[#7fb0d8]')],
        [step?.title ?? ''],
      ),
      banner(model.submission, h),
      ...(isReview
        ? props.reviewBody
        : step === undefined
          ? []
          : props.stepBody(step)),
      footer(spec, model, h),
    ],
  )
}

export const wizardView = (props: WizardView, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Class('w-full grow px-4 py-4')],
    [
      h.div(
        [
          h.Class(
            'mx-auto max-w-4xl space-y-5 rounded-xl border border-white/10 bg-black/75 p-5 text-white shadow-2xl backdrop-blur-xl',
          ),
        ],
        [
          h.div(
            [h.Class('flex flex-wrap items-center justify-between gap-3')],
            [
              h.h1(
                [
                  h.Class(
                    'text-2xl font-black uppercase tracking-tight text-[#7fb0d8]',
                  ),
                ],
                [props.heading],
              ),
              h.a(
                [
                  h.Href(radioRouter()),
                  h.Class(
                    'flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 text-sm font-semibold hover:bg-white/20',
                  ),
                ],
                [
                  h.i([h.Class('fas fa-radio'), h.AriaHidden(true)]),
                  'Fio Radio',
                ],
              ),
            ],
          ),
          commissionNav(props.page, h),
          h.div([h.Class('space-y-2 text-sm text-gray-100')], props.blurb),
          props.model.submission._tag === 'Sent'
            ? sentView(props, h)
            : h.div(
                [h.Class('space-y-4')],
                [
                  stepper(props.spec, props.model, h),
                  h.div(
                    [
                      h.Class(
                        'grid items-start gap-5 lg:grid-cols-[1fr_20rem]',
                      ),
                    ],
                    [
                      formView(props, h),
                      Option.match(props.quote, {
                        onNone: () => h.empty,
                        onSome: quote =>
                          h.div(
                            [
                              h.Class(
                                'order-first lg:sticky lg:top-4 lg:order-last',
                              ),
                            ],
                            [quote],
                          ),
                      }),
                    ],
                  ),
                ],
              ),
          h.p(
            [h.Class('text-center text-xs text-gray-300')],
            [`Prefer to chat first? DM Fio on Discord: ${DISCORD}`],
          ),
        ],
      ),
    ],
  )
