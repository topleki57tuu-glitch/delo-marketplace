import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSessionFetch, tokenExpiresAt, SESSION_EXPIRED_EVENT } from '../session';
import { useAuthStore } from '../../store/authStore';

// JWT с нужным exp. Подпись не нужна: обёртка только читает exp.
function jwt(expSeconds) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', exp: expSeconds })}.sig`;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const EXPIRED = jwt(nowSec() - 60);
const LIVE = jwt(nowSec() + 600);

const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const refreshCalls = (inner) => inner.mock.calls.filter(([url]) => url === '/auth/refresh');

describe('tokenExpiresAt', () => {
  it('читает exp из JWT в миллисекундах', () => {
    expect(tokenExpiresAt(jwt(1_800_000_000))).toBe(1_800_000_000_000);
  });
  it('мусор — null, а не исключение', () => {
    expect(tokenExpiresAt('не-токен')).toBeNull();
    expect(tokenExpiresAt(undefined)).toBeNull();
  });
});

describe('createSessionFetch', () => {
  let expired;

  beforeEach(() => {
    useAuthStore.setState({ token: EXPIRED, refreshToken: 'refresh-1', role: 'customer', isAuth: true, user: null });
    expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  afterEach(() => {
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it('истёкший токен: продлевает сессию и повторяет запрос с новым токеном', async () => {
    const inner = vi.fn(async (url, init) => {
      if (url === '/auth/refresh') {
        expect(JSON.parse(init.body)).toEqual({ refresh_token: 'refresh-1' });
        return reply(200, { access_token: 'NEW', token_type: 'bearer' });
      }
      const sent = new Headers(init?.headers).get('Authorization');
      return sent === 'Bearer NEW' ? reply(200, { ok: true }) : reply(401);
    });

    const res = await createSessionFetch(inner)('/users/me', auth(EXPIRED));

    expect(res.status).toBe(200);
    expect(useAuthStore.getState().token).toBe('NEW');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-1');
    expect(refreshCalls(inner)).toHaveLength(1);
    expect(expired).not.toHaveBeenCalled();
  });

  it('параллельные запросы делят одно продление', async () => {
    const inner = vi.fn(async (url, init) => {
      if (url === '/auth/refresh') return reply(200, { access_token: 'NEW' });
      return new Headers(init?.headers).get('Authorization') === 'Bearer NEW' ? reply(200) : reply(401);
    });
    const sessionFetch = createSessionFetch(inner);

    const results = await Promise.all([
      sessionFetch('/users/me', auth(EXPIRED)),
      sessionFetch('/tasks/', auth(EXPIRED)),
      sessionFetch('/notifications/', auth(EXPIRED)),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshCalls(inner)).toHaveLength(1);
  });

  it('refresh отозван: сессия закрывается, приложение получает событие', async () => {
    const inner = vi.fn(async (url) => (url === '/auth/refresh' ? reply(401) : reply(401)));

    const res = await createSessionFetch(inner)('/users/me', auth(EXPIRED));

    expect(res.status).toBe(401);
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuth).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('сбой сети при продлении: сессию не трогаем, отдаём исходный 401', async () => {
    const inner = vi.fn(async (url) => {
      if (url === '/auth/refresh') throw new TypeError('Failed to fetch');
      return reply(401);
    });

    const res = await createSessionFetch(inner)('/users/me', auth(EXPIRED));

    expect(res.status).toBe(401);
    expect(useAuthStore.getState().token).toBe(EXPIRED);
    expect(useAuthStore.getState().isAuth).toBe(true);
    expect(expired).not.toHaveBeenCalled();
  });

  it('живой токен и изменяющий запрос: 401 — ответ по существу, повтора нет', async () => {
    useAuthStore.setState({ token: LIVE });
    const inner = vi.fn(async () => reply(401));

    const res = await createSessionFetch(inner)('/tasks/5/accept', { method: 'POST', ...auth(LIVE) });

    expect(res.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('вход, регистрация и сами /auth/* не продлеваются', async () => {
    const inner = vi.fn(async () => reply(401));
    const sessionFetch = createSessionFetch(inner);

    await sessionFetch('/login', { method: 'POST', ...auth(EXPIRED) });
    await sessionFetch('/auth/refresh', { method: 'POST', ...auth(EXPIRED) });

    expect(inner).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().token).toBe(EXPIRED);
  });

  it('запрос без Bearer-токена и чужой домен не трогаем', async () => {
    const inner = vi.fn(async () => reply(401));
    const sessionFetch = createSessionFetch(inner);

    await sessionFetch('/tasks/');
    await sessionFetch('https://api-maps.yandex.ru/2.1/', auth(EXPIRED));

    expect(inner).toHaveBeenCalledTimes(2);
    expect(refreshCalls(inner)).toHaveLength(0);
  });

  it('без refresh-токена (вход до обновления) сессия закрывается сразу', async () => {
    useAuthStore.setState({ refreshToken: null });
    const inner = vi.fn(async () => reply(401));

    await createSessionFetch(inner)('/users/me', auth(EXPIRED));

    expect(refreshCalls(inner)).toHaveLength(0);
    expect(useAuthStore.getState().isAuth).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
