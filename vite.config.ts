import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

export default defineConfig({
  plugins: [foldkit()],
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
  server: {
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3000}`,
    },
  },
})
