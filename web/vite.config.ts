import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
// Standalone reports use the unmodified foundation HTML styles. Keep the
// historical URL while removing the product's handwritten CSS implementation.
const require = createRequire(import.meta.url)
function reportStyles(): Plugin {
  const css = ['tokens.css', 'controls.css']
    .map((name) => readFileSync(require.resolve(`@fastrd/ui-foundation/${name}`), 'utf8'))
    .join('\n')
  return {
    name: 'fastui-report-styles',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'reports/report.css', source: css })
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0]?.endsWith('/reports/report.css')) {
          response.setHeader('Content-Type', 'text/css')
          response.end(css)
        } else next()
      })
    },
  }
}
export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), ''),
    ...loadEnv(mode, process.cwd(), ''),
  }
  const base = (env.FASTNEWS_PUBLIC_PATH || '').replace(/\/$/, '') + '/'
  return {
    base,
    plugins: [react(), UnoCSS(), reportStyles()],
    server: {
      port: 5178,
      proxy: {
        [base + 'api']: {
          target: env.FASTNEWS_API_PROXY || 'http://127.0.0.1:4173',
          changeOrigin: false,
        },
        [base + 'top-conf/data']: 'http://127.0.0.1:4173',
        [base + 'secnews/data']: 'http://127.0.0.1:4173',
      },
    },
  }
})
