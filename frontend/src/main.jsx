import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { DialogProvider } from './components/DialogProvider.jsx'
import { installCsrfFetch, primeCsrfToken } from './utils/csrf.js'
import { installSessionRefresh } from './utils/session.js'
import { installProfileSync } from './utils/profileSync.js'
import { installChunkReload } from './utils/chunkReload.js'
import { initTheme } from './utils/theme.js'
import './index.css'

// Ставим обёртку над fetch до первого запроса приложения: без неё все
// изменяющие запросы получают 403 в production (см. utils/csrf.js).
installCsrfFetch()
primeCsrfToken()
// Продление сессии — поверх CSRF-обёртки, чтобы повтор запроса тоже получил
// CSRF-заголовок (см. utils/session.js).
installSessionRefresh()
// После оплаты, покупки или вывода баланс в шапке обновляется сразу, а не
// со следующим опросом профиля (см. utils/profileSync.js).
installProfileSync()
// После деплоя открытая вкладка может просить чанки старой сборки.
installChunkReload()
// Тема: класс .dark уже поставил скрипт в index.html, здесь подключаем
// переключатель и слежение за темой системы (см. utils/theme.js).
initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ToastProvider>
            <DialogProvider>
                <App />
            </DialogProvider>
        </ToastProvider>
    </React.StrictMode>,
)
