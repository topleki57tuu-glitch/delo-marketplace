import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getThemeSnapshot,
  readThemePreference,
  resetThemeForTests,
  resolveTheme,
  setThemePreference,
} from '../theme.js';

/**
 * Тема — класс .dark на <html> и выбор в localStorage. Тот же алгоритм
 * повторён в скрипте index.html, поэтому ключ и значения проверяются явно.
 */

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
    _data: data,
  };
}

function mockSystemDark(matches) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

let storage;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  storage = fakeStorage();
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
  resetThemeForTests();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('theme', () => {
  it('без сохранённого выбора — «как в системе»', () => {
    expect(readThemePreference()).toBe('system');
  });

  it('мусор в хранилище не ломает выбор', () => {
    storage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemePreference()).toBe('system');
  });

  it('недоступное хранилище (приватный режим Safari) не роняет приложение', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(readThemePreference()).toBe('system');
    } finally {
      // общий afterEach чистит localStorage — вернём рабочее хранилище
      Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
    }
  });

  it('«как в системе» следует настройке устройства', () => {
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockSystemDark(false);
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('applyTheme ставит класс dark и color-scheme на <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('выбор сохраняется, а «как в системе» удаляет ключ', () => {
    setThemePreference('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getThemeSnapshot()).toEqual({ preference: 'dark', resolved: 'dark' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    setThemePreference('system');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getThemeSnapshot().preference).toBe('system');
  });

  it('неизвестное значение игнорируется', () => {
    setThemePreference('dark');
    setThemePreference('neon');
    expect(getThemeSnapshot().preference).toBe('dark');
  });
});
