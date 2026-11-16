/* oxlint-disable foldkit/no-child-message-construction-in-root */
import { Array, Option, pipe } from 'effect'

import { Message } from './karaoke.ts'

export type TargetKind = 'TextEntry' | 'Control' | 'Other'

export type KeyPress = Readonly<{
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat: boolean
  defaultPrevented: boolean
  target: TargetKind
}>

type Chord = Readonly<{ key: string; withShift: boolean }>

type Shortcut = Readonly<{
  label: string
  chords: ReadonlyArray<Chord>
  message: () => Message
  canRepeat: boolean
}>

const plain = (key: string): Chord => ({ key, withShift: false })
const shifted = (key: string): Chord => ({ key, withShift: true })

export const shortcuts: ReadonlyArray<Shortcut> = [
  {
    label: 'Play or pause',
    chords: [plain(' '), plain(';')],
    message: () => Message.ClickedPlayPause(),
    canRepeat: false,
  },
  {
    label: 'Next song',
    chords: [plain('j'), plain('N')],
    message: () => Message.ClickedNext(),
    canRepeat: false,
  },
  {
    label: 'Previous song',
    chords: [plain('k'), plain('P')],
    message: () => Message.ClickedPrevious(),
    canRepeat: false,
  },
  {
    label: 'Forward 10 seconds',
    chords: [plain('l'), shifted('ArrowRight')],
    message: () => Message.PressedSeekKey({ by: 10 }),
    canRepeat: true,
  },
  {
    label: 'Back 10 seconds',
    chords: [plain('h'), shifted('ArrowLeft')],
    message: () => Message.PressedSeekKey({ by: -10 }),
    canRepeat: true,
  },
  {
    label: 'Cycle repeat',
    chords: [plain('r')],
    message: () => Message.ClickedCycleRepeat(),
    canRepeat: false,
  },
  {
    label: 'Volume up',
    chords: [plain('=')],
    message: () => Message.PressedVolumeKey({ by: 10 }),
    canRepeat: true,
  },
  {
    label: 'Volume down',
    chords: [plain('-')],
    message: () => Message.PressedVolumeKey({ by: -10 }),
    canRepeat: true,
  },
  {
    label: 'Mute or unmute',
    chords: [plain('m')],
    message: () => Message.ClickedToggleMute(),
    canRepeat: false,
  },
  {
    label: 'Show or hide the queue',
    chords: [plain('q')],
    message: () => Message.ClickedQueueHandle(),
    canRepeat: false,
  },
  {
    label: 'Search songs',
    chords: [plain('/')],
    message: () => Message.PressedSearchKey(),
    canRepeat: false,
  },
  {
    label: 'About and keyboard shortcuts',
    chords: [plain('?')],
    message: () => Message.ClickedToggleInfo(),
    canRepeat: false,
  },
]

const matches = (chord: Chord, press: KeyPress): boolean =>
  press.key === chord.key &&
  (chord.key.length === 1 || press.shiftKey === chord.withShift)

const staysNativeOnControl = (press: KeyPress): boolean =>
  press.target === 'Control' &&
  (press.key === ' ' || press.key.startsWith('Arrow'))

export const decideShortcut = (press: KeyPress): Option.Option<Message> => {
  if (
    press.ctrlKey ||
    press.metaKey ||
    press.altKey ||
    press.defaultPrevented ||
    press.target === 'TextEntry' ||
    staysNativeOnControl(press)
  ) {
    return Option.none()
  }
  return pipe(
    shortcuts,
    Array.findFirst(({ chords }) =>
      chords.some(chord => matches(chord, press)),
    ),
    Option.filter(({ canRepeat }) => canRepeat || !press.repeat),
    Option.map(({ message }) => message()),
  )
}

const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
])

const CONTROL_SELECTOR =
  'button, a[href], summary, input[type="range"], input[type="checkbox"], input[type="radio"], [role="button"], [role="slider"], [role="switch"]'

export const targetKindOf = (target: EventTarget | null): TargetKind => {
  if (!(target instanceof Element)) {
    return 'Other'
  }
  if (
    (target instanceof HTMLInputElement &&
      TEXT_ENTRY_INPUT_TYPES.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return 'TextEntry'
  }
  return target.closest(CONTROL_SELECTOR) === null ? 'Other' : 'Control'
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowRight: '→',
  ArrowLeft: '←',
}

const isUpperCaseLetter = (key: string): boolean =>
  key.length === 1 && key !== key.toLowerCase()

const keysOf = ({ key, withShift }: Chord): ReadonlyArray<string> => {
  const name = KEY_NAMES[key] ?? key
  return withShift || isUpperCaseLetter(key) ? ['Shift', name] : [name]
}

export type ShortcutHelp = Readonly<{
  label: string
  alternatives: ReadonlyArray<ReadonlyArray<string>>
}>

export const shortcutHelp: ReadonlyArray<ShortcutHelp> = shortcuts.map(
  ({ label, chords }) => ({ label, alternatives: chords.map(keysOf) }),
)

const ariaKeyOf = ({ key, withShift }: Chord): string => {
  const name = key === ' ' ? 'Space' : key
  return withShift || isUpperCaseLetter(key) ? `Shift+${name}` : name
}

export const ariaKeyShortcutsOf = (tag: Message['_tag']): string =>
  pipe(
    shortcuts,
    Array.filter(({ message }) => message()._tag === tag),
    Array.flatMap(({ chords }) => chords.map(ariaKeyOf)),
    Array.join(' '),
  )
