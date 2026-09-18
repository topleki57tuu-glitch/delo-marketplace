import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { installCsrfFetch, primeCsrfToken } from './utils/csrf.js'
import './index.css'

// Ставим обёртку над fetch до первого запроса приложения: без неё все
// изменяющие запросы получают 403 в production (см. utils/csrf.js).
installCsrfFetch()
primeCsrfToken()

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ToastProvider>
            <App />
        </ToastProvider>
    </React.StrictMode>,
)
