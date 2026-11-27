import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), ''),
    ...loadEnv(mode, process.cwd(), ''),
  }
  const base = (env.FASTNEWS_PUBLIC_PATH || '').replace(/\/$/, '') + '/'
  return {
    base,
    plugins: [react(), UnoCSS()],
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
