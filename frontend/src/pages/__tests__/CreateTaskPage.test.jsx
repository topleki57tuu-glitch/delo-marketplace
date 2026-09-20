import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import CreateTaskPage from '../CreateTaskPage';

/**
 * Создание задания — начало денежного пути: без задания нет сделки, эскроу и
 * комиссии. Страница проверяется целиком, потому что здесь сходятся три вещи,
 * которые ломаются по отдельности: доступ (без входа формы быть не должно),
 * клиентская валидация (пустое задание не должно уходить в сеть) и состав
 * тела запроса (`budget` числом, `images` строкой JSON).
 *
 * Последнее — не формальность: `budget` уходит как `parseInt`, и если он
 * уедет строкой, бэкенд отклонит создание; `images` уходит JSON-строкой,
 * потому что колонка текстовая.
 */

const USER = { id: 7, email: 'customer@check.ru', name: 'Заказчик' };

function renderPage(props = {}) {
  return render(
    <MemoryRouter initialEntries={['/tasks/new']}>
      <ToastProvider>
        <CreateTaskPage user={USER} token="test-token" {...props} />
      </ToastProvider>
    </MemoryRouter>
  );
}

function fillRequired(user) {
  return (async () => {
    await user.type(
      screen.getByPlaceholderText(/Например: Разработать адаптивный лендинг/),
      'Починить кран'
    );
    await user.type(
      screen.getByPlaceholderText(/Опишите все детали, требования/),
      'Течёт смеситель на кухне'
    );
  })();
}

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('CreateTaskPage', () => {
  it('без входа показывает требование авторизации вместо формы', () => {
    renderPage({ user: null });

    expect(screen.getByText('Требуется авторизация')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Опубликовать задание/ })).not.toBeInTheDocument();
  });

  it('кнопка входа передаёт наружу причину «login»', async () => {
    const user = userEvent.setup();
    const onOpenAuth = vi.fn();
    renderPage({ user: null, onOpenAuth });

    await user.click(screen.getByRole('button', { name: /Войти в аккаунт/ }));

    expect(onOpenAuth).toHaveBeenCalledWith('login');
  });

  it('пустые обязательные поля блокируются браузером, до обработчика дело не доходит', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Опубликовать задание/ }));

    // У полей названия и описания стоит `required`, поэтому submit не
    // происходит вовсе: ни запроса, ни уведомления. Ветка
    // `if (!title.trim() || !description.trim())` в handleSubmit через
    // интерфейс на пустых полях недостижима — она срабатывает только на
    // строке из пробелов, и это проверяет следующий тест.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Заполните название и описание задания')).not.toBeInTheDocument();
  });

  it('задание из одних пробелов отклоняется, запрос не уходит', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/Например: Разработать адаптивный лендинг/), '   ');
    await user.type(screen.getByPlaceholderText(/Опишите все детали, требования/), '   ');
    await user.click(screen.getByRole('button', { name: /Опубликовать задание/ }));

    expect(await screen.findByText('Заполните название и описание задания')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('заполненная форма отправляет задание с бюджетом числом', async () => {
    const user = userEvent.setup();
    const onTaskCreated = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 42 }),
    });

    renderPage({ onTaskCreated });
    await fillRequired(user);
    await user.type(screen.getByPlaceholderText(/Оставьте пустым для договорной цены/), '7500');
    await user.click(screen.getByRole('button', { name: /Опубликовать задание/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/tasks/');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');

    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({
      title: 'Починить кран',
      description: 'Течёт смеситель на кухне',
      category: 'development',
      budget: 7500,
      is_remote: false,
    });
    // Именно число: строку бэкенд не примет как бюджет.
    expect(typeof payload.budget).toBe('number');
    expect(onTaskCreated).toHaveBeenCalled();
  });

  it('без бюджета отправляется null, а не пустая строка', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 43 }),
    });

    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /Опубликовать задание/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.budget).toBeNull();
    // Договорная цена: пустое поле не должно превратиться в 0.
    expect(payload.images).toBeNull();
  });

  it('ошибка бэкенда показывается текстом бэкенда, задание не считается созданным', async () => {
    const user = userEvent.setup();
    const onTaskCreated = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'Недостаточно прав для создания задания' }),
    });

    renderPage({ onTaskCreated });
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /Опубликовать задание/ }));

    expect(await screen.findByText('Недостаточно прав для создания задания')).toBeInTheDocument();
    expect(onTaskCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Опубликовать задание/ })).toBeEnabled();
  });

  it('категория по умолчанию — «Разработка сайтов и IT»', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 44 }),
    });

    renderPage();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /Опубликовать задание/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).category).toBe('development');
  });
});
