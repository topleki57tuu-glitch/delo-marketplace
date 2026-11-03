import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../components/Toast';
import TelegramPanel from '../TelegramPanel.jsx';
import TelegramRadarLink, { resetTelegramRadarCache } from '../../../components/TelegramRadarLink.jsx';

/**
 * Привязка Telegram: сайт выдаёт одноразовую ссылку на бота и ждёт, пока
 * в Telegram нажмут «Старт». Пока бот на сервере не настроен, панели и
 * кнопки радара нет — они бы никуда не вели.
 */

const LINK_URL = 'https://t.me/delo_test_bot?start=link_abc';
let status;

function mockApi() {
  global.fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url === '/telegram/status') return { ok: true, status: 200, json: async () => ({ ...status }) };
    if (url === '/telegram/link' && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ url: LINK_URL, expires_in: 900 }) };
    }
    if (url === '/telegram/link' && method === 'DELETE') {
      status = { ...status, linked: false, notify_enabled: false };
      return { ok: true, status: 200, json: async () => ({ unlinked: true }) };
    }
    if (url === '/telegram/info') {
      return { ok: true, status: 200, json: async () => ({ enabled: status.enabled, url: status.enabled ? 'https://t.me/delo_test_bot?start=radar' : null }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

const renderPanel = () => render(<ToastProvider><TelegramPanel token="t" /></ToastProvider>);
const calls = (url, method = 'GET') =>
  global.fetch.mock.calls.filter(([u, o = {}]) => u === url && (o.method || 'GET') === method);

beforeEach(() => {
  status = { enabled: true, username: 'delo_test_bot', linked: false, notify_enabled: false, radar_enabled: false };
  mockApi();
  window.open = vi.fn();
  resetTelegramRadarCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TelegramPanel', () => {
  it('без настроенного бота панели нет', async () => {
    status = { enabled: false, linked: false };
    renderPanel();

    await waitFor(() => expect(calls('/telegram/status')).toHaveLength(1));
    expect(screen.queryByText('Подключить Telegram')).not.toBeInTheDocument();
  });

  it('выдаёт ссылку, ждёт «Старт» и показывает привязку', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /Подключить Telegram/ }));

    const [, options] = calls('/telegram/link', 'POST')[0];
    expect(options.headers.Authorization).toBe('Bearer t');
    expect(window.open).toHaveBeenCalledWith(LINK_URL, '_blank', 'noopener,noreferrer');
    // Окно могли заблокировать — ссылка остаётся на странице.
    expect(await screen.findByRole('link', { name: /Открыть Telegram/ })).toHaveAttribute('href', LINK_URL);

    status = { ...status, linked: true, notify_enabled: true };
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });

    expect(await screen.findByText(/Подключён к @delo_test_bot/)).toBeInTheDocument();
    expect(screen.getByText(/уведомления придут туда/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Открыть Telegram/ })).not.toBeInTheDocument();
  });

  it('отключение спрашивает подтверждение и снимает привязку', async () => {
    status = { ...status, linked: true, notify_enabled: true };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Отключить' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(calls('/telegram/link', 'DELETE')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: /Подключить Telegram/ })).toBeInTheDocument();
  });

  it('напоминает, что уведомления выключены в самом боте', async () => {
    status = { ...status, linked: true, notify_enabled: false };
    renderPanel();

    expect(await screen.findByText(/Уведомления выключены в боте/)).toBeInTheDocument();
  });
});

describe('TelegramRadarLink', () => {
  it('ведёт в бота, когда он настроен', async () => {
    render(<TelegramRadarLink />);

    expect(await screen.findByRole('link', { name: /Заказы в Telegram/ })).toHaveAttribute(
      'href',
      'https://t.me/delo_test_bot?start=radar',
    );
  });

  it('без бота кнопки нет', async () => {
    status = { ...status, enabled: false };
    render(<TelegramRadarLink />);

    await waitFor(() => expect(calls('/telegram/info')).toHaveLength(1));
    expect(screen.queryByRole('link', { name: /Заказы в Telegram/ })).not.toBeInTheDocument();
  });
});
