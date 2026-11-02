import type { Html, HtmlBuilder } from 'foldkit/html'

export type IconName =
  | 'list'
  | 'close'
  | 'skipEnd'
  | 'skipStart'
  | 'shuffle'
  | 'search'
  | 'playFill'
  | 'musicNote'
  | 'repeat'

const ICONS: Readonly<
  Record<IconName, { viewBox: string; paths: ReadonlyArray<string> }>
> = {
  list: {
    viewBox: '0 0 16 16',
    paths: [
      'M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5',
    ],
  },
  close: {
    viewBox: '0 0 16 16',
    paths: [
      'M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708',
    ],
  },
  skipEnd: {
    viewBox: '0 0 16 16',
    paths: [
      'M12.5 4a.5.5 0 0 0-1 0v3.248L5.233 3.612C4.693 3.3 4 3.678 4 4.308v7.384c0 .63.692 1.01 1.233.697L11.5 8.753V12a.5.5 0 0 0 1 0z',
    ],
  },
  skipStart: {
    viewBox: '0 0 16 16',
    paths: [
      'M4 4a.5.5 0 0 1 1 0v3.248l6.267-3.636c.54-.313 1.232.066 1.232.696v7.384c0 .63-.692 1.01-1.232.697L5 8.753V12a.5.5 0 0 1-1 0z',
    ],
  },
  shuffle: {
    viewBox: '0 0 16 16',
    paths: [
      'M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5',
      'M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192',
    ],
  },
  search: {
    viewBox: '0 0 16 16',
    paths: [
      'M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0',
    ],
  },
  playFill: {
    viewBox: '0 0 16 16',
    paths: [
      'm11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393',
    ],
  },
  musicNote: {
    viewBox: '0 0 16 16',
    paths: [
      'M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13s1.12-2 2.5-2 2.5.896 2.5 2m9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2',
      'M14 11V2h1v9zM6 3v10H5V3z',
      'M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4z',
    ],
  },
  repeat: {
    viewBox: '0 0 24 24',
    paths: [
      'M21 6h-5v2h4v9H4V8h5v3l5-4-5-4v3H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z',
    ],
  },
}

const EVEN_ODD_ICONS: ReadonlySet<IconName> = new Set(['list', 'shuffle'])

export const icon = <Message>(
  name: IconName,
  size: string,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.svg(
    [
      h.Class(className),
      h.ViewBox(ICONS[name].viewBox),
      h.Width(size),
      h.Height(size),
      h.Fill('currentColor'),
      ...(EVEN_ODD_ICONS.has(name)
        ? [h.Attribute('fill-rule', 'evenodd')]
        : []),
    ],
    ICONS[name].paths.map(d => h.path([h.D(d)])),
  )
