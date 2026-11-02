import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { previewApi } from './server/preview-api'

/**
 * Локальный режим: /api/* обслуживает in-memory/файловый эмулятор (server/preview-api.ts),
 * поэтому сайт открывается без Vercel и без Neon — просто `npm run dev`.
 * В Vercel этот плагин не участвует: там работают реальные функции /api/*.ts.
 */
export default defineConfig({
  plugins: [react(), previewApi()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: ['..'] },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
