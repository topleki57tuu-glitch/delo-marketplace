import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { compression } from 'vite-plugin-compression2'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Сжатые копии .gz и .br рядом с файлами сборки (nginx отдаёт .gz через
    // gzip_static). Прежний vite-plugin-compression заброшен с 2022 года и в
    // Vite 8 молча перестал создавать .br: два его экземпляра делят общий кэш.
    compression({
      algorithms: ['gzip', 'brotliCompress'],
      threshold: 1024, // Только файлы > 1KB
    }),
  ],
  build: {
    // JS минифицирует Oxc, CSS — Lightning CSS (по умолчанию в Vite 8).
    // Прежний блок build.esbuildOptions с drop: ['console'] не был опцией Vite
    // и ни на что не влиял; console.log в коде нет, а console.error/warn
    // нужны для диагностики, поэтому их сознательно оставляем.
    cssMinify: true,
    rolldownOptions: {
      output: {
        // Вендорные библиотеки — отдельными чанками: они меняются реже кода
        // приложения и дольше живут в кэше браузера. Объектная форма
        // manualChunks в Vite 8 не поддерживается, поэтому — codeSplitting.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'date-vendor', test: /node_modules[\\/]date-fns[\\/]/ },
            { name: 'state-vendor', test: /node_modules[\\/]zustand[\\/]/ },
          ],
        },
      },
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
      // Путь /chats совпадает с маршрутом SPA, поэтому навигацию браузера
      // уводим в index.html — иначе прямой заход и F5 отдают JSON
      // {"detail":"Not authenticated"} вместо страницы. У /tasks, /products,
      // /specialists и /admin bypass был, а у /chats его забыли.
      '/chats': {
        target: 'http://localhost:8000',
        bypass(req) {
          if (req.headers.accept && req.headers.accept.includes('text/html')) return '/index.html';
        },
      },
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
