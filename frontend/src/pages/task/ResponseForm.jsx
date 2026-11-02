// Форма отклика специалиста на открытое задание. Поле текста отдаётся
// наружу через fieldRef: кнопка «Откликнуться» в шапке ставит в него фокус.
import React, { useState } from 'react';
import { useToast } from '../../components/Toast';
import { Card } from './taskDetailShared.jsx';
import { apiErrorMessage } from '../../utils/apiError';

export default function ResponseForm({ task, taskId, user, token, fieldRef, onOpenAuth, onSent }) {
  const { addToast } = useToast();
  const [responseText, setResponseText] = useState('');
  const [proposedPrice, setProposedPrice] = useState('');
  const [estimatedDays, setEstimatedDays] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);

  const handleSendResponse = async (e) => {
    e.preventDefault();
    if (!token) {
      onOpenAuth('login');
      return;
    }
    if (!responseText.trim()) {
      addToast('Напишите текст отклика', 'error');
      return;
    }

    setSubmittingResponse(true);
    try {
      const res = await fetch(`/tasks/${taskId}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: responseText.trim(),
          proposed_price: proposedPrice ? parseInt(proposedPrice, 10) : null,
          estimated_days: estimatedDays ? parseInt(estimatedDays, 10) : null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Не удалось отправить отклик'));

      addToast('Отклик отправлен — заказчик получит уведомление', 'success');
      setResponseText('');
      setProposedPrice('');
      setEstimatedDays('');
      onSent();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmittingResponse(false);
    }
  };

  return (
    <Card id="respond" eyebrow="Отклик" title="Предложите свою цену и сроки" className="scroll-mt-24">
      <form onSubmit={handleSendResponse} className="space-y-4">
        <div>
          <label htmlFor="response-text" className="field-label">Сообщение заказчику</label>
          <textarea
            id="response-text"
            ref={fieldRef}
            rows={4}
            placeholder="Почему вы подходите: опыт, похожие работы, когда готовы начать..."
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            className="textarea"
            maxLength={3000}
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="response-price" className="field-label">Ваша цена, ₽</label>
            <input
              id="response-price"
              type="number"
              min="0"
              max="10000000"
              inputMode="numeric"
              placeholder={task.budget ? String(task.budget) : 'Например: 5000'}
              value={proposedPrice}
              onChange={(e) => setProposedPrice(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="response-days" className="field-label">Срок, дней</label>
            <input
              id="response-days"
              type="number"
              min="1"
              max="365"
              inputMode="numeric"
              placeholder="Например: 3"
              value={estimatedDays}
              onChange={(e) => setEstimatedDays(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {user.is_pro
              ? 'PRO: отклики без ограничений'
              : `Отклик спишет 1 из доступных: ${user.response_credits ?? 0}`}
          </p>
          <button type="submit" disabled={submittingResponse} className="btn btn-primary">
            {submittingResponse ? 'Отправка...' : 'Отправить отклик'}
          </button>
        </div>
      </form>
    </Card>
  );
}
