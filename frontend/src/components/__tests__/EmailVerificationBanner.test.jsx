import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EmailVerificationBanner from '../EmailVerificationBanner';
import { WithdrawModal } from '../WithdrawModal';
import { ToastProvider } from '../Toast';
import { useAuthStore } from '../../store/authStore';

/**
 * Напоминание «Подтвердите почту» и запрет вывода без подтверждения.
 */

const UNVERIFIED = {
  id: 7, email: 'anna@mail.ru', email_verified: false,
  email_verification_available: true, email_verification_required: true,
};

const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });

function renderBanner(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EmailVerificationBanner />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ token: 't', user: UNVERIFIED, isAuth: true });
  global.fetch = vi.fn(() => json({ message: 'Письмо отправлено на anna@mail.ru' }));
});

describe('EmailVerificationBanner', () => {
  it('просит подтвердить почту и объясняет зачем', () => {
    renderBanner();
    const banner = screen.getByRole('region', { name: 'Подтверждение почты' });
    expect(banner).toHaveTextContent('anna@mail.ru');
    expect(banner).toHaveTextContent('Без этого не получится вывести деньги');
  });

  it('«Отправить письмо ещё раз» шлёт запрос и показывает результат', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить письмо ещё раз' }));
    expect(global.fetch).toHaveBeenCalledWith('/auth/resend-verification', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/Письмо отправлено на anna@mail.ru/)).toBeInTheDocument();
  });

  it('лимит писем — понятный текст вместо «повторите через минуту»', async () => {
    global.fetch = vi.fn(() => json({ detail: 'Слишком много запросов, пожалуйста, повторите попытку через минуту' }, 429));
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить письмо ещё раз' }));
    expect(await screen.findByText(/через час/)).toBeInTheDocument();
  });

  it('крестик прячет напоминание до конца сеанса', async () => {
    const { unmount } = renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть напоминание' }));
    expect(screen.queryByRole('region', { name: 'Подтверждение почты' })).not.toBeInTheDocument();
    unmount();
    renderBanner();
    expect(screen.queryByRole('region', { name: 'Подтверждение почты' })).not.toBeInTheDocument();
  });

  it('не показывается подтверждённым, гостям, без почты на сервере и на странице из письма', () => {
    useAuthStore.setState({ user: { ...UNVERIFIED, email_verified: true } });
    const first = renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    first.unmount();

    useAuthStore.setState({ user: { ...UNVERIFIED, email_verification_available: false } });
    const second = renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    second.unmount();

    useAuthStore.setState({ user: UNVERIFIED });
    const third = renderBanner('/verify-email?token=x');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    third.unmount();

    useAuthStore.setState({ token: null, user: UNVERIFIED });
    renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('старый профиль без новых полей — без напоминания', () => {
    useAuthStore.setState({ user: { id: 7, email: 'anna@mail.ru' } });
    renderBanner();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('WithdrawModal и неподтверждённая почта', () => {
  function renderModal() {
    return render(
      <ToastProvider>
        <WithdrawModal balance={5000} onClose={() => {}} />
      </ToastProvider>,
    );
  }

  async function fillForm() {
    await userEvent.type(screen.getByLabelText(/Сумма/), '1000');
    await userEvent.type(screen.getByLabelText('Номер карты'), '4111111111111111');
  }

  it('объясняет заранее и не даёт отправить заявку', async () => {
    renderModal();
    expect(screen.getByRole('alert')).toHaveTextContent('подтвердите почту anna@mail.ru');
    await fillForm();
    expect(screen.getByRole('button', { name: 'Создать заявку на вывод' })).toBeDisabled();
  });

  it('с подтверждённой почтой заявку отправить можно', async () => {
    useAuthStore.setState({ user: { ...UNVERIFIED, email_verified: true } });
    renderModal();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await fillForm();
    expect(screen.getByRole('button', { name: 'Создать заявку на вывод' })).toBeEnabled();
  });

  it('если сервер не требует подтверждения — заявку отправить можно', async () => {
    useAuthStore.setState({ user: { ...UNVERIFIED, email_verification_required: false } });
    renderModal();
    await fillForm();
    expect(screen.getByRole('button', { name: 'Создать заявку на вывод' })).toBeEnabled();
  });
});
