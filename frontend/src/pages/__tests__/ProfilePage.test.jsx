import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProfilePage from '../ProfilePage';
import { ToastProvider } from '../../components/Toast';
import { DialogProvider } from '../../components/DialogProvider';

/**
 * Кабинет: профиль, кошелёк, PRO, настройки и модерация — вкладки в шапке.
 *
 * Проверяется то, что ломалось или легко ломается незаметно:
 * - вкладка берётся из адреса (?tab=wallet), чужие вкладки не открываются;
 * - отклонение выплаты отправляет причину (раньше её спрашивали и теряли);
 * - навыки специалиста сохраняются JSON-массивом, как их читает каталог.
 */

const SPECIALIST = {
  id: 5,
  name: 'Игорь Волков',
  email: 'igor@delo.ru',
  role: 'specialist',
  balance: 14410,
  is_pro: false,
  response_credits: 3,
  rating: 4.9,
  completed_tasks: 2,
  skills: '["Python"]',
  verified: false,
};

const ADMIN = { ...SPECIALIST, id: 1, name: 'Арбитр', email: 'admin@delo.ru', role: 'customer', is_admin: true, balance: 0 };

const WITHDRAWAL = {
  id: 9,
  amount: 10000,
  status: 'pending',
  method: 'card',
  requisites: '4276 3800 1234 5678',
  user_name: 'Игорь Волков',
  user_email: 'igor@delo.ru',
  user_balance: 14410,
  created_at: '2026-10-31T12:40:00',
};

function mockApi(routes = {}) {
  global.fetch = vi.fn(async (url) => {
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(`${k}?`));
    const body = key ? routes[key] : {};
    return { ok: true, status: 200, json: async () => body, blob: async () => new Blob() };
  });
}

function renderPage({ user = SPECIALIST, url = '/profile', onUpdateUser = vi.fn() } = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <DialogProvider>
          <ProfilePage user={user} token={user ? 'test-token' : null} onUpdateUser={onUpdateUser} onLogout={vi.fn()} onOpenAuth={vi.fn()} />
        </DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

const calls = (path) => global.fetch.mock.calls.filter(([u]) => u === path);

beforeEach(() => {
  mockApi({
    '/verification/status': { request: null },
    '/wallet/transactions': [{ id: 1, type: 'deposit', amount: 100000, created_at: '2026-10-10T12:00:00' }],
    '/wallet/withdrawals': [],
    '/admin/withdrawals': [WITHDRAWAL],
    '/verification/admin/list': [],
  });
});

describe('ProfilePage', () => {
  it('без входа предлагает войти и ничего не запрашивает', () => {
    renderPage({ user: null });

    expect(screen.getByText('Войдите в профиль')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('вкладка из адреса открывается сразу и грузит свои данные', async () => {
    renderPage({ url: '/profile?tab=wallet' });

    expect(screen.getByRole('tab', { name: /Кошелёк/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Пополнение')).toBeInTheDocument();
    expect(calls('/wallet/transactions')).toHaveLength(1);
    expect(calls('/wallet/withdrawals')).toHaveLength(1);
  });

  it('вкладку модерации видит только модератор', () => {
    renderPage({ url: '/profile?tab=admin' });

    expect(screen.queryByRole('tab', { name: /Модерация/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Профиль/ })).toHaveAttribute('aria-selected', 'true');
    expect(calls('/admin/withdrawals')).toHaveLength(0);
  });

  it('у специалиста есть вкладка PRO, у заказчика — нет', () => {
    const { unmount } = renderPage();
    expect(screen.getByRole('tab', { name: /Отклики и PRO/ })).toBeInTheDocument();
    unmount();

    renderPage({ user: { ...SPECIALIST, role: 'customer' } });
    expect(screen.queryByRole('tab', { name: /Отклики и PRO/ })).not.toBeInTheDocument();
  });

  it('отклонение выплаты отправляет причину, которую ввёл модератор', async () => {
    const user = userEvent.setup();
    renderPage({ user: ADMIN, url: '/profile?tab=admin' });

    const row = (await screen.findByText('4276 3800 1234 5678')).closest('li');
    await user.click(within(row).getByRole('button', { name: /Отклонить/ }));

    const dialog = screen.getByRole('alertdialog');
    const reason = within(dialog).getByRole('textbox');
    await user.clear(reason);
    await user.type(reason, 'Карта не принадлежит получателю');
    await user.click(within(dialog).getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(calls('/admin/withdrawals/9/review')).toHaveLength(1));
    const [, options] = calls('/admin/withdrawals/9/review')[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ action: 'reject', comment: 'Карта не принадлежит получателю' });
  });

  it('навыки специалиста сохраняются JSON-массивом', async () => {
    const user = userEvent.setup();
    const onUpdateUser = vi.fn();
    renderPage({ onUpdateUser });

    await user.click(screen.getByRole('button', { name: /Редактировать/ }));
    const skills = screen.getByLabelText('Навыки');
    expect(skills).toHaveValue('Python');
    await user.clear(skills);
    await user.type(skills, 'React, Node.js , ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(calls('/users/me')).toHaveLength(1));
    const [, options] = calls('/users/me')[0];
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toMatchObject({ name: 'Игорь Волков', skills: '["React","Node.js"]' });
    await waitFor(() => expect(onUpdateUser).toHaveBeenCalled());
  });
});
