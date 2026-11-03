/**
 * Продление сессии по refresh-токену.
 *
 * Access-токен живёт 15 минут, refresh — 7 дней (backend/app/core/security.py).
 * Раньше фронтенд refresh-токен просто не сохранял: через 15 минут после
 * входа каждый запрос получал 401, а интерфейс продолжал показывать
 * пользователя вошедшим — кнопки «не работали», профиль переставал
 * обновляться, а ошибка выглядела как «Неверный или просроченный токен».
 *
 * Как и CSRF (utils/csrf.js), это обёртка над fetch, а не правка каждого
 * вызова: Bearer-токен подставляют десятки мест, и все они получают
 * продление сразу.
 *
 * Порядок: запрос с Bearer-токеном получил 401 → если токен истёк (или это
 * GET, который безопасно повторить) → один общий запрос на /auth/refresh →
 * новый токен в store → повтор исходного запроса с новым токеном.
 * Refresh-токен отозван или истёк → сессия закрыта: store очищается, а
 * приложение получает SESSION_EXPIRED_EVENT и предлагает войти снова.
 */
import { useAuthStore } from '../store/authStore';

export const SESSION_EXPIRED_EVENT = 'delo:session-expired';

const REFRESH_URL = '/auth/refresh';

// Здесь 401 — ответ по существу («неверный пароль»), а не «токен истёк».
const NO_RETRY_PREFIXES = ['/login', '/register', '/auth/', '/refresh', '/logout'];

// Запас на расхождение часов браузера и сервера.
const EXPIRY_SKEW_MS = 5000;

/** Момент истечения JWT (мс) — только чтение поля exp, подпись не проверяется. */
export function tokenExpiresAt(token) {
  try {
    const part = String(token).split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpired(token, now = Date.now()) {
  const at = tokenExpiresAt(token);
  return at !== null && at <= now + EXPIRY_SKEW_MS;
}

export function bearerOf(input, init) {
  try {
    const source = init?.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    const value = new Headers(source).get('Authorization');
    return value && value.startsWith('Bearer ') ? value.slice(7) : null;
  } catch {
    return null;
  }
}

export function sameOriginPath(input) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Обёртка над fetch. Отдельно от установки — чтобы тест мог передать
 * подставной fetch и не трогать глобальный.
 *
 * Результат запроса на продление: строка — новый токен; null — сессия
 * мертва (refresh отозван, истёк или его нет); undefined — сбой сети или
 * сервера, сессию не трогаем и отдаём исходный 401.
 */
export function createSessionFetch(inner) {
  let inflight = null;

  const requestNewToken = () => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return Promise.resolve(null);
    if (!inflight) {
      inflight = inner(REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json().catch(() => null);
            return data?.access_token || null;
          }
          return [400, 401, 403, 422].includes(res.status) ? null : undefined;
        })
        .catch(() => undefined)
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  return async function sessionFetch(input, init) {
    const response = await inner(input, init);
    if (response.status !== 401) return response;

    const sent = bearerOf(input, init);
    if (!sent) return response;
    const path = sameOriginPath(input);
    if (!path || NO_RETRY_PREFIXES.some((p) => path.startsWith(p))) return response;
    // Готовый Request повторить нельзя: его тело уже прочитано.
    if (typeof Request !== 'undefined' && input instanceof Request) return response;
    // Живой токен и изменяющий запрос: 401 здесь — ответ по существу,
    // а повтор мог бы выполнить действие дважды.
    const method = String(init?.method || 'GET').toUpperCase();
    if (!isExpired(sent) && method !== 'GET') return response;

    const current = useAuthStore.getState().token;
    // Другой запрос уже продлил сессию — повторяем с актуальным токеном.
    const fresh = current && current !== sent ? current : await requestNewToken();
    if (fresh === undefined) return response;

    if (!fresh) {
      // Пользователь мог за это время войти заново — его новую сессию не трогаем.
      if (useAuthStore.getState().token === sent) {
        useAuthStore.getState().clearSession();
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
      return response;
    }

    if (useAuthStore.getState().token === sent) useAuthStore.getState().setToken(fresh);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${fresh}`);
    return inner(input, { ...(init || {}), headers });
  };
}

/** Ставит обёртку поверх текущего window.fetch (после installCsrfFetch). */
export function installSessionRefresh() {
  if (typeof window === 'undefined' || window.__sessionRefreshInstalled) return;
  window.__sessionRefreshInstalled = true;
  window.fetch = createSessionFetch(window.fetch.bind(window));
}
