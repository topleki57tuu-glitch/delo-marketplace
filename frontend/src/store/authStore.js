import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const SIGNED_OUT = { token: null, refreshToken: null, role: null, user: null, isAuth: false };

export const useAuthStore = create(
    persist(
        (set, get) => ({
            ...SIGNED_OUT,
            // refresh-токен нужен, чтобы продлевать сессию (utils/session.js).
            // Необязательный аргумент: смена роли выдаёт новый access-токен без
            // refresh, и прежний refresh при этом должен остаться.
            login: (t, r, refresh) =>
                set((s) => ({ token: t, role: r, isAuth: true, refreshToken: refresh ?? s.refreshToken })),
            // Новый access-токен после продления сессии.
            setToken: (t) => set({ token: t }),
            // Выход по кнопке: отзываем refresh-токен этого устройства, иначе он
            // остался бы рабочим ещё 7 дней. Ответ не ждём — выйти из интерфейса
            // нужно сразу, даже если сеть недоступна.
            logout: () => {
                const refresh = get().refreshToken;
                set(SIGNED_OUT);
                if (refresh && typeof fetch === 'function') {
                    // Через Promise: синхронное исключение из fetch (подменённый
                    // fetch, нет сети в старом браузере) тоже не должно сорвать выход.
                    Promise.resolve()
                        .then(() => fetch('/auth/logout', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ refresh_token: refresh }),
                        }))
                        .catch(() => {});
                }
            },
            // Сессия закончилась сама (refresh отозван или истёк) — отзывать нечего.
            clearSession: () => set(SIGNED_OUT),
            updateUser: (userData) => set({ user: userData }),
        }),
        { name: 'auth' }
    )
);
