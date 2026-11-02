import { type Html, type HtmlBuilder } from 'foldkit/html'

import {
  aboutRouter,
  coverRouter,
  creditsRouter,
  homeRouter,
  karaokeRouter,
} from '../route'

const NBSP = ' '

const backgroundCredit = <Message>(
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.p(
    [h.Class(className)],
    [
      'Background credits : ',
      h.a(
        [
          h.Rel('noopener noreferrer'),
          h.Target('_blank'),
          h.Href('https://twitter.com/MaroonR19'),
          h.Class('hover:text-[#446e92]'),
        ],
        ['Maroon'],
      ),
      ' ',
    ],
  )

const backLink = <Message>(h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(homeRouter()), h.Class('fixed top-4 left-4')],
    [h.i([h.Class('fa-arrow-left fa-2x fa-solid text-shadow text-[#446e92]')])],
  )

const externalLink = <Message>(
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

const menuItem = <Message>(
  href: string,
  imageSrc: string,
  label: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [h.Href(href)],
    [
      h.div(
        [h.Class('relative lg:my-[49px] lg:mx-[-2px] group')],
        [
          h.div(
            [
              h.Class(
                'group-hover:scale-125 absolute p-4 h-16 w-16 -left-4 -top-4 rounded-full z-30',
              ),
            ],
            [
              h.img([
                h.Src(`/${imageSrc}`),
                h.Alt(''),
                h.Class('absolute inset-0 h-full w-full rounded-full'),
              ]),
            ],
          ),
          h.div([h.Class('h-[90.07px] w-[156px]')]),
          h.div(
            [
              h.Class(
                'absolute top-1/2 left-1/2 z-0 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out',
              ),
            ],
            [
              h.div([
                h.Class(
                  'h-[90.07px] w-[156px]  transition-all duration-300 ease-out group-hover:border-x-[11px] group-hover:border-transparent',
                ),
              ]),
              h.div([
                h.Class(
                  'absolute top-0 -z-10 h-[90.07px] w-[156px] bg-white/50 group-hover:scale-110',
                ),
              ]),
            ],
          ),
          h.div(
            [
              h.Class(
                'absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center',
              ),
            ],
            [label],
          ),
        ],
      ),
    ],
  )

export const homeView = <Message>(h: HtmlBuilder<Message>): Html =>
  h.main(
    [
      h.Class(
        'container flex max-w-screen-md grow flex-col items-center justify-center',
      ),
    ],
    [
      h.div(
        [h.Class('relative z-0 mb-14 mt-28')],
        [
          h.h1(
            [
              h.Class(
                'z-0 text-center text-4xl font-black uppercase md:text-7xl text-[#446e92]',
              ),
            ],
            ['Fiona ', h.br([]), h.span([], ['Station'])],
          ),
        ],
      ),
      h.div(
        [h.Class('mb-12 flex flex-col md:flex-row gap-6 md:gap-12')],
        [
          menuItem(aboutRouter(), 'fionawave.webp', 'About', h),
          menuItem(karaokeRouter(), 'FioLove.webp', 'Karaoke', h),
          menuItem(coverRouter(), 'FioWah.webp', 'Cover', h),
          menuItem(creditsRouter(), 'FioManteb.webp', 'Credits', h),
        ],
      ),
      h.div([h.Class('grow')]),
      backgroundCredit(
        'text-shadow my-8 text-center text-sm text-black backdrop-blur-lg',
        h,
      ),
    ],
  )

export const aboutView = <Message>(
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.main(
    [
      h.Class(
        'container flex max-w-screen-md grow flex-col items-center justify-center text-white',
      ),
    ],
    [
      h.div(
        [h.Class('relative z-0 mt-14 mb-8')],
        [
          h.h1(
            [
              h.Class(
                'z-0 text-center text-4xl font-black uppercase md:text-6xl text-[#446e92]',
              ),
            ],
            ['Fiona Clearesta'],
          ),
        ],
      ),
      h.div(
        [],
        [
          h.div(
            [h.Class('mb-2 flex flex-col items-end justify-end sm:flex-row')],
            [
              h.a(
                [
                  h.Href('https://twitter.com/FionaClearesta'),
                  h.Class(
                    'md:text-[#446e92] text-shadow mr-2 hover:text-blue-900 sm:mr-4',
                  ),
                ],
                [h.i([h.Class('fa-brands fa-twitter')]), ' @FionaClearesta'],
              ),
              h.a(
                [
                  h.Href('https://www.youtube.com/@FionaClearesta'),
                  h.Class('md:text-red-600 text-shadow hover:text-red-800'),
                ],
                [
                  h.i([h.Class('fa-brands fa-youtube')]),
                  ' Fiona Clearesta Ch.',
                ],
              ),
            ],
          ),
          h.div(
            [
              h.Class(
                'mt-4 mb-4 w-full max-w-screen-md border-4 bg-black/50 px-4 py-2 md:skew-x-12 md:border-x-6 md:px-10',
              ),
            ],
            [
              h.div(
                [h.Class('flex h-full flex-col md:-skew-x-12')],
                [
                  h.p(
                    [],
                    [
                      'Fiona Clearesta is Mystical White Rabbit from Underland who will bring happiness and joy to you! Fiona likes to sing in karaoke stream and sometimes humming in any other stream. She enjoy to play any horror, adventure or any game she had. She likes to cover japan song, but she sing to Japanese and Indonesian Song, you ',
                      h.b([], ['should']),
                      ' check her karaoke stream. ',
                    ],
                  ),
                  h.p([], [NBSP]),
                  h.p(
                    [],
                    [
                      'Fiona was a talent of Metanoia Phase II, now she is an indie vtuber. She plays a vast variety of games, you can see in her ',
                      externalLink(
                        'https://www.youtube.com/watch?v=J6mBKVM2478&list=PL-65lNPQcx_DKVV7RBmSqHnxcddL1a56F&pp=iAQB',
                        'hover:text-fiona',
                        ['Playlist'],
                        h,
                      ),
                      '.  Notable games she plays are ',
                      externalLink(
                        'https://www.youtube.com/watch?v=hSVwVU7Q-h0&list=PL-65lNPQcx_Bcwn3fJOraRWv_0MwZJdWI',
                        'hover:text-fiona',
                        ['Resident Evil Series'],
                        h,
                      ),
                      ', you would find her hilarous surprised reaction and some big brain move she made. She also enjoy Minecraft, Raft and any similiar games. ',
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      externalLink(
        'https://virtualyoutuber.fandom.com/id/wiki/Fiona_Clearesta',
        'mb-6 rounded border-2 border-black px-2 text-lg font-black text-[#446e92] uppercase  hover:text-fiona',
        ['Read More'],
        h,
      ),
      h.div([h.Class('z-10 flex w-full flex-col sm:w-3/4 md:w-2/3 lg:w-4/5')]),
      h.div([h.Class('grow')]),
      backgroundCredit('text-shadow my-8 text-center text-sm text-black', h),
    ],
  ),
  backLink(h),
]

const creditRow = <Message>(
  name: string,
  role: string,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [h.Class(className)],
    [name, h.span([h.Class('w-4 flex-grow')]), ` ${role}`],
  )

export const creditsView = <Message>(
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.main(
    [
      h.Class(
        'container flex max-w-screen-md grow flex-col items-center justify-center text-[#446e92]',
      ),
    ],
    [
      h.div(
        [h.Class('relative z-0 mt-14 mb-8')],
        [
          h.h1(
            [
              h.Class(
                'z-0 text-center text-4xl font-black uppercase md:text-6xl text-[#446e92]',
              ),
            ],
            ['Credits'],
          ),
        ],
      ),
      h.div(
        [
          h.Class(
            'mt-4 mb-4 w-full max-w-screen-md border-4 bg-black/50 px-4 py-2 md:skew-x-12 md:border-x-6 md:px-10 text-white',
          ),
        ],
        [
          h.div(
            [h.Class('flex h-full flex-col md:-skew-x-12')],
            [
              h.p(
                [],
                [
                  'This is Fanmade website to support Fiona Clearesta, if you like vtuber with cute voice and very good singing skill, you like to watch vtuber play adventure game and humming to isekai song (you will know what is isekai song if u listen to her), you ',
                  h.b([], ['MUST']),
                  ' watch ',
                ],
              ),
              h.h2(
                [h.Class('text-center')],
                [
                  h.b(
                    [],
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
              h.p([], [NBSP]),
              h.p(
                [],
                [
                  'You could also join ',
                  externalLink(
                    'https://discord.gg/vwfzuDFJA2',
                    'text-violet-300 hover:text-violet-500',
                    [
                      h.i(
                        [h.Class('fa-brands fa-discord')],
                        [' Rumah Kewinci Inc. '],
                      ),
                    ],
                    h,
                  ),
                  ' to share your fanart, clip or play game together, and of course utilize your youtube membership here.',
                ],
              ),
            ],
          ),
        ],
      ),
      h.h2(
        [
          h.Class(
            'mb-4 text-4xl font-black uppercase md:text-6xl text-[#446e92]',
          ),
        ],
        ['Credits'],
      ),
      h.ul(
        [h.Class('bg-black/30 w-full p-4 text-white')],
        [
          creditRow('Keysenz', 'Website', 'flex', h),
          creditRow('SuryaA', 'Karaoke Timestamp', 'flex', h),
          creditRow('Bembot', 'Karaoke Timestamp', 'flex', h),
          creditRow('Bang Nugs', 'Karaoke Timestamp', 'flex', h),
          creditRow('ヤミアクマ', 'Karaoke Timestamp', 'flex', h),
          h.li(
            [
              h.Class(
                'mb-4 text-4xl font-black uppercase md:text-6xl text-center text-[#446e92]',
              ),
            ],
            ['Artwork'],
          ),
          creditRow('MaroonR19', 'Website Background', 'flex items-center', h),
          creditRow('handryaraart', 'Menu Emoticon', 'flex items-center', h),
          h.li(
            [],
            [
              h.p(
                [h.Class('text-2xl text-center')],
                [
                  'HELP ME TO FILL THIS CREDITS ',
                  h.br([]),
                  ' PAGE WITH YOUR NAME :)',
                ],
              ),
            ],
          ),
        ],
      ),
      h.div([h.Class('grow')]),
    ],
  ),
  backLink(h),
]

export const notFoundView = <Message>(h: HtmlBuilder<Message>): Html =>
  h.main(
    [
      h.Class(
        'container flex max-w-screen-md grow flex-col items-center justify-center text-[#446e92]',
      ),
    ],
    [
      h.h1([h.Class('text-4xl font-black uppercase')], ['404']),
      h.p([h.Class('my-4')], ['This page could not be found.']),
      h.a([h.Href(homeRouter()), h.Class('underline')], ['Back to home']),
    ],
  )
