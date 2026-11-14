import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { twMerge } from 'tailwind-merge'

import { WriteFailure } from '../../api.ts'
import { Account, type Listed, reachablePlaylists } from './account.ts'
import {
  Message,
  type Model,
  PLAYLIST_DIALOG_ID,
  linkText,
  ownedOpenedOf,
  saveSelectionOf,
} from './karaoke'
import {
  type CopyResult,
  type CopyTarget,
  PlaylistForm,
  SAVE_SOURCES,
  playlistPath,
  writtenName,
} from './playlists.ts'
import type { SaveSource } from './setlist.ts'

const songCountText = (count: number): string =>
  `${count} ${count === 1 ? 'song' : 'songs'}`

const SOURCE_LABELS: Record<SaveSource, string> = {
  Queue: 'Up next',
  History: 'Played',
  Session: 'Whole session',
}

const SOURCE_HINTS: Record<SaveSource, string> = {
  Queue: 'The songs waiting in your queue.',
  History: 'The songs you already heard.',
  Session: 'Played, then playing now, then queued.',
}

const failureText = (failure: WriteFailure): string =>
  WriteFailure.match<string>(failure, {
    Unreachable: () =>
      'Could not reach the server. Check your connection, then press the button again.',
    Unreadable: () =>
      'The server answered with something this page does not understand. Try again in a moment.',
    Forbidden: () =>
      'This browser no longer has the right to edit this playlist. Open its edit link again.',
    NotFound: () => 'This playlist no longer exists.',
    Deleted: () => 'This playlist was deleted.',
    Conflict: () => 'Someone else changed this playlist first.',
    TooLarge: () => 'That request was too large for the server.',
    RateLimited: () =>
      'You have saved a lot of playlists in the last hour. Wait a while, then try again.',
    Unavailable: () =>
      'The server cannot take new playlists today. Try again tomorrow.',
    Rejected: () =>
      'The server did not accept that request. Reload the page and try again.',
  })

const buttonClass =
  'flex items-center justify-center gap-2 min-h-11 px-4 rounded-full border border-white/15 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed'
const primaryClass = twMerge(buttonClass, 'bg-[#446e92] hover:bg-[#54809f]')
const quietClass = twMerge(buttonClass, 'text-gray-300 hover:bg-white/10')

const barButtonClass =
  'flex shrink-0 items-center gap-2 min-h-9 px-3 sm:min-h-10 whitespace-nowrap rounded-full border border-white/15 bg-black/40 text-xs sm:text-sm font-semibold text-gray-100 hover:bg-white/10 drop-shadow-md transition'

const barButtonView = (
  action: string,
  label: string,
  icon: string,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.DataAttribute('playlist-action', action),
      h.OnClick(message),
      h.Class(barButtonClass),
    ],
    [h.i([h.Class(`fas ${icon}`), h.AriaHidden(true)]), label],
  )

export const savePlaylistButtonView = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel('Save as playlist'),
      h.DataAttribute('playlist-action', 'Save'),
      h.OnClick(Message.ClickedSavePlaylist()),
      h.Class(barButtonClass),
    ],
    [
      h.i([h.Class('fas fa-bookmark'), h.AriaHidden(true)]),
      h.span([h.Class('hidden sm:inline')], ['Save as playlist']),
      h.span([h.Class('sm:hidden')], ['Save']),
    ],
  )

export const myPlaylistsButtonView = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel('My playlists'),
      h.DataAttribute('playlist-action', 'Mine'),
      h.OnClick(Message.ClickedOpenMyPlaylists()),
      h.Class(barButtonClass),
    ],
    [
      h.i([h.Class('fas fa-list'), h.AriaHidden(true)]),
      h.span([h.Class('hidden sm:inline')], ['My playlists']),
    ],
  )

export const openPlaylistBarView = (
  model: Model,
  opened: { name: string },
  h: HtmlBuilder<Message>,
): Html => {
  const isOwner = Option.isSome(ownedOpenedOf(model))
  return h.div(
    [
      h.DataAttribute('playlist-bar', isOwner ? 'Owner' : 'Visitor'),
      h.Class(
        'mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-black/50 backdrop-blur-md p-2',
      ),
    ],
    [
      h.span(
        [
          h.Class(
            'min-w-0 max-w-full truncate text-sm font-bold text-white drop-shadow-md',
          ),
        ],
        [opened.name],
      ),
      barButtonView(
        'Share',
        'Share link',
        'fa-link',
        Message.ClickedSharePlaylist(),
        h,
      ),
      ...(isOwner
        ? [
            barButtonView(
              'Rename',
              'Rename',
              'fa-pen',
              Message.ClickedRenamePlaylist(),
              h,
            ),
            barButtonView(
              'Update',
              'Update from queue',
              'fa-rotate',
              Message.ClickedUpdatePlaylist(),
              h,
            ),
            barButtonView(
              'Delete',
              'Delete',
              'fa-trash',
              Message.ClickedDeletePlaylist(),
              h,
            ),
          ]
        : []),
      barButtonView(
        'SaveCopy',
        'Save a copy',
        'fa-clone',
        Message.ClickedSaveCopyOfPlaylist(),
        h,
      ),
    ],
  )
}

const inputClass =
  'w-full bg-black/60 text-white placeholder:text-gray-400 rounded-lg py-2 px-3 text-sm border border-white/15 focus:border-[#446e92] focus:outline-none'

const nameFieldView = (
  name: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const isTooLong = writtenName(name).kind === 'TooLong'
  return [
    h.label(
      [
        h.For(`${PLAYLIST_DIALOG_ID}-name`),
        h.Class('block text-sm font-semibold'),
      ],
      ['Name'],
    ),
    h.input([
      h.Id(`${PLAYLIST_DIALOG_ID}-name`),
      h.Type('text'),
      h.Placeholder('Untitled playlist'),
      h.Value(name),
      h.AriaInvalid(isTooLong),
      h.DataAttribute('playlist-field', 'name'),
      h.OnInput(value => Message.UpdatedPlaylistName({ value })),
      h.Class(inputClass),
    ]),
    isTooLong
      ? h.p(
          [
            h.DataAttribute('playlist-problem', 'NameTooLong'),
            h.Class('text-sm text-amber-300'),
          ],
          ['That name is too long. Shorten it to 60 characters or fewer.'],
        )
      : h.empty,
  ]
}

const sourceChoiceView = (
  model: Model,
  chosen: SaveSource,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Role('radiogroup'),
      h.AriaLabel('Songs to save'),
      h.Class('flex flex-col gap-2'),
    ],
    Array.map(SAVE_SOURCES, source => {
      const { songIds } = saveSelectionOf(model, source)
      const isEmpty = Array.isReadonlyArrayEmpty(songIds)
      const isChosen = source === chosen
      return h.button(
        [
          h.Type('button'),
          h.Role('radio'),
          h.AriaChecked(isChosen),
          h.Disabled(isEmpty),
          h.DataAttribute('playlist-source', source),
          h.OnClick(Message.SelectedSaveSource({ source })),
          h.Class(
            twMerge(
              'flex items-center justify-between gap-3 min-h-11 px-4 py-2 rounded-lg border text-left text-sm transition disabled:opacity-40 disabled:cursor-not-allowed',
              isChosen
                ? 'border-[#578bb8] bg-[#446e92]/40'
                : 'border-white/15 hover:bg-white/10',
            ),
          ),
        ],
        [
          h.span(
            [h.Class('min-w-0')],
            [
              h.span([h.Class('block font-semibold')], [SOURCE_LABELS[source]]),
              h.span(
                [h.Class('block text-xs text-gray-300')],
                [SOURCE_HINTS[source]],
              ),
            ],
          ),
          h.span(
            [h.Class('shrink-0 text-xs text-gray-200')],
            [isEmpty ? 'No songs' : songCountText(songIds.length)],
          ),
        ],
      )
    }),
  )

const failureView = (
  maybeFailure: Option.Option<WriteFailure>,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(maybeFailure, {
    onNone: () => h.empty,
    onSome: failure =>
      h.p(
        [
          h.Role('alert'),
          h.DataAttribute('playlist-failure', failure._tag),
          h.Class(
            'text-sm text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-lg p-3',
          ),
        ],
        [failureText(failure)],
      ),
  })

type FormCopy = Readonly<{
  title: string
  submit: string
  canSubmit: boolean
  body: ReadonlyArray<Html>
}>

const formCopyOf = (
  model: Model,
  form: PlaylistForm,
  h: HtmlBuilder<Message>,
): FormCopy => {
  const nameIsValid = (name: string) => writtenName(name).kind === 'Valid'
  const queueSize = saveSelectionOf(model, 'Queue').songIds.length
  const isOwner = Option.isSome(ownedOpenedOf(model))
  return PlaylistForm.match<FormCopy>(form, {
    Save: form => {
      const selection = saveSelectionOf(model, form.source)
      return {
        title: 'Save as playlist',
        submit: 'Save playlist',
        canSubmit:
          nameIsValid(form.name) &&
          Array.isReadonlyArrayNonEmpty(selection.songIds),
        body: [
          Array.every(SAVE_SOURCES, source =>
            Array.isReadonlyArrayEmpty(saveSelectionOf(model, source).songIds),
          )
            ? h.p(
                [
                  h.DataAttribute('playlist-problem', 'NothingToSave'),
                  h.Class('text-sm text-amber-300'),
                ],
                ['Play or queue a song first, then save it as a playlist.'],
              )
            : h.empty,
          sourceChoiceView(model, form.source, h),
          selection.omittedCount > 0
            ? h.p(
                [
                  h.DataAttribute('playlist-problem', 'OverLimit'),
                  h.Class('text-sm text-amber-300'),
                ],
                [
                  `A playlist holds up to 100 songs. This saves the first ${selection.songIds.length} and leaves out ${selection.omittedCount}.`,
                ],
              )
            : h.empty,
          ...nameFieldView(form.name, h),
        ],
      }
    },
    Copy: form => ({
      title: 'Save a copy',
      submit: 'Save copy',
      canSubmit: nameIsValid(form.name),
      body: [
        h.p(
          [h.Class('text-sm text-gray-300')],
          [
            'You get a new playlist with the same songs, and a link only you can edit. The original stays as it is.',
          ],
        ),
        ...nameFieldView(form.name, h),
      ],
    }),
    Rename: form => ({
      title: 'Rename playlist',
      submit: 'Rename',
      canSubmit: isOwner && nameIsValid(form.name),
      body: nameFieldView(form.name, h),
    }),
    Update: () => ({
      title: 'Update from queue',
      submit: 'Replace songs',
      canSubmit: isOwner && queueSize > 0,
      body: [
        h.p(
          [h.Class('text-sm text-gray-300')],
          [
            queueSize > 0
              ? `The playlist's songs are replaced by the ${songCountText(queueSize)} in your queue. Everyone with the link sees the new list.`
              : 'Your queue is empty. Add songs to the queue first, then update the playlist.',
          ],
        ),
      ],
    }),
    Delete: () => ({
      title: 'Delete playlist',
      submit: 'Delete playlist',
      canSubmit: isOwner,
      body: [
        h.p(
          [h.Class('text-sm text-gray-300')],
          ['The link stops working for everyone. This cannot be undone.'],
        ),
      ],
    }),
  })
}

const copyStatusView = (
  maybeResult: Option.Option<CopyResult>,
  target: CopyTarget,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(
    Option.filter(maybeResult, result => result.target === target),
    {
      onNone: () => h.empty,
      onSome: result =>
        h.p(
          [
            h.Role('status'),
            h.DataAttribute('playlist-copy', result._tag),
            h.Class('text-xs text-gray-300'),
          ],
          [
            result._tag === 'Copied'
              ? 'Copied.'
              : 'Could not copy. Select the link and copy it by hand.',
          ],
        ),
    },
  )

const linkBlockView = (
  target: CopyTarget,
  heading: string,
  note: string,
  link: string,
  maybeResult: Option.Option<CopyResult>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.DataAttribute('playlist-link', target), h.Class('space-y-2')],
    [
      h.h2([h.Class('text-sm font-semibold')], [heading]),
      h.p([h.Class('text-xs text-gray-300')], [note]),
      h.p(
        [
          h.Class(
            'select-all break-all rounded-lg border border-white/15 bg-black/60 p-2 text-xs',
          ),
        ],
        [link],
      ),
      h.button(
        [
          h.Type('button'),
          h.DataAttribute('playlist-copy-target', target),
          h.OnClick(Message.ClickedCopyLink({ target })),
          h.Class(target === 'View' ? primaryClass : buttonClass),
        ],
        [target === 'View' ? 'Copy link' : 'Copy edit link'],
      ),
      copyStatusView(maybeResult, target, h),
    ],
  )

const sharedBodyView = (
  model: Model,
  shared: Extract<Model['playlistDialog'], { _tag: 'Shared' }>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.h1([h.Class('text-lg font-bold break-words')], [shared.name]),
  shared.remembered === 'No'
    ? h.p(
        [
          h.Role('alert'),
          h.DataAttribute('playlist-problem', 'NotRemembered'),
          h.Class(
            'text-sm text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-lg p-3',
          ),
        ],
        [
          'This browser could not keep the edit link. Copy the edit link below now, or you will not be able to change this playlist later.',
        ],
      )
    : h.empty,
  linkBlockView(
    'View',
    'Link to share',
    'Anyone with this link can play the playlist.',
    linkText(model.siteOrigin, shared.id, 'View', shared.maybeEditToken),
    shared.maybeCopyResult,
    h,
  ),
  Option.match(shared.maybeEditToken, {
    onNone: () => h.empty,
    onSome: () =>
      linkBlockView(
        'Edit',
        'Link to edit',
        'Keep this one private. Open it in another browser to rename, update or delete the playlist there.',
        linkText(model.siteOrigin, shared.id, 'Edit', shared.maybeEditToken),
        shared.maybeCopyResult,
        h,
      ),
  }),
]

const accountSectionView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Account.match<Html>(model.account, {
    Loading: () => h.empty,
    Unavailable: () => h.empty,
    SignedOut: () =>
      h.div(
        [h.DataAttribute('account', 'SignedOut'), h.Class('space-y-2')],
        [
          h.button(
            [
              h.Type('button'),
              h.DataAttribute('playlist-action', 'Connect'),
              h.OnClick(Message.ClickedConnectDiscord()),
              h.Class(twMerge(primaryClass, 'w-full')),
            ],
            [
              h.i([h.Class('fab fa-discord'), h.AriaHidden(true)]),
              'Connect Discord',
            ],
          ),
          h.p(
            [h.Class('text-xs text-gray-300')],
            [
              "Connect to edit your playlists from any browser. Connected fans can also manage them with /playlist in Fiona's Discord server.",
            ],
          ),
        ],
      ),
    Connected: ({ name }) =>
      h.div(
        [
          h.DataAttribute('account', 'Connected'),
          h.Class('flex flex-wrap items-center gap-2'),
        ],
        [
          h.p(
            [h.Class('min-w-0 flex-1 text-sm')],
            [
              'Connected as ',
              h.span(
                [
                  h.DataAttribute('account-name', ''),
                  h.Class('font-semibold break-words'),
                ],
                [name],
              ),
            ],
          ),
          h.button(
            [
              h.Type('button'),
              h.DataAttribute('playlist-action', 'Disconnect'),
              h.OnClick(Message.ClickedDisconnectDiscord()),
              h.Class(quietClass),
            ],
            ['Disconnect'],
          ),
        ],
      ),
  })

const listedPlaylistView = (entry: Listed, h: HtmlBuilder<Message>): Html =>
  h.li(
    [],
    [
      h.a(
        [
          h.Href(playlistPath(entry.id)),
          h.DataAttribute('my-playlist', entry.id),
          h.Class(
            'block min-h-11 rounded-lg px-3 py-2 text-sm break-words hover:bg-white/10',
          ),
        ],
        [entry.name],
      ),
    ],
  )

const accountDialogBodyView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const playlists = reachablePlaylists(model.account, model.mine)
  return [
    h.h1(
      [h.Id(`${PLAYLIST_DIALOG_ID}-title`), h.Class('text-lg font-bold')],
      ['My playlists'],
    ),
    accountSectionView(model, h),
    Array.isReadonlyArrayNonEmpty(playlists)
      ? h.ul(
          [
            h.DataAttribute('my-playlists', String(playlists.length)),
            h.Class('max-h-64 space-y-1 overflow-y-auto'),
          ],
          Array.map(playlists, entry => listedPlaylistView(entry, h)),
        )
      : h.p(
          [
            h.DataAttribute('my-playlists', '0'),
            h.Class('text-sm text-gray-300'),
          ],
          ['No saved playlists in this browser yet.'],
        ),
    h.button(
      [
        h.Type('button'),
        h.DataAttribute('playlist-action', 'Done'),
        h.OnClick(Message.ClickedClosePlaylistDialog()),
        h.Class(twMerge(quietClass, 'w-full')),
      ],
      ['Done'],
    ),
  ]
}

export const playlistDialogView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const dialog = model.playlistDialog
  if (dialog._tag === 'Closed') {
    return h.empty
  }
  const isSending = dialog._tag === 'Sending'
  const form =
    dialog._tag === 'Shared' || dialog._tag === 'Account'
      ? undefined
      : dialog.form
  const copy = form === undefined ? undefined : formCopyOf(model, form, h)
  return h.div(
    [
      h.DataAttribute('playlist-dialog', dialog._tag),
      h.Class('fixed inset-0 z-[70] flex items-center justify-center p-4'),
      h.OnKeyDownPreventDefault(key =>
        key === 'Escape' && !isSending
          ? Option.some(Message.ClickedClosePlaylistDialog())
          : Option.none(),
      ),
    ],
    [
      h.div([
        h.Class('absolute inset-0 bg-black/60'),
        h.AriaHidden(true),
        h.OnClick(Message.ClickedClosePlaylistDialog()),
      ]),
      h.div(
        [
          h.Id(PLAYLIST_DIALOG_ID),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy(`${PLAYLIST_DIALOG_ID}-title`),
          h.Tabindex(-1),
          h.Class(
            'relative w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl text-white shadow-2xl outline-none p-5 space-y-4',
          ),
        ],
        dialog._tag === 'Account'
          ? accountDialogBodyView(model, h)
          : dialog._tag === 'Shared'
            ? [
                h.p(
                  [
                    h.Id(`${PLAYLIST_DIALOG_ID}-title`),
                    h.Class('text-xs uppercase tracking-wide text-gray-300'),
                  ],
                  ['Playlist ready to share'],
                ),
                ...sharedBodyView(model, dialog, h),
                h.button(
                  [
                    h.Type('button'),
                    h.DataAttribute('playlist-action', 'Done'),
                    h.OnClick(Message.ClickedClosePlaylistDialog()),
                    h.Class(twMerge(quietClass, 'w-full')),
                  ],
                  ['Done'],
                ),
              ]
            : copy === undefined
              ? []
              : [
                  h.h1(
                    [
                      h.Id(`${PLAYLIST_DIALOG_ID}-title`),
                      h.Class('text-lg font-bold'),
                    ],
                    [copy.title],
                  ),
                  h.form(
                    [
                      h.OnSubmit(Message.SubmittedPlaylistForm()),
                      h.Class('space-y-4'),
                    ],
                    [
                      ...copy.body,
                      dialog._tag === 'Editing'
                        ? failureView(dialog.maybeFailure, h)
                        : h.empty,
                      h.div(
                        [h.Class('flex flex-col gap-2')],
                        [
                          h.button(
                            [
                              h.Type('submit'),
                              h.DataAttribute('playlist-action', 'Submit'),
                              h.Disabled(isSending || !copy.canSubmit),
                              h.Class(
                                form !== undefined && form._tag === 'Delete'
                                  ? twMerge(
                                      buttonClass,
                                      'bg-red-700 hover:bg-red-600',
                                    )
                                  : primaryClass,
                              ),
                            ],
                            [isSending ? 'Working...' : copy.submit],
                          ),
                          h.button(
                            [
                              h.Type('button'),
                              h.DataAttribute('playlist-action', 'Cancel'),
                              h.Disabled(isSending),
                              h.OnClick(Message.ClickedClosePlaylistDialog()),
                              h.Class(quietClass),
                            ],
                            ['Cancel'],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
      ),
    ],
  )
}
