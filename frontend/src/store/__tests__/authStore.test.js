import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Сброс состояния перед каждым тестом
    useAuthStore.setState({
      token: null,
      user: null,
      role: null,
      isAuth: false
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
});
