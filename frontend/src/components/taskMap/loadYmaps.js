// Загрузка API Яндекс Карт — один раз на страницу, с понятным отказом.
//
// Раньше компонент ждал только ошибку загрузки самого скрипта. Если же скрипт
// загружался, а его модули — нет (например, их блокировала политика
// безопасности сайта), ymaps.ready не наступал, и «Загрузка интерактивной
// карты…» крутилась бесконечно, без сообщения и без работающего «Повторить».
// Теперь любой сбой — ошибка скрипта, отказ ymaps.ready, отсутствие ymaps
// после загрузки или тайм-аут — отклоняет промис, а следующая попытка
// загружает API заново.
import { YMAPS_URL } from './taskMapConfig.js';

const SCRIPT_ID = 'ymaps-script';
export const YMAPS_LOAD_TIMEOUT_MS = 25000;

let pending = null;

// Сбрасывает недогруженный API, чтобы следующая попытка начала с чистого листа.
export function resetYmapsLoader() {
  pending = null;
  document.getElementById(SCRIPT_ID)?.remove();
  try {
    delete window.ymaps;
  } catch {
    window.ymaps = undefined;
  }
}

function describe(reason, fallback) {
  if (reason instanceof Error) return reason;
  if (reason?.message) return new Error(reason.message);
  return new Error(fallback);
}

export function loadYmaps({ timeoutMs = YMAPS_LOAD_TIMEOUT_MS } = {}) {
  if (pending) return pending;

  const attempt = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(window.ymaps);
    };
    const fail = (reason, fallback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(describe(reason, fallback));
    };
    const whenReady = () => {
      window.ymaps.ready(succeed, (err) => fail(err, 'Модули API Яндекс Карт не загрузились'));
    };

    timer = setTimeout(() => fail(null, 'API Яндекс Карт не ответило вовремя'), timeoutMs);

    if (typeof window.ymaps?.ready === 'function') {
      whenReady();
      return;
    }

    document.getElementById(SCRIPT_ID)?.remove();
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = YMAPS_URL;
    script.async = true;
    script.onload = () => {
      if (typeof window.ymaps?.ready === 'function') whenReady();
      else fail(null, 'Скрипт Яндекс Карт загрузился, но API не появилось');
    };
    script.onerror = () => fail(null, 'Скрипт API Яндекс Карт не загрузился');
    document.head.appendChild(script);
  });

  pending = attempt;
  // Неудачная попытка не кэшируется: «Повторить» загрузит API заново.
  attempt.catch(() => {
    if (pending === attempt) resetYmapsLoader();
  });
  return attempt;
}
