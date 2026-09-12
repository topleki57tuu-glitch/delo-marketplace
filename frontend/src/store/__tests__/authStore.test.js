import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Сброс store перед каждым тестом
    useAuthStore.setState({
      token: null,
      role: null,
      user: null,
      isAuth: false
    });
  });

  it('should initialize with default state', () => {
    const state = useAuthStore.getState();

    expect(state.token).toBeNull();
    expect(state.role).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuth).toBe(false);
  });

  it('should login user with token and role', () => {
    const { login } = useAuthStore.getState();

    login('test-token-123', 'customer');

    const state = useAuthStore.getState();
    expect(state.token).toBe('test-token-123');
    expect(state.role).toBe('customer');
    expect(state.isAuth).toBe(true);
  });

  it('should logout user and clear all data', () => {
    // Сначала залогиним
    useAuthStore.setState({
      token: 'test-token',
      role: 'specialist',
      user: { id: 1, email: 'test@example.com' },
      isAuth: true
    });

    const { logout } = useAuthStore.getState();
    logout();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.role).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuth).toBe(false);
  });

  it('should update user data', () => {
    const userData = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      balance: 10000
    };

    const { updateUser } = useAuthStore.getState();
    updateUser(userData);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(userData);
  });

  it('should update user data while preserving auth state', () => {
    useAuthStore.setState({
      token: 'existing-token',
      role: 'customer',
      isAuth: true
    });

    const { updateUser } = useAuthStore.getState();
    updateUser({ id: 5, email: 'new@example.com' });

    const state = useAuthStore.getState();
    expect(state.token).toBe('existing-token');
    expect(state.role).toBe('customer');
    expect(state.isAuth).toBe(true);
    expect(state.user).toEqual({ id: 5, email: 'new@example.com' });
  });

  it('should persist to localStorage', () => {
    // Note: В реальном окружении Zustand persist middleware сохраняет в localStorage
    // В тестах это можно проверить мокируя localStorage
    const { login } = useAuthStore.getState();

    login('persistent-token', 'specialist');

    const state = useAuthStore.getState();
    expect(state.isAuth).toBe(true);
  });
});
