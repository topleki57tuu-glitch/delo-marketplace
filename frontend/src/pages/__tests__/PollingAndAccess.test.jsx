import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { DialogProvider } from '../../components/DialogProvider';
import DisputesPage from '../DisputesPage';
import TaskDetailPage from '../TaskDetailPage';
import ChatsPage from '../ChatsPage';

/**
 * Лишние запросы, найденные при проверке сайта «как пользователь».
 *
 * 1. /disputes у обычного пользователя запрашивал /admin/disputes и получал
 *    403 — права видны по профилю (is_admin), спрашивать сервер незачем.
 * 2. Страница задания запрашивала спор у любого вошедшего — посторонний
 *    исполнитель получал 403 на каждое открытие задания.
 * 3. App перечитывает профиль каждые 5 секунд и каждый раз кладёт в store
 *    новый объект user. Эффекты с зависимостью от user перезапускались:
 *    /chats (обещано «раз в 30 секунд») и страница задания грузились заново
 *    при каждом опросе.
 */

const CUSTOMER = { id: 1, name: 'Анна', role: 'customer', is_admin: false };
const STRANGER = { id: 3, name: 'Игорь', role: 'specialist', is_admin: false };
const ADMIN = { id: 9, name: 'Арбитр', role: 'customer', is_admin: true };

const TASK = {
  id: 13, title: 'Починить кран', description: 'Течёт', status: 'in_progress', budget: 3000,
  category: 'repairs', customer_id: 1, executor_id: 2, responses_count: 1, is_remote: true,
  created_at: '2026-10-01T10:00:00',
};

const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
const calls = (part) => global.fetch.mock.calls.filter(([url]) => String(url).includes(part)).length;

function withProviders(ui, path = '/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <DialogProvider>{ui}</DialogProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.startsWith('/admin/disputes')) return json({ disputes: [] });
    if (u === '/tasks/13') return json(TASK);
    if (u.endsWith('/responses')) return json([]);
    if (u.endsWith('/dispute')) return json({ dispute: null });
    if (u === '/chats') return json([]);
    return json({});
  });
});

describe('DisputesPage', () => {
  it('без прав арбитра сразу показывает «Нет доступа» и не запрашивает очередь', async () => {
    render(withProviders(<DisputesPage user={CUSTOMER} token="t" />));
    expect(await screen.findByText('Нет доступа')).toBeInTheDocument();
    expect(calls('/admin/disputes')).toBe(0);
  });

  it('арбитру загружает очередь споров', async () => {
    render(withProviders(<DisputesPage user={ADMIN} token="t" />));
    expect(await screen.findByText('Открытых споров нет')).toBeInTheDocument();
    expect(calls('/admin/disputes')).toBe(1);
  });
});

describe('TaskDetailPage', () => {
  const page = (user) => withProviders(
    <Routes><Route path="/tasks/:taskId" element={<TaskDetailPage user={user} token="t" />} /></Routes>,
    '/tasks/13'
  );

  it('постороннему исполнителю не запрашивает спор (раньше — 403)', async () => {
    render(page(STRANGER));
    await waitFor(() => expect(calls('/tasks/13/responses')).toBe(1));
    expect(calls('/tasks/13/dispute')).toBe(0);
  });

  it('участнику сделки и арбитру спор запрашивается', async () => {
    const { unmount } = render(page(CUSTOMER));
    await waitFor(() => expect(calls('/tasks/13/dispute')).toBe(1));
    unmount();
    render(page(ADMIN));
    await waitFor(() => expect(calls('/tasks/13/dispute')).toBe(2));
  });

  it('новый объект профиля с тем же id не перезагружает задание', async () => {
    const { rerender } = render(page(CUSTOMER));
    await waitFor(() => expect(calls('/tasks/13/responses')).toBe(1));
    rerender(page({ ...CUSTOMER, balance: 500 }));
    rerender(page({ ...CUSTOMER, balance: 700 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls('/tasks/13/responses')).toBe(1);
  });
});

describe('ChatsPage', () => {
  it('опрос профиля (новый объект user) не перезапрашивает список чатов', async () => {
    const page = (user) => withProviders(<ChatsPage user={user} token="t" />, '/chats');
    const { rerender } = render(page(CUSTOMER));
    await waitFor(() => expect(calls('/chats')).toBe(1));
    rerender(page({ ...CUSTOMER, balance: 500 }));
    rerender(page({ ...CUSTOMER, balance: 700 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls('/chats')).toBe(1);
  });
});
