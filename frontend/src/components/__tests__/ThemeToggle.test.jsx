import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSwitch, ThemeToggle } from '../ThemeToggle.jsx';
import { THEME_STORAGE_KEY, resetThemeForTests } from '../../utils/theme.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: fakeStorage(), configurable: true, writable: true });
  resetThemeForTests();
  document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
  it('переключает светлую и тёмную тему одним нажатием', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Включить тёмную тему' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Включить светлую тему' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});

describe('ThemeSwitch', () => {
  it('показывает текущий выбор и позволяет вернуться к «как в системе»', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    expect(screen.getByRole('radio', { name: /Как в системе|Авто/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: /Тёмная/ }));
    expect(screen.getByRole('radio', { name: /Тёмная/ })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByRole('radio', { name: /Как в системе|Авто/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
