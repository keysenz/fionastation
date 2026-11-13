import '@fortawesome/fontawesome-free/css/all.min.css'
import { Runtime } from 'foldkit'

import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'

import { Message, Model, init, subscriptions, update, view } from './main'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById('root'),
  routing: {
    onUrlRequest: request => Message.ClickedLink({ request }),
    onUrlChange: url => Message.ChangedUrl({ url }),
  },
  devTools: {
    Message,
  },
})

const appStylesheetLoaded = (): Promise<void> => {
  const preload = document.querySelector<HTMLLinkElement>(
    'link[rel="preload"][as="style"]',
  )
  if (preload === null) {
    return Promise.resolve()
  }
  const stylesheet = Object.assign(document.createElement('link'), {
    rel: 'stylesheet',
    href: preload.href,
    crossOrigin: preload.crossOrigin,
  })
  const loaded = new Promise<void>(resolve => {
    stylesheet.addEventListener('load', () => resolve(), { once: true })
    stylesheet.addEventListener('error', () => resolve(), { once: true })
  })
  document.head.append(stylesheet)
  return loaded
}

void appStylesheetLoaded().then(() => Runtime.run(application))
inject()
injectSpeedInsights()
