import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useNavStore } from '../store/navStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const ChatsDrawer = ({ isOpen, onClose, onSelectTask }) => {
    const { token, role, isAuth } = useAuthStore();
    const { closeAllOverlays, openAuth, openFeed, openTaskChat } = useNavStore();
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isOpen || !token) return;

        setLoading(true);
        setError(null);

        // Fetch user tasks to find all active dialogues
        axios.get(`${API_URL}/tasks/`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        .then(res => {
            const allTasks = res.data || [];
            setTasks(allTasks);
        })
        .catch(err => {
            console.error('Failed to load chats:', err);
            setError('Не удалось загрузить диалоги');
        })
        .finally(() => setLoading(false));
    }, [isOpen, token]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-base/80 backdrop-blur-md flex justify-end transition-opacity">
            <div 
                className="w-full max-w-md bg-surface border-l border-border h-full flex flex-col shadow-2xl p-4 md:p-6 animate-in slide-in-from-right duration-200"
            >
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">💬</span>
                        <h2 className="font-display font-bold text-lg md:text-xl uppercase">
                            Мои чаты и диалоги
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            if (onClose) onClose();
                            closeAllOverlays();
                        }}
                        className="w-9 h-9 rounded-xl bg-surface-2 border border-border text-ink hover:border-accent hover:text-accent flex items-center justify-center font-bold transition"
                    >
                        ✕
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto py-4 space-y-3">
                    {!isAuth ? (
                        <div className="text-center py-12 px-4">
                            <span className="text-4xl block mb-3">🔒</span>
                            <h3 className="font-bold text-base uppercase">Требуется вход</h3>
                            <p className="text-xs text-muted mt-2">
                                Войдите в аккаунт, чтобы просматривать переписку с заказчиками и исполнителями.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    closeAllOverlays();
                                    openAuth();
                                }}
                                className="mt-4 px-5 py-2.5 rounded-xl bg-accent text-white font-bold text-xs uppercase tracking-wider hover:bg-accent-bright transition"
                            >
                                Войти в аккаунт
                            </button>
                        </div>
                    ) : loading ? (
                        <div className="space-y-3 py-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="p-4 rounded-xl bg-surface-2 border border-border animate-pulse flex flex-col gap-2">
                                    <div className="h-4 bg-border rounded w-3/4"></div>
                                    <div className="h-3 bg-border rounded w-1/2"></div>
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="text-center py-8 text-danger text-sm font-semibold">
                            {error}
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-border/80 my-4">
                            <span className="text-4xl block mb-2">📬</span>
                            <h3 className="font-bold text-sm uppercase">Нет активных диалогов</h3>
                            <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
                                Когда вы откликнетесь на заказ или назначите исполнителя, здесь появится рабочий чат.
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    openFeed('list');
                                    window.location.href = '/?view=list';
                                }}
                                className="mt-4 px-4 py-2 rounded-xl bg-surface-2 border border-border text-xs font-bold uppercase tracking-wider hover:border-accent transition"
                            >
                                Перейти к заказам
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-muted px-1">
                                Активные заказы и чаты ({tasks.length})
                            </div>
                            {tasks.slice(0, 15).map(task => (
                                <div
                                    key={task.id}
                                    onClick={() => {
                                        closeAllOverlays();
                                        if (onSelectTask) {
                                            onSelectTask(task);
                                        } else {
                                            openTaskChat(task);
                                        }
                                    }}
                                    className="p-3.5 rounded-xl bg-surface-2/80 hover:bg-surface-2 border border-border hover:border-accent transition cursor-pointer flex flex-col gap-1.5 group"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <h4 className="font-bold text-sm text-ink group-hover:text-accent-bright line-clamp-1">
                                            {task.title}
                                        </h4>
                                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                                            task.status === 'in_progress'
                                                ? 'bg-warning/10 text-warning border-warning/30'
                                                : task.status === 'completed'
                                                ? 'bg-success/10 text-success border-success/30'
                                                : 'bg-accent/10 text-accent border-accent/30'
                                        }`}>
                                            {task.status === 'in_progress' ? 'В работе' : task.status === 'completed' ? 'Завершён' : 'Открыт'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-muted">
                                        <span>Бюджет: <strong className="text-ink">{task.budget ? `${task.budget} ₽` : 'По договорённости'}</strong></span>
                                        <span className="text-accent font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                                            Открыть чат →
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer close */}
                <div className="pt-3 border-t border-border">
                    <button
                        type="button"
                        onClick={() => {
                            if (onClose) onClose();
                            closeAllOverlays();
                        }}
                        className="w-full py-2.5 rounded-xl bg-surface-2 border border-border font-bold text-xs uppercase tracking-wider text-muted hover:text-ink transition"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};
