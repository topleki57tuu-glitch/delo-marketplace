import { create } from 'zustand';

/**
 * Централизованное хранилище пользователей.
 *
 * Кеширует профили специалистов и других пользователей
 * для избежания повторных запросов.
 */
export const useUserStore = create((set, get) => ({
  // Кеш пользователей: id -> user
  users: {},

  loading: false,
  error: null,

  /**
   * Получить публичный профиль пользователя.
   * С автоматическим кешированием.
   *
   * @param {number} userId - ID пользователя
   * @param {string} token - JWT токен (опционально)
   * @param {boolean} force - Принудительная загрузка (игнорируя кеш)
   */
  fetchUser: async (userId, token = null, force = false) => {
    // Проверяем кеш
    const cached = get().users[userId];
    if (cached && !force) {
      return cached;
    }

    set({ loading: true, error: null });
    try {
      const headers = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`/users/${userId}/public`, { headers });
      if (!res.ok) throw new Error('User not found');

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

  /**
   * Получить отзывы пользователя.
   *
   * @param {number} userId - ID пользователя
   */
  fetchUserReviews: async (userId) => {
    try {
      const res = await fetch(`/users/${userId}/reviews`);
      if (!res.ok) throw new Error('Reviews not found');

      const reviews = await res.json();

      // Обновляем пользователя с отзывами
      set(state => ({
        users: {
          ...state.users,
          [userId]: {
            ...state.users[userId],
            reviews
          }
        }
      }));

      return reviews;
    } catch (error) {
      console.error('Failed to fetch reviews:', error);
      return [];
    }
  },

  /**
   * Обновить данные пользователя в кеше.
   *
   * @param {number} userId - ID пользователя
   * @param {object} updates - Обновления для мержа
   */
  updateUser: (userId, updates) => {
    set(state => {
      const user = state.users[userId];
      if (!user) return state;

      return {
        users: {
          ...state.users,
          [userId]: { ...user, ...updates }
        }
      };
    });
  },

  /**
   * Очистить кеш пользователя.
   *
   * @param {number} userId - ID пользователя
   */
  clearUser: (userId) => {
    set(state => {
      const { [userId]: removed, ...rest } = state.users;
      return { users: rest };
    });
  },

  /**
   * Очистить весь кеш.
   */
  clearCache: () => set({ users: {} }),

  /**
   * Сбросить ошибку.
   */
  clearError: () => set({ error: null }),

  // Селекторы

  /**
   * Получить пользователя из кеша.
   *
   * @param {number} userId - ID пользователя
   */
  getUser: (userId) => get().users[userId],

  /**
   * Проверить наличие пользователя в кеше.
   *
   * @param {number} userId - ID пользователя
   */
  hasUser: (userId) => !!get().users[userId],
}));
