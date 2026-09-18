import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import compression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Gzip compression для production
    compression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024, // Только файлы > 1KB
    }),
    // Brotli compression (лучше чем gzip)
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 1024,
    }),
  ],
  build: {
    // FIX: Добавлена оптимизация для production - удаление console.log
    minify: 'esbuild',
    // Настройки minification для удаления console.log в production
    esbuildOptions: {
      drop: ['console', 'debugger'], // Удалить console.* и debugger в production
    },
    // Оптимизация CSS
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Разделяем vendor библиотеки для лучшего кеширования
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'date-vendor': ['date-fns/formatDistanceToNow', 'date-fns/format', 'date-fns/isToday', 'date-fns/isYesterday'],
          'state-vendor': ['zustand']
        }
      }
    },
    chunkSizeWarningLimit: 600, // Предупреждение если chunk > 600KB
    // Оптимизация для мобильных
    target: 'es2015',
    cssCodeSplit: true,
  },
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
      '/specialists': {
        target: 'http://localhost:8000',
        bypass(req) {
          // Браузерная навигация на /specialists → SPA index.html
          if (req.headers.accept && req.headers.accept.includes('text/html')) return '/index.html';
        },
      },
      '/admin': {
        target: 'http://localhost:8000',
        bypass(req) {
          // Браузерная навигация на /admin/dashboard → SPA index.html
          if (req.headers.accept && req.headers.accept.includes('text/html')) return '/index.html';
        },
      },
      '/upload': 'http://localhost:8000',
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
      '/chats': 'http://localhost:8000',
      // Без этой строки запросы верификации уходили в SPA-fallback: Vite отдавал
      // index.html со статусом 200, r.json() падал, и профиль показывал
      // «заявок нет», хотя заявки были. В nginx-конфиге /verification есть.
      '/verification': 'http://localhost:8000',
      // Токен для CSRF-защиты: без него все изменяющие запросы получают 403.
      '/csrf-token': 'http://localhost:8000',
      // Модуль маркетплейса товаров. Пути /products и /products/:id совпадают
      // с маршрутами SPA, поэтому навигацию браузера уводим в index.html
      // (иначе переход по ссылке отдаст JSON вместо страницы).
      '/products': {
        target: 'http://localhost:8000',
        bypass(req) {
          if (req.headers.accept && req.headers.accept.includes('text/html')) return '/index.html';
        },
      },
      '/orders': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
