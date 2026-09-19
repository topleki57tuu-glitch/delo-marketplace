import React, { useState, useEffect, useRef } from 'react';
import {
    IconBell,
    IconCheck,
    IconMail,
    IconMessages,
    IconParty,
    IconStar,
} from './icons.jsx';

// Используем относительные пути (проксируются vite → backend:8000)
// Значения — компоненты иконок, а не строки: они рендерятся как JSX-потомок
const TYPE_ICONS = {
    new_response: <IconMessages size={18} />,
    assigned:     <IconParty size={18} />,
    message:      <IconMail size={18} />,
    completed:    <IconCheck size={18} />,
    review:       <IconStar size={18} />,
};

export const NotificationBell = ({ token }) => {
    const [count, setCount]          = useState(0);
    const [notifications, setNotifs] = useState([]);
    const [open, setOpen]            = useState(false);
    const panelRef                   = useRef(null);

    const headers = { Authorization: `Bearer ${token}` };

    const fetchNotifications = () => {
        // GET /notifications/ → { notifications: [...], unread_count: N }
        fetch('/notifications/', { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                setNotifs(data.notifications || []);
                setCount(data.unread_count || 0);
            })
            .catch(() => {});
    };

    useEffect(() => {
        if (!token) return;
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 15000);
        return () => clearInterval(interval);
    }, [token]);

    useEffect(() => {
        const handler = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleOpen = () => {
        const next = !open;
        setOpen(next);
        if (next) fetchNotifications();
    };

    const markAllRead = async () => {
        // POST /notifications/read-all
        await fetch('/notifications/read-all', { method: 'POST', headers });
        setCount(0);
        setNotifs(n => n.map(x => ({ ...x, is_read: true })));
    };

    const markRead = async (id) => {
        // PUT /notifications/{id}/read
        await fetch(`/notifications/${id}/read`, { method: 'PUT', headers });
        setNotifs(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
        setCount(c => Math.max(0, c - 1));
    };

    return (
        <div className="relative" ref={panelRef}>
            <button
                onClick={handleOpen}
                className="relative p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                title="Уведомления"
                aria-label="Уведомления"
                aria-expanded={open}
                aria-haspopup="true"
            >
                <svg className="w-5 h-5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {count > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-extrabold min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full ring-2 ring-white dark:ring-slate-900">
                        {count > 99 ? '99+' : count}
                    </span>
                )}
            </button>

            {open && (
                // Фон задан явными утилитами, а не классом glass: панель висит
                // поверх плотного текста формы, и просвечивать он не должен ни
                // при каких обстоятельствах. Раньше здесь был только glass,
                // которого не существовало в CSS — панель была полностью
                // прозрачной, и содержимое читалось вместе с текстом страницы.
                <div className="fixed inset-x-4 top-20 mx-auto max-w-sm sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:mx-0 sm:w-80 rounded-2xl shadow-pop z-50 overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40">
                        <h3 className="font-display font-bold uppercase text-sm text-slate-900 dark:text-white">Уведомления</h3>
                        {count > 0 && (
                            <button
                                onClick={markAllRead}
                                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-bold uppercase tracking-wider"
                            >
                                Прочитать все
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                                <div className="mb-2 flex justify-center text-slate-300 dark:text-slate-600"><IconBell size={36} /></div>
                                <p className="text-sm font-semibold">Уведомлений пока нет</p>
                            </div>
                        ) : (
                            notifications.map(n => (
                                <div
                                    key={n.id}
                                    onClick={() => !n.is_read && markRead(n.id)}
                                    className={`px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 transition ${!n.is_read ? 'bg-slate-50 dark:bg-slate-700/30' : ''}`}
                                >
                                    <div className="flex gap-3 items-start">
                                        <span className="text-xl mt-0.5 shrink-0">
                                            {TYPE_ICONS[n.type] || <IconBell size={18} />}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm leading-tight text-slate-900 dark:text-white">
                                                {n.title}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug font-medium">
                                                {n.text}
                                            </p>
                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-semibold uppercase tracking-wide">
                                                {new Date(n.created_at).toLocaleString('ru-RU', {
                                                    day: '2-digit', month: 'short',
                                                    hour: '2-digit', minute: '2-digit'
                                                })}
                                            </p>
                                        </div>
                                        {!n.is_read && (
                                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0 mt-1" />
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
