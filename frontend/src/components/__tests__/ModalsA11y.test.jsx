import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../Toast';
import { PaymentModal } from '../PaymentModal';
import { WithdrawModal } from '../WithdrawModal';
import { AITaskAssistant } from '../AITaskAssistant';

/**
 * Денежные окна (пополнение, вывод) и AI-помощник раньше были просто
 * `div` поверх страницы: экранный диктор не понимал, что открылось окно,
 * Escape его не закрывал, а Tab уводил фокус на страницу под затемнением.
 * Остальные окна сайта (отзыв, подтверждение, вход) так уже умели.
 */

const MODALS = [
  ['PaymentModal', (onClose) => <PaymentModal token="t" onClose={onClose} onSuccess={() => {}} />, 'Пополнение баланса'],
  ['WithdrawModal', (onClose) => <WithdrawModal balance={1000} onClose={onClose} onCreated={() => {}} />, 'Вывод средств'],
  ['AITaskAssistant', (onClose) => <AITaskAssistant onClose={onClose} onApplySuggestion={() => {}} currentTask={{}} />, /AI-Помощник/],
];

describe.each(MODALS)('%s', (_name, renderModal, title) => {
  it('объявляется как модальное окно с заголовком', () => {
    render(<ToastProvider>{renderModal(() => {})}</ToastProvider>);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('закрывается по Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ToastProvider>{renderModal(onClose)}</ToastProvider>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('держит фокус внутри окна', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <button type="button">кнопка страницы</button>
        {renderModal(() => {})}
      </ToastProvider>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 15; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
