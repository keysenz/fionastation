import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Plugin, defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

const FONT_AWESOME_CSS = '@fortawesome/fontawesome-free/css/all.min.css'

const usedIconClasses = (): ReadonlySet<string> => {
  const classes = new Set<string>()
  for (const file of readdirSync('src', {
    recursive: true,
    encoding: 'utf8',
  })) {
    if (!file.endsWith('.ts')) {
      continue
    }
    const source = readFileSync(join('src', file), 'utf8')
    for (const [name] of source.matchAll(/\bfa-[a-z0-9-]*/g)) {
      if (name.endsWith('-')) {
        throw new Error(
          `src/${file} builds the icon class "${name}…" from pieces. Write each Font Awesome class name whole so the build keeps its icon.`,
        )
      }
      classes.add(name)
    }
  }
  return classes
}

/** Keeps only the icon rules whose class appears in src, which cuts about
 *  64 kB from the stylesheet that blocks the first paint. */
const fontAwesomeSubset = (): Plugin => ({
  name: 'font-awesome-subset',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes(FONT_AWESOME_CSS)) {
      return
    }
    const used = usedIconClasses()
    return code.replace(/([^{}]+)\{--fa:[^}]*\}/g, (rule, selectors: string) =>
      selectors.split(',').some(selector => used.has(selector.trim().slice(1)))
        ? rule
        : '',
    )
  },
})

const APP_STYLESHEET =
  /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/

/** The loading frame in index.html styles itself inline, so the app stylesheet
 *  downloads as a preload instead of blocking the first paint. src/entry.ts
 *  applies it before the app mounts. */
const nonBlockingAppStylesheet = (): Plugin => ({
  name: 'non-blocking-app-stylesheet',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      if (!APP_STYLESHEET.test(html)) {
        throw new Error('index.html has no app stylesheet link to preload')
      }
      return html.replace(
        APP_STYLESHEET,
        '<link rel="preload" as="style" crossorigin href="$1">',
      )
    },
  },
})

export default defineConfig({
  plugins: [fontAwesomeSubset(), nonBlockingAppStylesheet(), foldkit()],
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
  server: {
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3000}`,
    },
  },
})
