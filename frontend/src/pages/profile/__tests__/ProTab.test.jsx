import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../components/Toast';
import ProTab from '../ProTab.jsx';

/**
 * Покупка пакета с баланса. Баланс на странице может устареть (пополнили
 * в другой вкладке), поэтому перед отказом «не хватает денег» его
 * перепроверяют на сервере, а при нехватке предлагают пополнить ровно
 * на недостающую сумму.
 */

let serverBalance;

beforeEach(() => {
  serverBalance = 0;
  global.fetch = vi.fn(async (url) => {
    if (url === '/users/me') {
      return { ok: true, status: 200, json: async () => ({ id: 7, balance: serverBalance }) };
    }
    return { ok: true, status: 200, json: async () => ({ message: 'Пакет активирован' }) };
  });
});

function renderTab(balance) {
  const onOpenDeposit = vi.fn();
  const onUpdateUser = vi.fn();
  render(
    <ToastProvider>
      <ProTab
        user={{ id: 7, role: 'specialist', balance, is_pro: false, response_credits: 0 }}
        token="t"
        onUpdateUser={onUpdateUser}
        onOpenDeposit={onOpenDeposit}
      />
    </ToastProvider>
  );
  return { onOpenDeposit, onUpdateUser };
}

const normalize = (text) => text.replace(/\u00a0|\u202f/g, ' ');
const buyCalls = () => global.fetch.mock.calls.filter(([url]) => url === '/monetization/buy');

describe('ProTab: покупка с баланса', () => {
  it('при нехватке предлагает пополнить на недостающую сумму', async () => {
    serverBalance = 400;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onOpenDeposit } = renderTab(400);

    await user.click(screen.getByRole('button', { name: 'Подключить PRO' }));

    await waitFor(() => expect(onOpenDeposit).toHaveBeenCalledWith(190));
    expect(normalize(confirmSpy.mock.calls[0][0])).toContain('Не хватает 190 ₽');
    expect(buyCalls()).toHaveLength(0);
  });

  it('устаревший баланс: верит серверу и показывает актуальную сумму', async () => {
    serverBalance = 1000;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { onOpenDeposit, onUpdateUser } = renderTab(100);

    await user.click(screen.getByRole('button', { name: 'Подключить PRO' }));

    await waitFor(() => expect(onUpdateUser).toHaveBeenCalled());
    expect(onOpenDeposit).not.toHaveBeenCalled();
    const text = normalize(confirmSpy.mock.calls[0][0]);
    expect(text).toContain('Купить «PRO на месяц» за 590 ₽?');
    expect(text).toContain('сейчас на нём 1 000 ₽');
    expect(buyCalls()).toHaveLength(1);
  });
});
