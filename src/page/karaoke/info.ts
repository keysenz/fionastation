import { Option } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { INFO_BUTTON_ID, INFO_PANEL_ID, Message } from './karaoke'

const INFO_TITLE_ID = 'karaoke-info-title'

const NBSP = ' '

const externalLink = (
  href: string,
  className: string,
  children: ReadonlyArray<Html | string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [
      h.Href(href),
      h.Target('_blank'),
      h.Rel('noopener noreferrer'),
      h.Class(className),
    ],
    children,
  )

const sectionHeading = (text: string, h: HtmlBuilder<Message>): Html =>
  h.h2(
    [
      h.Class(
        'text-2xl font-black uppercase tracking-tight text-[#446e92] drop-shadow-md',
      ),
    ],
    [text],
  )

const creditRow = (name: string, role: string, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('flex')],
    [name, h.span([h.Class('w-4 flex-grow')]), ` ${role}`],
  )

const whoIsFionaView = (h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('space-y-3')],
    [
      sectionHeading('Who is Fiona', h),
      h.p(
        [],
        [
          'Fiona Clearesta is Mystical White Rabbit from Underland who will bring happiness and joy to you! Fiona likes to sing in karaoke stream and sometimes humming in any other stream. She enjoy to play any horror, adventure or any game she had. She likes to cover japan song, but she sing to Japanese and Indonesian Song, you ',
          h.b([], ['should']),
          ' check her karaoke stream. ',
        ],
      ),
      h.p(
        [],
        [
          'Fiona was a talent of Metanoia Phase II, now she is an indie vtuber. She plays a vast variety of games, you can see in her ',
          externalLink(
            'https://www.youtube.com/watch?v=J6mBKVM2478&list=PL-65lNPQcx_DKVV7RBmSqHnxcddL1a56F&pp=iAQB',
            'underline hover:text-fiona',
            ['Playlist'],
            h,
          ),
          '.  Notable games she plays are ',
          externalLink(
            'https://www.youtube.com/watch?v=hSVwVU7Q-h0&list=PL-65lNPQcx_Bcwn3fJOraRWv_0MwZJdWI',
            'underline hover:text-fiona',
            ['Resident Evil Series'],
            h,
          ),
          ', you would find her hilarous surprised reaction and some big brain move she made. She also enjoy Minecraft, Raft and any similiar games. ',
        ],
      ),
      h.div(
        [h.Class('flex flex-wrap gap-x-4 gap-y-2 pt-1')],
        [
          externalLink(
            'https://www.youtube.com/@FionaClearesta',
            'text-red-400 hover:text-red-300',
            [h.i([h.Class('fa-brands fa-youtube')]), ' Fiona Clearesta Ch.'],
            h,
          ),
          externalLink(
            'https://twitter.com/FionaClearesta',
            'text-sky-300 hover:text-sky-200',
            [h.i([h.Class('fa-brands fa-twitter')]), ' @FionaClearesta'],
            h,
          ),
          externalLink(
            'https://virtualyoutuber.fandom.com/id/wiki/Fiona_Clearesta',
            'text-[#8fb4d6] hover:text-fiona',
            [h.i([h.Class('fa-solid fa-book-open')]), ' Read More'],
            h,
          ),
        ],
      ),
    ],
  )

const creditsView = (h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('space-y-3')],
    [
      sectionHeading('Credits', h),
      h.p(
        [],
        [
          'This is Fanmade website to support Fiona Clearesta, if you like vtuber with cute voice and very good singing skill, you like to watch vtuber play adventure game and humming to isekai song (you will know what is isekai song if u listen to her), you ',
          h.b([], ['MUST']),
          ' watch ',
        ],
      ),
      h.p(
        [h.Class('text-center font-bold')],
        [
          externalLink(
            'https://www.youtube.com/@FionaClearesta/streams',
            'hover:text-fiona',
            [
              h.i([h.Class('fa-brands fa-youtube text-red-600')]),
              " Fiona's Stream",
            ],
            h,
          ),
        ],
      ),
      h.p(
        [],
        [
          'Other than to promote our Kewinci this site also try to promote pyon talent, so dont feel shy to contribute 😉',
        ],
      ),
      h.p(
        [],
        [
          'If u want to contribute to this project u can contact me in Discord ',
          externalLink(
            'http://discordapp.com/users/244661517356761089',
            'hover:text-violet-300',
            [h.i([h.Class('fa-brands fa-discord')], [' Keysenz '])],
            h,
          ),
          '. We accept art, video, and music. Any contribution to site will be credited in this site.',
        ],
      ),
      h.p(
        [],
        [
          'You could also join ',
          externalLink(
            'https://discord.gg/vwfzuDFJA2',
            'text-violet-300 hover:text-violet-500',
            [h.i([h.Class('fa-brands fa-discord')], [' Rumah Kewinci Inc. '])],
            h,
          ),
          ' to share your fanart, clip or play game together, and of course utilize your youtube membership here.',
        ],
      ),
      h.ul(
        [h.Class('rounded-lg bg-black/30 p-4 space-y-1')],
        [
          creditRow('Keysenz', 'Website', h),
          creditRow('SuryaA', 'Karaoke Timestamp', h),
          creditRow('Bembot', 'Karaoke Timestamp', h),
          creditRow('Bang Nugs', 'Karaoke Timestamp', h),
          creditRow('ヤミアクマ', 'Karaoke Timestamp', h),
          h.li(
            [
              h.Class(
                'pt-3 text-center text-xl font-black uppercase text-[#446e92]',
              ),
            ],
            ['Artwork'],
          ),
          creditRow('MaroonR19', 'Website Background', h),
          creditRow('handryaraart', 'Menu Emoticon', h),
          h.li(
            [h.Class('pt-3 text-center text-lg')],
            ['HELP ME TO FILL THIS CREDITS LIST WITH YOUR NAME :)'],
          ),
        ],
      ),
      h.p(
        [h.Class('text-center text-sm text-gray-300')],
        [
          'Background credits : ',
          externalLink(
            'https://twitter.com/MaroonR19',
            'underline hover:text-[#8fb4d6]',
            ['Maroon'],
            h,
          ),
          NBSP,
        ],
      ),
    ],
  )

export const infoButtonView = (
  isInfoOpen: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(INFO_BUTTON_ID),
      h.AriaLabel('About Fio Radio'),
      h.AriaHasPopup('dialog'),
      h.AriaExpanded(isInfoOpen),
      h.OnClick(Message.ClickedToggleInfo()),
      h.Class(
        'flex items-center justify-center size-10 rounded-full text-gray-200 hover:text-white hover:bg-white/10 drop-shadow-md transition',
      ),
    ],
    [h.i([h.Class('fa-solid fa-circle-info fa-lg'), h.AriaHidden(true)])],
  )

export const infoPanelView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class('fixed inset-0 z-[70] flex items-center justify-center p-4'),
      h.OnKeyDownPreventDefault(key =>
        key === 'Escape'
          ? Option.some(Message.ClickedCloseInfo())
          : Option.none(),
      ),
    ],
    [
      h.div([
        h.Class('absolute inset-0 bg-black/60'),
        h.AriaHidden(true),
        h.OnClick(Message.ClickedCloseInfo()),
      ]),
      h.div(
        [
          h.Id(INFO_PANEL_ID),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy(INFO_TITLE_ID),
          h.Tabindex(-1),
          h.Class(
            'relative w-full max-w-2xl max-h-full overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl text-white shadow-2xl outline-none',
          ),
        ],
        [
          h.div(
            [
              h.Class(
                'sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-5 py-3 backdrop-blur-xl',
              ),
            ],
            [
              h.h1(
                [
                  h.Id(INFO_TITLE_ID),
                  h.Class(
                    'text-xl font-bold tracking-tight text-[#446e92] uppercase',
                  ),
                ],
                ['About Fio Radio'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.OnClick(Message.ClickedCloseInfo()),
                  h.Class(
                    'flex items-center gap-2 min-h-10 px-4 rounded-full border border-white/15 bg-white/10 text-sm font-semibold hover:bg-white/20 transition',
                  ),
                ],
                [h.i([h.Class('fas fa-times'), h.AriaHidden(true)]), 'Close'],
              ),
            ],
          ),
          h.div(
            [h.Class('space-y-8 px-5 py-5 text-sm leading-relaxed')],
            [whoIsFionaView(h), creditsView(h)],
          ),
        ],
      ),
    ],
  )
