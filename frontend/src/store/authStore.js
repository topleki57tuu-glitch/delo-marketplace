import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
    persist(
        (set) => ({
            token: null,
            role: null,
            user: null,          // полный объект профиля с сервера
            isAuth: false,
            login: (t, r) => set({ token: t, role: r, isAuth: true }),
            logout: () => set({ token: null, role: null, user: null, isAuth: false }),
            updateUser: (userData) => set({ user: userData }),
        }),
        { name: 'auth' }
    )
);
