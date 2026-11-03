import { type Html, type HtmlBuilder } from 'foldkit/html'

import { radioRouter } from '../route'

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
      h.a([h.Href(radioRouter()), h.Class('underline')], ['Back to Fio Radio']),
    ],
  )
