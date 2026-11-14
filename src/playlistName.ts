export const DEFAULT_PLAYLIST_NAME = 'Untitled playlist'
export const MAX_PLAYLIST_NAME_GRAPHEMES = 60

export type CleanedName =
  | Readonly<{ kind: 'Cleaned'; name: string }>
  | Readonly<{ kind: 'TooLong' }>

const graphemes = new Intl.Segmenter()

export const cleanPlaylistName = (raw: string): CleanedName => {
  const name = raw
    .normalize('NFKC')
    .replace(/[\t\n\v\f\r]/g, ' ')
    .replace(/\p{C}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (name === '') {
    return { kind: 'Cleaned', name: DEFAULT_PLAYLIST_NAME }
  }
  const length = [...graphemes.segment(name)].length
  return length > MAX_PLAYLIST_NAME_GRAPHEMES
    ? { kind: 'TooLong' }
    : { kind: 'Cleaned', name }
}
