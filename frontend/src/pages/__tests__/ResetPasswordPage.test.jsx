import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import ResetPasswordPage from '../ResetPasswordPage';

/**
 * Страница нового пароля — хвост флоу восстановления доступа.
 *
 * Почему она, а не что-то другое. Это последний шаг сброса пароля: если он
 * сломан, человек с недействительной ссылкой или несовпадающими паролями
 * видит только «не удалось» и восстановить доступ не может ничем. При этом
 * до появления этого файла во фронтенде было три теста — два на сторы и один
 * на ErrorBoundary, — то есть ни одна из 18 страниц не проверялась вообще.
 *
 * Что здесь проверяется: клиентские проверки до запроса (короткий пароль,
 * несовпадение), состав тела запроса, показ ошибки бэкенда и переход в
 * состояние «готово» только при успехе.
 */

const TOKEN = 'test-token-abc';

function renderPage(url = `/reset?token=${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <ResetPasswordPage />
      </ToastProvider>
    </MemoryRouter>
  );
}

function passwordInputs(container) {
  return container.querySelectorAll('input[type="password"]');
}

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('ResetPasswordPage', () => {
  it('без токена в ссылке форму не показывает, а объясняет причину', () => {
    renderPage('/reset');

    expect(screen.getByText(/Ссылка недействительна/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Сохранить новый пароль/ })).not.toBeInTheDocument();
  });

  it('с токеном показывает форму из двух полей', () => {
    const { container } = renderPage();

    expect(passwordInputs(container)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Сохранить новый пароль/ })).toBeInTheDocument();
  });

  it('короткий пароль отклоняется на клиенте, запрос не уходит', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    const inputs = passwordInputs(container);
    await user.type(inputs[0], 'short');
    await user.type(inputs[1], 'short');
    await user.click(screen.getByRole('button', { name: /Сохранить новый пароль/ }));

    expect(await screen.findByText('Пароль должен содержать минимум 8 символов')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('несовпадающие пароли отклоняются на клиенте, запрос не уходит', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    const inputs = passwordInputs(container);
    await user.type(inputs[0], 'longenough1');
    await user.type(inputs[1], 'longenough2');
    await user.click(screen.getByRole('button', { name: /Сохранить новый пароль/ }));

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('при успехе отправляет токен и новый пароль и показывает «готово»', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'Пароль обновлён' }),
    });

    const { container } = renderPage();
    const inputs = passwordInputs(container);
    await user.type(inputs[0], 'longenough1');
    await user.type(inputs[1], 'longenough1');
    await user.click(screen.getByRole('button', { name: /Сохранить новый пароль/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/auth/reset-password');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      token: TOKEN,
      new_password: 'longenough1',
    });

    expect(await screen.findByText(/Пароль успешно обновлён/)).toBeInTheDocument();
    // Форма уступает место подтверждению — иначе можно нажать «Сохранить» второй раз.
    expect(screen.queryByRole('button', { name: /Сохранить новый пароль/ })).not.toBeInTheDocument();
  });

  it('ошибка бэкенда показывается текстом от бэкенда, форма остаётся', async () => {
    const user = userEvent.setup();
    const detail = 'Ссылка недействительна или уже использована';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail }),
    });

    const { container } = renderPage();
    const inputs = passwordInputs(container);
    await user.type(inputs[0], 'longenough1');
    await user.type(inputs[1], 'longenough1');
    await user.click(screen.getByRole('button', { name: /Сохранить новый пароль/ }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    // Успех не выставляется: пользователь должен иметь возможность повторить.
    expect(screen.getByRole('button', { name: /Сохранить новый пароль/ })).toBeInTheDocument();
    expect(screen.queryByText(/Пароль успешно обновлён/)).not.toBeInTheDocument();
  });

  it('сетевой сбой не оставляет кнопку заблокированной', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

    const { container } = renderPage();
    const inputs = passwordInputs(container);
    await user.type(inputs[0], 'longenough1');
    await user.type(inputs[1], 'longenough1');
    await user.click(screen.getByRole('button', { name: /Сохранить новый пароль/ }));

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Сохранить новый пароль/ })).toBeEnabled();
  });
});
