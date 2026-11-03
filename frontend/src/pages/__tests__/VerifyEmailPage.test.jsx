import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VerifyEmailPage from '../VerifyEmailPage';
import { useAuthStore } from '../../store/authStore';
import { PROFILE_STALE_EVENT } from '../../utils/profileSync';

/**
 * Страница из письма: /verify-email?token=… подтверждает почту сразу при
 * открытии. Вход не нужен — ссылку часто открывают на телефоне.
 */

const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });

function renderPage(url = '/verify-email?token=abc') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <VerifyEmailPage />
    </MemoryRouter>,
  );
}

let stale;
beforeEach(() => {
  useAuthStore.setState({ token: null, user: null, role: null, isAuth: false, refreshToken: null });
  stale = vi.fn();
  window.addEventListener(PROFILE_STALE_EVENT, stale);
});
afterEach(() => window.removeEventListener(PROFILE_STALE_EVENT, stale));

describe('VerifyEmailPage', () => {
  it('отправляет токен из ссылки и показывает успех', async () => {
    global.fetch = vi.fn(() => json({ message: 'Почта подтверждена', email: 'anna@mail.ru', already_verified: false }));
    renderPage();
    expect(await screen.findByText(/Почта подтверждена: anna@mail.ru/)).toBeInTheDocument();
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/auth/verify-email');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'abc' });
    expect(screen.getByRole('link', { name: 'На главную' })).toBeInTheDocument();
    // Вошедшему профиль перечитывается — полоска «Подтвердите почту» уйдёт.
    await waitFor(() => expect(stale).toHaveBeenCalled());
  });

  it('повторное открытие ссылки — «уже подтверждена», а не ошибка', async () => {
    global.fetch = vi.fn(() => json({ email: 'anna@mail.ru', already_verified: true }));
    renderPage();
    expect(await screen.findByText(/Почта уже подтверждена/)).toBeInTheDocument();
  });

  it('показывает причину отказа сервера', async () => {
    global.fetch = vi.fn(() => json({ detail: 'Ссылка устарела. Войдите на сайт и нажмите «Отправить письмо ещё раз».' }, 400));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка устарела');
    // Без входа кнопку повторной отправки не показываем — объясняем, где она.
    expect(screen.queryByRole('button', { name: 'Отправить письмо ещё раз' })).not.toBeInTheDocument();
    expect(screen.getByText(/Чтобы получить новое письмо, войдите на сайт/)).toBeInTheDocument();
  });

  it('вошедшему при ошибке предлагает отправить письмо ещё раз', async () => {
    useAuthStore.setState({ token: 't', user: { id: 1, email: 'anna@mail.ru' }, isAuth: true });
    global.fetch = vi.fn(() => json({ detail: 'Ссылка недействительна.' }, 400));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Отправить письмо ещё раз' })).toBeInTheDocument();
  });

  it('без токена в ссылке ничего не отправляет', () => {
    global.fetch = vi.fn();
    renderPage('/verify-email');
    expect(screen.getByRole('alert')).toHaveTextContent('нет кода подтверждения');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
