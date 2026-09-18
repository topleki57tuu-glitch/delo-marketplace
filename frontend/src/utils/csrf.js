/**
 * CSRF-токен для SPA.
 *
 * Бэкенд использует double-submit: `GET /csrf-token` возвращает токен и кладёт
 * подписанную httpOnly-cookie, а каждый изменяющий запрос должен нести этот же
 * токен в заголовке `X-CSRF-Token`. В production проверка включена всегда
 * (см. backend/app/core/config.py, CSRF_ENABLED = IS_PRODUCTION).
 *
 * Раньше фронтенд про CSRF не знал вообще: токен не запрашивался, заголовок не
 * отправлялся, и все POST/PUT/DELETE отвечали 403 — регистрация, платежи, весь
 * модуль товаров. В разработке проверка выключена, поэтому баг не проявлялся.
 *
 * Заголовок подставляется один раз здесь, обёрткой над fetch, а не в каждом
 * вызове: так его получают и уже существующие места, и новые.
 */

const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_ENDPOINT = '/csrf-token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

let token = null;
let inflight = null;

/** Получить токен, переиспользуя уже идущий запрос. */
async function ensureToken(force = false) {
  if (token && !force) return token;
  if (inflight && !force) return inflight;

  inflight = fetch(CSRF_ENDPOINT, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      token = data?.csrf_token || null;
      return token;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

function methodOf(input, init) {
  return String(
    init?.method || (typeof input === 'object' && input?.method) || 'GET'
  ).toUpperCase();
}

function withHeader(input, init, value) {
  const headers = new Headers(init?.headers || (typeof input === 'object' ? input.headers : undefined));
  headers.set(CSRF_HEADER, value);

  // Если передали готовый Request — пересобираем его, иначе init неприменим.
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return [new Request(input, { headers }), undefined];
  }
  return [input, { ...(init || {}), headers, credentials: init?.credentials ?? 'include' }];
}

/** Обёртка над fetch, которая сама добавляет CSRF-заголовок к изменяющим запросам. */
export function installCsrfFetch() {
  if (typeof window === 'undefined' || window.__csrfFetchInstalled) return;
  window.__csrfFetchInstalled = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    if (SAFE_METHODS.includes(methodOf(input, init))) {
      return original(input, init);
    }

    const current = await ensureToken();
    if (!current) return original(input, init);

    const [req, opts] = withHeader(input, init, current);
    let response = await original(req, opts);

    // Cookie живёт 4 часа — если сессия длиннее, токен мог протухнуть.
    // Обновляем его и повторяем ровно один раз.
    if (response.status === 403) {
      const retryToken = await ensureToken(true);
      if (retryToken && retryToken !== current) {
        const [req2, opts2] = withHeader(input, init, retryToken);
        response = await original(req2, opts2);
      }
    }

    return response;
  };
}

/** Явный прогрев токена при старте приложения. */
export const primeCsrfToken = () => ensureToken();

export default installCsrfFetch;
