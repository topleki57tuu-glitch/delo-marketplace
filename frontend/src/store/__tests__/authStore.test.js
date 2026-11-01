import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Сброс состояния перед каждым тестом
    useAuthStore.setState({
      token: null,
      user: null,
      role: null,
      isAuth: false,
      refreshToken: null
    });
    localStorage.clear();
  });

  describe('login', () => {
    it('should login user with token and role', () => {
      const { login } = useAuthStore.getState();

      login('test-token-123', 'customer');

      const state = useAuthStore.getState();
      expect(state.token).toBe('test-token-123');
      expect(state.role).toBe('customer');
      expect(state.isAuth).toBe(true);
    });
  });

  describe('logout', () => {
    it('should clear user state', () => {
      // Сначала логинимся
      useAuthStore.setState({
        token: 'test-token',
        user: { id: 1, email: 'test@test.com' },
        role: 'customer',
        isAuth: true
      });

      const { logout } = useAuthStore.getState();
      logout();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.role).toBeNull();
      expect(state.isAuth).toBe(false);
    });
  });

  describe('updateUser', () => {
    it('should update user data', () => {
      const { updateUser } = useAuthStore.getState();

      const userData = {
        id: 1,
        email: 'user@example.com',
        name: 'Test User',
        balance: 5000
      };

      updateUser(userData);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(userData);
    });

    it('should replace user data completely', () => {
      useAuthStore.setState({
        user: { id: 1, email: 'old@test.com', balance: 1000 }
      });

      const { updateUser } = useAuthStore.getState();
      const newUserData = { id: 1, email: 'new@test.com', balance: 2000, name: 'Updated' };
      updateUser(newUserData);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(newUserData);
    });
  });

  describe('refresh-токен', () => {
    it('login сохраняет refresh-токен', () => {
      useAuthStore.getState().login('access-1', 'customer', 'refresh-1');
      expect(useAuthStore.getState().refreshToken).toBe('refresh-1');
    });

    it('новый access без refresh (смена роли) прежний refresh не стирает', () => {
      useAuthStore.getState().login('access-1', 'customer', 'refresh-1');
      useAuthStore.getState().login('access-2', 'specialist');
      const state = useAuthStore.getState();
      expect(state.token).toBe('access-2');
      expect(state.role).toBe('specialist');
      expect(state.refreshToken).toBe('refresh-1');
    });

    it('logout отзывает refresh-токен на сервере', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });
      useAuthStore.getState().login('access-1', 'customer', 'refresh-1');

      useAuthStore.getState().logout();
      expect(useAuthStore.getState().refreshToken).toBeNull();
      await Promise.resolve();
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'refresh-1' }),
      }));
    });

    it('logout не падает, если запрос на сервер не удался', async () => {
      global.fetch.mockImplementation(() => { throw new TypeError('Failed to fetch'); });
      useAuthStore.getState().login('access-1', 'customer', 'refresh-1');

      expect(() => useAuthStore.getState().logout()).not.toThrow();
      await Promise.resolve();
      expect(useAuthStore.getState().isAuth).toBe(false);
    });

    it('clearSession (сессия истекла сама) на сервер не ходит', () => {
      useAuthStore.getState().login('access-1', 'customer', 'refresh-1');
      useAuthStore.getState().clearSession();
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().refreshToken).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
