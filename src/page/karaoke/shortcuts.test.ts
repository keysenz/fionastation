import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type KeyPress,
  type TargetKind,
  ariaKeyShortcutsOf,
  decideShortcut,
  shortcutHelp,
  shortcuts,
  targetKindOf,
} from './shortcuts.ts'

const press = (key: string, rest: Partial<KeyPress> = {}): KeyPress => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  defaultPrevented: false,
  target: 'Other',
  ...rest,
})

const decided = (key: string, rest: Partial<KeyPress> = {}) =>
  Option.map(decideShortcut(press(key, rest)), message =>
    message._tag === 'PressedSeekKey' || message._tag === 'PressedVolumeKey'
      ? `${message._tag}:${message.by}`
      : message._tag,
  )

describe('bindings', () => {
  test.each([
    [' ', {}, 'ClickedPlayPause'],
    [';', {}, 'ClickedPlayPause'],
    ['j', {}, 'ClickedNext'],
    ['N', { shiftKey: true }, 'ClickedNext'],
    ['k', {}, 'ClickedPrevious'],
    ['P', { shiftKey: true }, 'ClickedPrevious'],
    ['l', {}, 'PressedSeekKey:10'],
    ['ArrowRight', { shiftKey: true }, 'PressedSeekKey:10'],
    ['h', {}, 'PressedSeekKey:-10'],
    ['ArrowLeft', { shiftKey: true }, 'PressedSeekKey:-10'],
    ['r', {}, 'ClickedCycleRepeat'],
    ['=', {}, 'PressedVolumeKey:10'],
    ['-', {}, 'PressedVolumeKey:-10'],
    ['m', {}, 'ClickedToggleMute'],
    ['q', {}, 'ClickedQueueHandle'],
    ['/', {}, 'PressedSearchKey'],
    ['?', { shiftKey: true }, 'ClickedToggleInfo'],
  ] satisfies ReadonlyArray<[string, Partial<KeyPress>, string]>)(
    '%s decides %s',
    (key, rest, tag) => {
      expect(decided(key, rest)).toEqual(Option.some(tag))
    },
  )

  test('a bare arrow key is not bound', () => {
    expect(decided('ArrowRight')).toEqual(Option.none())
    expect(decided('ArrowLeft')).toEqual(Option.none())
    expect(decided('ArrowUp')).toEqual(Option.none())
    expect(decided('ArrowDown')).toEqual(Option.none())
  })

  test('a key with no binding decides nothing', () => {
    expect(decided('s')).toEqual(Option.none())
    expect(decided('Enter')).toEqual(Option.none())
    expect(decided('Escape')).toEqual(Option.none())
  })

  test('a letter key with Shift held is another key, so Shift+j is not next', () => {
    expect(decided('J', { shiftKey: true })).toEqual(Option.none())
  })

  test('every chord in the table decides its own entry and no chord is shared', () => {
    const seen = new Set<string>()
    shortcuts.forEach(entry => {
      entry.chords.forEach(chord => {
        const id = `${chord.key}|${chord.withShift}`
        expect(seen.has(id)).toBe(false)
        seen.add(id)
        const result = decideShortcut(
          press(chord.key, { shiftKey: chord.withShift }),
        )
        expect(Option.map(result, ({ _tag }) => _tag)).toEqual(
          Option.some(entry.message()._tag),
        )
      })
    })
  })
})

describe('guards', () => {
  test.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'ignores a key with %s held',
    modifier => {
      expect(decided('j', { [modifier]: true })).toEqual(Option.none())
      expect(decided(' ', { [modifier]: true })).toEqual(Option.none())
    },
  )

  test('ignores a key another handler already handled', () => {
    expect(decided('j', { defaultPrevented: true })).toEqual(Option.none())
  })

  test('ignores every key while typing in a text field', () => {
    shortcuts.forEach(({ chords }) =>
      chords.forEach(({ key, withShift }) =>
        expect(
          decided(key, { shiftKey: withShift, target: 'TextEntry' }),
        ).toEqual(Option.none()),
      ),
    )
  })

  test('leaves Space to a focused control', () => {
    expect(decided(' ', { target: 'Control' })).toEqual(Option.none())
    expect(decided(' ', { target: 'Other' })).toEqual(
      Option.some('ClickedPlayPause'),
    )
  })

  test('leaves Shift+Arrow to a focused control', () => {
    expect(
      decided('ArrowRight', { shiftKey: true, target: 'Control' }),
    ).toEqual(Option.none())
    expect(
      decided('ArrowLeft', { shiftKey: true, target: 'Control' }),
    ).toEqual(Option.none())
  })

  test('other keys still work with a control focused', () => {
    expect(decided('j', { target: 'Control' })).toEqual(
      Option.some('ClickedNext'),
    )
    expect(decided('l', { target: 'Control' })).toEqual(
      Option.some('PressedSeekKey:10'),
    )
    expect(decided('m', { target: 'Control' })).toEqual(
      Option.some('ClickedToggleMute'),
    )
  })

  test.each([
    ' ',
    ';',
    'j',
    'N',
    'k',
    'P',
    'r',
    'm',
    'q',
    '/',
    '?',
  ])('a held %s does not repeat', key => {
    expect(decided(key, { repeat: true })).toEqual(Option.none())
  })

  test.each([
    ['=', 'PressedVolumeKey:10'],
    ['-', 'PressedVolumeKey:-10'],
    ['h', 'PressedSeekKey:-10'],
    ['l', 'PressedSeekKey:10'],
  ])('a held %s repeats', (key, tag) => {
    expect(decided(key, { repeat: true })).toEqual(Option.some(tag))
  })

  test('a held Shift+Arrow repeats like the letter it mirrors', () => {
    expect(decided('ArrowRight', { shiftKey: true, repeat: true })).toEqual(
      Option.some('PressedSeekKey:10'),
    )
  })
})

describe('target kinds', () => {
  const kindOf = (html: string, selector: string): TargetKind => {
    document.body.innerHTML = html
    return targetKindOf(document.querySelector(selector))
  }

  test.each([
    ['<input type="text">', 'input'],
    ['<input>', 'input'],
    ['<input type="search">', 'input'],
    ['<textarea></textarea>', 'textarea'],
    ['<select><option>a</option></select>', 'select'],
    ['<div contenteditable="true">x</div>', 'div'],
  ])('%s is text entry', (html, selector) => {
    expect(kindOf(html, selector)).toBe('TextEntry')
  })

  test.each([
    ['<button>x</button>', 'button'],
    ['<button><i>x</i></button>', 'i'],
    ['<a href="/x">x</a>', 'a'],
    ['<details><summary>x</summary></details>', 'summary'],
    ['<input type="range">', 'input'],
    ['<div role="slider" tabindex="0"></div>', 'div'],
    ['<div role="button" tabindex="0"></div>', 'div'],
  ])('%s is a control', (html, selector) => {
    expect(kindOf(html, selector)).toBe('Control')
  })

  test('the page body and plain elements are other', () => {
    expect(kindOf('<p>x</p>', 'p')).toBe('Other')
    expect(targetKindOf(document.body)).toBe('Other')
    expect(targetKindOf(null)).toBe('Other')
    expect(targetKindOf(window)).toBe('Other')
  })
})

describe('derived views of the table', () => {
  test('every entry appears in the help list with the same number of key choices', () => {
    expect(shortcutHelp).toHaveLength(shortcuts.length)
    shortcuts.forEach(({ chords }, index) => {
      expect(shortcutHelp[index]?.alternatives).toHaveLength(chords.length)
    })
  })

  test('the aria value lists every chord of the entry that sends the message', () => {
    expect(ariaKeyShortcutsOf('ClickedPlayPause').split(' ')).toEqual([
      'Space',
      ';',
    ])
    expect(ariaKeyShortcutsOf('ClickedNext').split(' ')).toEqual([
      'j',
      'Shift+N',
    ])
  })

  test('a message with no shortcut has an empty aria value', () => {
    expect(ariaKeyShortcutsOf('ClickedCloseInfo')).toBe('')
  })
})
