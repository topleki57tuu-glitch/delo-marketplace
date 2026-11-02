import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import MyTasksPage from '../MyTasksPage';

/**
 * «Мои заказы» по умолчанию показывает активные. У заказчика, чья
 * единственная сделка уже завершена, страница писала «0 заказов» и «Вы ещё
 * не публиковали заказы» — хотя заказ был, просто на другой вкладке.
 */

const COMPLETED = { id: 14, title: 'Собрать шкаф-купе', status: 'completed', budget: 2500, responses_count: 1, created_at: '2026-11-02T10:00:00' };

function mockTasks() {
  global.fetch = vi.fn(async (url) => {
    const params = new URL(url, 'http://x').searchParams;
    const body = params.get('status_filter') === 'active' ? [] : [COMPLETED];
    return { ok: true, status: 200, json: async () => body };
  });
}

function renderPage(url = '/my-tasks') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MyTasksPage onOpenAuth={vi.fn()} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.setState({ token: 't', isAuth: true, user: { id: 10, role: 'customer' } });
  mockTasks();
});

describe('MyTasksPage', () => {
  it('пустая вкладка «Активные» не утверждает, что заказов нет вовсе', async () => {
    renderPage();
    expect(await screen.findByText('Активных заказов нет')).toBeInTheDocument();
    expect(screen.queryByText('Вы ещё не публиковали заказы')).not.toBeInTheDocument();
    expect(screen.getByText(/0 активных заказов/)).toBeInTheDocument();
  });

  it('«Показать все» открывает все заказы, включая завершённые', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Показать все' }));
    expect(await screen.findByText('Собрать шкаф-купе')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/^1 заказ/)).toBeInTheDocument());
  });
});
