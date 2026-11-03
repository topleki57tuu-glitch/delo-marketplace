/**
 * Баланс в шапке после действий пользователя.
 *
 * Профиль опрашивается раз в 30 секунд и только на видимой вкладке
 * (App.jsx, utils/useVisiblePolling.js). Чтобы после оплаты задания,
 * покупки, отмены или вывода баланс не отставал до следующего опроса,
 * обёртка над fetch после успешного изменяющего запроса (POST, PUT, PATCH,
 * DELETE с Bearer-токеном) сообщает приложению: профиль мог измениться.
 * Несколько действий подряд дают один запрос профиля.
 *
 * Сообщения чата, уведомления, загрузка картинок, вход и выход баланс не
 * меняют — после них профиль не перечитываем.
 */
import { bearerOf, sameOriginPath } from './session';

export const PROFILE_STALE_EVENT = 'delo:profile-stale';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IGNORED = [
  /\/messages(\/|$)/,
  /^\/notifications(\/|$)/,
  /^\/upload(\/|$)/,
  /^\/ai(\/|$)/,
  /^\/auth\//,
  /^\/(login|register|logout|refresh)(\/|$)/,
];
const DEBOUNCE_MS = 300;

let pending = null;

/** Попросить приложение перечитать профиль (несколько вызовов подряд — один запрос). */
export function requestProfileRefresh() {
  if (typeof window === 'undefined') return;
  clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    window.dispatchEvent(new CustomEvent(PROFILE_STALE_EVENT));
  }, DEBOUNCE_MS);
}

function methodOf(input, init) {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

/** Обёртка над fetch. Отдельно от установки — чтобы тест мог передать подставной fetch. */
export function createProfileSyncFetch(inner) {
  return async function profileSyncFetch(input, init) {
    const response = await inner(input, init);
    if (response.ok && MUTATING.has(methodOf(input, init)) && bearerOf(input, init)) {
      const path = sameOriginPath(input);
      if (path && !IGNORED.some((re) => re.test(path))) requestProfileRefresh();
    }
    return response;
  };
}

/** Ставит обёртку поверх текущего window.fetch (после installSessionRefresh). */
export function installProfileSync() {
  if (typeof window === 'undefined' || window.__profileSyncInstalled) return;
  window.__profileSyncInstalled = true;
  window.fetch = createProfileSyncFetch(window.fetch.bind(window));
}
