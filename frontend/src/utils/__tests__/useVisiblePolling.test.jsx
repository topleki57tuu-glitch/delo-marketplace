import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisiblePolling } from '../useVisiblePolling';

/**
 * Профиль и уведомления раньше опрашивались по таймеру всегда — даже из
 * забытой фоновой вкладки (профиль — каждые 5 секунд). Теперь опрос идёт,
 * только пока вкладка на экране, а при возвращении данные освежаются сразу.
 */

let visibility = 'visible';

function setVisibility(value) {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  delete document.visibilityState;
});

describe('useVisiblePolling', () => {
  it('вызывает callback раз в интервал, пока вкладка видна', () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 30000));
    expect(cb).not.toHaveBeenCalled(); // первый запрос делает сам компонент
    vi.advanceTimersByTime(29999);
    expect(cb).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('в фоновой вкладке не опрашивает', () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 30000));
    setVisibility('hidden');
    vi.advanceTimersByTime(5 * 60000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('при возвращении на вкладку сразу обновляет и продолжает опрос', () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 30000));
    setVisibility('hidden');
    vi.advanceTimersByTime(120000);
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('быстрое переключение вкладок не дёргает сервер повторно', () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 30000, { refreshAfterMs: 10000 }));
    vi.advanceTimersByTime(3000);
    setVisibility('hidden');
    vi.advanceTimersByTime(2000);
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled();
  });

  it('открытая в фоне вкладка не запускает таймер до показа', () => {
    visibility = 'hidden';
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 15000));
    vi.advanceTimersByTime(60000);
    expect(cb).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('enabled=false — без опроса; после размонтирования таймер снят', () => {
    const cb = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useVisiblePolling(cb, 30000, { enabled: on }), {
      initialProps: { on: false },
    });
    vi.advanceTimersByTime(90000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled();

    rerender({ on: true });
    vi.advanceTimersByTime(30000);
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(90000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('берёт свежий callback без перезапуска таймера', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useVisiblePolling(cb, 30000), { initialProps: { cb: first } });
    vi.advanceTimersByTime(20000);
    rerender({ cb: second });
    vi.advanceTimersByTime(10000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
