import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogProvider, useDialogs } from '../DialogProvider.jsx';

/**
 * Диалоги сайта заменили window.confirm / window.prompt. Страницы ждут от
 * них того же контракта: confirm → true/false, prompt → строка или null
 * при отмене, а validate не даёт отправить пустую причину.
 */

function Harness({ kind, options }) {
  const dialogs = useDialogs();
  const [result, setResult] = useState('—');
  return (
    <>
      <button type="button" onClick={async () => setResult(JSON.stringify(await dialogs[kind](options)))}>
        Открыть
      </button>
      <output>{result}</output>
    </>
  );
}

function renderHarness(kind, options) {
  return render(
    <DialogProvider>
      <Harness kind={kind} options={options} />
    </DialogProvider>
  );
}

describe('DialogProvider', () => {
  it('confirm отдаёт true по кнопке подтверждения', async () => {
    const user = userEvent.setup();
    renderHarness('confirm', { title: 'Удалить товар?', confirmText: 'Удалить', danger: true });

    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByRole('alertdialog', { name: 'Удалить товар?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('true');
  });

  it('confirm отдаёт false по «Отмене» и по Escape', async () => {
    const user = userEvent.setup();
    renderHarness('confirm', { title: 'Точно?' });

    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByRole('status')).toHaveTextContent('false');

    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('false');
  });

  it('prompt с validate не принимает пустую причину и отдаёт введённый текст', async () => {
    const user = userEvent.setup();
    renderHarness('prompt', {
      title: 'Причина отклонения',
      confirmText: 'Отклонить',
      validate: (v) => (v.trim() ? null : 'Укажите причину'),
    });

    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    await user.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(screen.getByText('Укажите причину')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Причина отклонения' }), 'Нечёткое фото');
    await user.click(screen.getByRole('button', { name: 'Отклонить' }));

    expect(screen.getByRole('status')).toHaveTextContent('"Нечёткое фото"');
  });

  it('prompt отдаёт null при отмене', async () => {
    const user = userEvent.setup();
    renderHarness('prompt', { title: 'Комментарий', defaultValue: 'черновик' });

    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveValue('черновик');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.getByRole('status')).toHaveTextContent('null');
  });
});
