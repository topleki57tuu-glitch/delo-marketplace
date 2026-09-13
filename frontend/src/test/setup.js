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
global.localStorage = localStorageMock;

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
