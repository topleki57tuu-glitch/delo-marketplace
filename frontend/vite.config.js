import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/tasks': {
        target: 'http://localhost:8000',
        bypass(req) {
          // Браузерная навигация (не XHR/fetch) → отдаём SPA index.html
          if (req.headers.accept && req.headers.accept.includes('text/html')) return '/index.html';
        },
      },
      '/users': 'http://localhost:8000',
      '/login': 'http://localhost:8000',
      '/register': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/wallet': 'http://localhost:8000',
      '/monetization': 'http://localhost:8000',
      '/payments': 'http://localhost:8000',
      '/files': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
      '/notifications': 'http://localhost:8000',
      '/ai': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
