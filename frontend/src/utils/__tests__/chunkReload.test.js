import { describe, it, expect, vi } from 'vitest';
import { shouldReload, installChunkReload, RELOAD_COOLDOWN_MS } from '../chunkReload';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

function fakeWindow({ onLine = true } = {}) {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    navigator: { onLine },
    sessionStorage: memoryStorage(),
    location: { reload: vi.fn() },
  };
}

describe('shouldReload', () => {
  it('первая ошибка — перезагрузка, повтор в течение минуты — нет', () => {
    const storage = memoryStorage();
    expect(shouldReload(storage, 1_000_000)).toBe(true);
    expect(shouldReload(storage, 1_000_000 + 5_000)).toBe(false);
    expect(shouldReload(storage, 1_000_000 + RELOAD_COOLDOWN_MS)).toBe(true);
  });

  it('недоступное хранилище — без перезагрузки, чтобы не зациклиться', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} };
    expect(shouldReload(broken)).toBe(false);
  });
});

describe('installChunkReload', () => {
  it('перезагружает страницу по vite:preloadError один раз', () => {
    const win = fakeWindow();
    installChunkReload(win);

    win.dispatchEvent(new Event('vite:preloadError'));
    win.dispatchEvent(new Event('vite:preloadError'));

    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('без сети не перезагружает: браузер показал бы пустую страницу', () => {
    const win = fakeWindow({ onLine: false });
    installChunkReload(win);

    win.dispatchEvent(new Event('vite:preloadError'));

    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
