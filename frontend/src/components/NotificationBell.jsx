import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const TYPE_ICONS = {
    new_response: '💬',
    assigned:     '🎉',
    message:      '✉️',
    completed:    '✅',
    review:       '⭐',
};

export const NotificationBell = ({ token }) => {
    const [count, setCount]             = useState(0);
    const [notifications, setNotifs]    = useState([]);
    const [open, setOpen]               = useState(false);
    const panelRef                      = useRef(null);

    const headers = { Authorization: `Bearer ${token}` };

    const fetchCount = () => {
        axios.get(`${API_URL}/notifications/unread-count`, { headers })
            .then(r => setCount(r.data.count))
            .catch(() => {});
    };

    const fetchAll = () => {
        axios.get(`${API_URL}/notifications`, { headers })
            .then(r => setNotifs(r.data))
            .catch(() => {});
    };

    useEffect(() => {
        if (!token) return;
        fetchCount();
        const interval = setInterval(fetchCount, 15000);
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
        setOpen(o => !o);
        if (!open) fetchAll();
    };

    const markAllRead = async () => {
        await axios.put(`${API_URL}/notifications/read-all`, {}, { headers });
        setCount(0);
        setNotifs(n => n.map(x => ({ ...x, is_read: true })));
    };

    const markRead = async (id) => {
        await axios.put(`${API_URL}/notifications/${id}/read`, {}, { headers });
        setNotifs(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
        setCount(c => Math.max(0, c - 1));
    };

    return (
        <div className="relative" ref={panelRef}>
            <button
                onClick={handleOpen}
                className="relative p-2 rounded-lg bg-surface-2 border border-border transition hover:border-border-bright hover:bg-elevated"
                title="Уведомления"
            >
                <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {count > 0 && (
                    <span className="absolute -top-2 -right-2 bg-danger text-white text-[10px] font-extrabold min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full">
                        {count > 99 ? '99+' : count}
                    </span>
                )}
            </button>

            {open && (
                <div className="fixed inset-x-4 top-20 mx-auto max-w-sm sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:mx-0 sm:w-80 glass rounded-2xl shadow-pop z-50">
                    <div className="flex justify-between items-center px-4 py-3 border-b border-border">
                        <h3 className="font-display font-bold uppercase text-sm">Уведомления</h3>
                        {count > 0 && (
                            <button
                                onClick={markAllRead}
                                className="text-[10px] text-accent-bright hover:underline font-bold uppercase tracking-wider"
                            >
                                Прочитать все
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="py-10 text-center text-muted">
                                <div className="text-4xl mb-2">🔔</div>
                                <p className="text-sm font-semibold">Уведомлений пока нет</p>
                            </div>
                        ) : (
                            notifications.map(n => (
                                <div
                                    key={n.id}
                                    onClick={() => !n.is_read && markRead(n.id)}
                                    className={`px-4 py-3 border-b border-border/60 cursor-pointer hover:bg-surface-2 transition ${!n.is_read ? 'bg-surface-2/60' : ''}`}
                                >
                                    <div className="flex gap-3 items-start">
                                        <span className="text-xl mt-0.5 shrink-0">
                                            {TYPE_ICONS[n.type] || '🔔'}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm leading-tight">
                                                {n.title}
                                            </p>
                                            <p className="text-xs text-muted mt-0.5 leading-snug font-medium">
                                                {n.text}
                                            </p>
                                            <p className="text-[10px] text-muted/60 mt-1 font-semibold uppercase tracking-wide">
                                                {new Date(n.created_at).toLocaleString('ru-RU', {
                                                    day: '2-digit', month: 'short',
                                                    hour: '2-digit', minute: '2-digit'
                                                })}
                                            </p>
                                        </div>
                                        {!n.is_read && (
                                            <span className="w-2.5 h-2.5 rounded-full bg-accent shrink-0 mt-1" />
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
