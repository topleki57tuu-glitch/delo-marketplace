import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationBell, notificationTarget } from '../NotificationBell';

/**
 * Уведомление — повод перейти к делу. Раньше щелчок по нему только гасил
 * точку «не прочитано», а сам элемент был `div` — с клавиатуры недоступен.
 */

const NOTIFS = [
  { id: 1, type: 'assigned', title: 'Вас выбрали исполнителем!', text: 'Шкаф-купе', task_id: 14, is_read: false, created_at: '2026-11-02T10:00:00' },
  { id: 2, type: 'new_order', title: 'Новый заказ', text: 'Фурнитура', task_id: null, is_read: true, created_at: '2026-11-02T10:05:00' },
];

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ notifications: NOTIFS, unread_count: 1 }) }));
});

describe('notificationTarget', () => {
  it.each([
    [{ type: 'message', task_id: 14 }, '/chats?taskId=14'],
    [{ type: 'assigned', task_id: 14 }, '/tasks/14'],
    [{ type: 'new_order', task_id: null }, '/my-orders?tab=sales'],
    [{ type: 'order_shipped', task_id: null }, '/my-orders?tab=purchases'],
    [{ type: 'withdrawal', task_id: null }, '/profile?tab=wallet'],
    [{ type: 'unknown', task_id: null }, null],
  ])('%j → %s', (n, to) => {
    expect(notificationTarget(n)).toBe(to);
  });
});

describe('NotificationBell', () => {
  it('щелчок по уведомлению отмечает его прочитанным и открывает задание', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationBell token="t" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: /Уведомления/ }));
    const item = await screen.findByRole('button', { name: /Вас выбрали исполнителем/ });
    await user.click(item);

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/tasks/14'));
    expect(global.fetch).toHaveBeenCalledWith('/notifications/1/read', expect.objectContaining({ method: 'PUT' }));
    expect(screen.queryByRole('button', { name: /Новый заказ/ })).not.toBeInTheDocument();
  });
});
