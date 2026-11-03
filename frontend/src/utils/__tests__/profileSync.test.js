import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProfileSyncFetch, requestProfileRefresh, PROFILE_STALE_EVENT } from '../profileSync';

/**
 * Профиль теперь опрашивается раз в 30 секунд (было — каждые 5). Чтобы
 * баланс в шапке не отставал после оплаты или покупки, успешное изменяющее
 * действие сразу просит приложение перечитать профиль.
 */

const reply = (status) => ({ status, ok: status >= 200 && status < 300, json: async () => ({}) });
const auth = (method) => ({ method, headers: { Authorization: 'Bearer t' } });

let stale;
beforeEach(() => {
  vi.useFakeTimers();
  stale = vi.fn();
  window.addEventListener(PROFILE_STALE_EVENT, stale);
});
afterEach(() => {
  window.removeEventListener(PROFILE_STALE_EVENT, stale);
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('createProfileSyncFetch', () => {
  it('после успешной оплаты задания просит перечитать профиль', async () => {
    const f = createProfileSyncFetch(vi.fn(async () => reply(200)));
    await f('/tasks/5/assign/7', auth('POST'));
    expect(stale).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it('несколько действий подряд — один запрос профиля', async () => {
    const f = createProfileSyncFetch(vi.fn(async () => reply(200)));
    await f('/wallet/withdraw', auth('POST'));
    await f('/products/3/buy', auth('POST'));
    await f('/tasks/5', auth('DELETE'));
    vi.advanceTimersByTime(1000);
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it('чтение, ошибки, чат, уведомления и вход профиль не трогают', async () => {
    const ok = createProfileSyncFetch(vi.fn(async () => reply(200)));
    const failed = createProfileSyncFetch(vi.fn(async () => reply(400)));
    await ok('/tasks/5', { headers: { Authorization: 'Bearer t' } });
    await failed('/wallet/withdraw', auth('POST'));
    await ok('/tasks/5/messages', auth('POST'));
    await ok('/notifications/read-all', auth('POST'));
    await ok('/upload/image', auth('POST'));
    await ok('/auth/resend-verification', auth('POST'));
    await ok('/login', { method: 'POST' });
    await ok('/tasks/5/assign/7', { method: 'POST' }); // без токена
    vi.advanceTimersByTime(1000);
    expect(stale).not.toHaveBeenCalled();
  });

  it('отдаёт исходный ответ без изменений', async () => {
    const res = reply(201);
    const f = createProfileSyncFetch(vi.fn(async () => res));
    expect(await f('/tasks/', auth('POST'))).toBe(res);
  });
});

describe('requestProfileRefresh', () => {
  it('можно вызвать вручную — например, после подтверждения почты', () => {
    requestProfileRefresh();
    requestProfileRefresh();
    vi.advanceTimersByTime(300);
    expect(stale).toHaveBeenCalledTimes(1);
  });
});
