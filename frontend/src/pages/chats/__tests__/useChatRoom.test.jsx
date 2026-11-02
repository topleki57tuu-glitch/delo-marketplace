import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ToastProvider } from '../../../components/Toast';
import useChatRoom from '../useChatRoom.js';

vi.mock('../chatUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  playNotificationSound: vi.fn(),
}));

/**
 * Открытая переписка сделки. Проверяется то, что ломалось в живой проверке:
 * - ответ, пришедший по WebSocket, оставался «непрочитанным» (сервер отмечает
 *   прочитанным только историю при открытии чата);
 * - после обрыва связи чат навсегда застревал в «подключение...»;
 * - без связи отправленное сообщение не появлялось в переписке, а при
 *   ошибке отправки набранный текст пропадал.
 */

class FakeWS {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWS.instances.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  drop(code) { this.readyState = 3; this.onclose?.({ code }); }
}

const ME = { id: 1, name: 'Ольга' };
let postResponse;

function setup() {
  return renderHook(() => useChatRoom({ activeTaskId: 14, token: 't', user: ME }), {
    wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
  });
}

const calls = (url, method = 'GET') =>
  global.fetch.mock.calls.filter(([u, o]) => u === url && ((o && o.method) || 'GET') === method);

beforeEach(() => {
  FakeWS.instances = [];
  vi.stubGlobal('WebSocket', FakeWS);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  postResponse = { ok: true, status: 200, body: { id: 7, task_id: 14, sender_id: 1, text: 'Привет' } };
  global.fetch = vi.fn(async (url, options = {}) => {
    if (options.method === 'POST') {
      return { ok: postResponse.ok, status: postResponse.status, json: async () => postResponse.body };
    }
    if (options.method === 'PUT') return { ok: true, status: 200, json: async () => ({ updated_count: 1 }) };
    return { ok: true, status: 200, json: async () => [] };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChatRoom', () => {
  it('входящее сообщение по WebSocket отмечается прочитанным', async () => {
    const { result } = setup();
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(1));
    act(() => FakeWS.instances[0].open());
    act(() => FakeWS.instances[0].receive({ id: 5, task_id: 14, sender_id: 2, text: 'Буду в 10:00' }));

    expect(result.current.messages.map((m) => m.id)).toEqual([5]);
    await waitFor(() => expect(calls('/tasks/14/messages/read', 'PUT')).toHaveLength(1));
  });

  it('своё сообщение не ждёт WebSocket и не дублируется рассылкой', async () => {
    const { result } = setup();
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(1));
    act(() => result.current.handleInputChange({ target: { value: 'Привет' } }));
    await act(() => result.current.handleSendMessage({ preventDefault() {} }));

    expect(result.current.messages.map((m) => m.id)).toEqual([7]);
    act(() => FakeWS.instances[0].open());
    act(() => FakeWS.instances[0].receive({ id: 7, task_id: 14, sender_id: 1, text: 'Привет' }));
    expect(result.current.messages).toHaveLength(1);
    // Своё сообщение прочитанным не отмечаем — это делает собеседник.
    expect(calls('/tasks/14/messages/read', 'PUT')).toHaveLength(0);
  });

  it('при ошибке отправки текст возвращается в поле', async () => {
    postResponse = { ok: false, status: 422, body: { detail: [{ msg: 'слишком длинное' }] } };
    const { result } = setup();
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(1));
    act(() => result.current.handleInputChange({ target: { value: 'Важное сообщение' } }));
    await act(() => result.current.handleSendMessage({ preventDefault() {} }));

    expect(result.current.messageText).toBe('Важное сообщение');
    expect(result.current.messages).toHaveLength(0);
  });

  it('после обрыва связи переподключается и дочитывает историю', async () => {
    const { result } = setup();
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(1));
    act(() => FakeWS.instances[0].open());
    expect(result.current.wsConnected).toBe(true);

    act(() => FakeWS.instances[0].drop(1006));
    expect(result.current.wsConnected).toBe(false);
    await waitFor(() => expect(FakeWS.instances).toHaveLength(2), { timeout: 2500 });
    act(() => FakeWS.instances[1].open());
    expect(result.current.wsConnected).toBe(true);
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(2));
  });

  it('если сервер отказал в доступе (1008), не долбит его повторами', async () => {
    setup();
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(1));
    act(() => FakeWS.instances[0].drop(1008));
    await new Promise((r) => setTimeout(r, 1300));
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('после закрытия чата не переподключается', async () => {
    const { unmount } = setup();
    await waitFor(() => expect(calls('/tasks/14/messages')).toHaveLength(1));
    const ws = FakeWS.instances[0];
    unmount();
    act(() => ws.drop(1000));
    await new Promise((r) => setTimeout(r, 1300));
    expect(FakeWS.instances).toHaveLength(1);
  });
});
