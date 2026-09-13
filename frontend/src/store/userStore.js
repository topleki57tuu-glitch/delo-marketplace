import { create } from 'zustand';

export const useUserStore = create((set, get) => ({
  // Кеш пользователей: id -> user (для профилей специалистов)
  users: {},
  loading: false,
  error: null,

  // Получить публичный профиль пользователя
  fetchUser: async (userId, token = null) => {
    // Проверяем кеш
    const cached = get().users[userId];
    if (cached) return cached;

    set({ loading: true, error: null });
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/users/${userId}/public`, { headers });

      if (!res.ok) throw new Error('Failed to fetch user');
      const user = await res.json();

      set(state => ({
        users: { ...state.users, [userId]: user },
        loading: false
      }));

      return user;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  // Обновить пользователя в кеше
  updateUser: (userId, updates) => {
    set(state => ({
      users: {
        ...state.users,
        [userId]: { ...state.users[userId], ...updates }
      }
    }));
  },

  // Получить пользователя из кеша
  getUser: (userId) => get().users[userId],

  // Очистить кеш
  clear: () => {
    set({
      users: {},
      loading: false,
      error: null
    });
  }
}));
