import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The backend (FastAPI) runs on :8000. In dev, /api is proxied to it.
export default defineConfig({
  base: './',
  define: { __PREVIEW__: JSON.stringify(process.env.PREVIEW === '1') },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  test: { environment: 'node' },
} as never)
