import { useEffect, useRef } from 'react';

const isPageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Периодически вызывает callback, но только пока вкладка на экране.
 *
 * - Вкладка в фоне — опрос на паузе: обновлять то, чего никто не видит,
 *   незачем, а сервер не получает лишних запросов от забытых вкладок.
 * - Вернулись на вкладку — сразу обновляем (если с прошлого раза прошло
 *   больше refreshAfterMs) и запускаем таймер заново. Так после оплаты
 *   в соседней вкладке баланс обновится без ожидания.
 * - enabled=false — ничего не делаем (например, никто не вошёл).
 *
 * Первый запрос делает сам компонент (обычно при входе), поэтому хук
 * считает, что данные только что получены, и ждёт первый интервал.
 * callback может быть новой функцией на каждом рендере — таймер из-за
 * этого не пересоздаётся.
 */
export function useVisiblePolling(callback, intervalMs, { enabled = true, refreshAfterMs = 10000 } = {}) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    let lastRun = Date.now();
    const run = () => {
      lastRun = Date.now();
      saved.current();
    };
    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (!isPageVisible()) {
        stop();
        return;
      }
      if (Date.now() - lastRun >= refreshAfterMs) run();
      start();
    };

    if (isPageVisible()) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs, refreshAfterMs]);
}
