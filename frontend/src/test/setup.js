import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';

// Mock fetch для тестов
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
// В Vitest 5 присваивание глобалу доходит до window jsdom, а у него
// localStorage — только геттер: прямое присваивание падает с TypeError.
// Наборы с @vitest-environment node window не имеют — для них мок кладём в globalThis.
Object.defineProperty(typeof window !== 'undefined' ? window : globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

beforeAll(() => {
  // Setup перед всеми тестами
});

afterEach(() => {
  // Очистка после каждого теста
  vi.clearAllMocks();
  localStorage.clear();
});

afterAll(() => {
  // Cleanup после всех тестов
  vi.restoreAllMocks();
});
