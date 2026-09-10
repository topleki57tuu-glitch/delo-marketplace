import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const push = useCallback((type, text) => {
        const id = ++toastId;
        setToasts(prev => [...prev.slice(-3), { id, type, text }]);
        setTimeout(() => dismiss(id), 4500);
    }, [dismiss]);

    const toast = useMemo(() => ({
        success: (text) => push('success', text),
        error: (text) => push('error', text),
        info: (text) => push('info', text),
    }), [push]);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-80 z-[100] flex flex-col gap-3">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        role="status"
                        className={`flex items-start gap-3 glass rounded-xl shadow-pop p-3.5 pr-9 relative font-semibold text-sm ${t.type === 'error' ? 'text-danger' : 'text-ink'}`}
                    >
                        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-extrabold ${t.type === 'error' ? 'bg-danger' : t.type === 'info' ? 'bg-accent' : 'bg-success'}`}>
                            {t.type === 'error' ? '!' : t.type === 'info' ? 'i' : '✓'}
                        </span>
                        <span className="pt-0.5">{t.text}</span>
                        <button
                            onClick={() => dismiss(t.id)}
                            className="absolute top-1.5 right-2 text-muted hover:text-ink font-extrabold transition"
                            aria-label="Закрыть уведомление"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
};
