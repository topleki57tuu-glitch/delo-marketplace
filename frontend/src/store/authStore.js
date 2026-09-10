import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
    persist(
        (set) => ({
            token: null,
            role: null,
            isAuth: false,
            login: (t, r) => set({ token: t, role: r, isAuth: true }),
            logout: () => set({ token: null, role: null, isAuth: false }),
        }),
        { name: 'auth' }
    )
);
