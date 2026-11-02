import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../../components/Toast';
import ResponsesList from '../ResponsesList.jsx';

/**
 * Выбор исполнителя — момент, когда с баланса заказчика замораживаются
 * деньги. Раньше подтверждение говорило «бюджет заморозится», не называя
 * суммы; при нехватке денег пользователь узнавал об этом только из ошибки
 * после подтверждения, и путь к пополнению приходилось искать самому.
 * У задания без бюджета окно обещало безопасную сделку, которой нет.
 */

const RESPONSE = {
  id: 3,
  specialist_id: 42,
  specialist_name: 'Пётр',
  proposed_price: 2300,
  estimated_days: 1,
  text: 'Соберу за день',
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderList({ budget = 2500, balance = 5000 } = {}) {
  const onChanged = vi.fn();
  render(
    <MemoryRouter initialEntries={['/tasks/14']}>
      <ToastProvider>
        <Routes>
          <Route
            path="/tasks/14"
            element={(
              <ResponsesList
                task={{ id: 14, status: 'open', budget, executor_id: null }}
                taskId="14"
                token="t"
                responses={[RESPONSE]}
                responsesCount={1}
                isAuthor
                balance={balance}
                onChanged={onChanged}
              />
            )}
          />
          <Route path="/profile" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
  return { onChanged };
}

// Баланс, который вернёт сервер на /users/me (он может отличаться от
// показанного на странице — например, после пополнения в другой вкладке).
let serverBalance;

beforeEach(() => {
  serverBalance = 5000;
  global.fetch = vi.fn(async (url) => {
    if (url === '/users/me') {
      return { ok: true, status: 200, json: async () => ({ id: 1, balance: serverBalance }) };
    }
    return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
  });
});

const assignCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).includes('/assign'));

describe('ResponsesList: выбор исполнителя', () => {
  it('называет замораживаемую сумму и отличие от цены отклика', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onChanged } = renderList();

    await user.click(screen.getByRole('button', { name: 'Выбрать исполнителем' }));

    const text = confirmSpy.mock.calls[0][0].replace(/\u00a0|\u202f/g, ' ');
    expect(text).toContain('заморозится 2 500 ₽');
    expect(text).toContain('предложил 2 300 ₽');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/tasks/14/assign?specialist_id=42', expect.objectContaining({ method: 'PUT' }));
  });

  it('при нехватке денег не назначает, а ведёт в кошелёк с нужной суммой', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    serverBalance = 1000;
    renderList({ balance: 1000 });

    await user.click(screen.getByRole('button', { name: 'Выбрать исполнителем' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    const text = confirmSpy.mock.calls[0][0].replace(/\u00a0|\u202f/g, ' ');
    expect(text).toContain('не хватает 1 500 ₽');
    // Перед отказом баланс перепроверен на сервере, назначения не было.
    expect(global.fetch).toHaveBeenCalledWith('/users/me', expect.anything());
    expect(assignCalls()).toHaveLength(0);
    const where = await screen.findByTestId('where');
    const url = new URL(where.textContent, 'http://x');
    expect(url.pathname).toBe('/profile');
    expect(url.searchParams.get('tab')).toBe('wallet');
    expect(url.searchParams.get('topup')).toBe('1500');
    expect(url.searchParams.get('return')).toBe('/tasks/14');
  });

  it('устаревший баланс на странице не мешает назначить: верит серверу', async () => {
    // На странице ещё 1000 ₽, но пользователь уже пополнил счёт до 5000 ₽.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onChanged } = renderList({ balance: 1000 });

    await user.click(screen.getByRole('button', { name: 'Выбрать исполнителем' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const text = confirmSpy.mock.calls[0][0].replace(/\u00a0|\u202f/g, ' ');
    expect(text).toContain('заморозится 2 500 ₽');
    expect(text).not.toContain('не хватает');
    expect(assignCalls()).toHaveLength(1);
  });

  it('у задания без бюджета не обещает безопасную сделку', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderList({ budget: null, balance: 0 });

    await user.click(screen.getByRole('button', { name: 'Выбрать исполнителем' }));

    const text = confirmSpy.mock.calls[0][0];
    expect(text).toContain('не замораживаются');
    expect(text).not.toContain('заморозится');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
