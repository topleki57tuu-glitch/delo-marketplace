// Действия по сделке для её участников: принять работу и выплатить,
// открыть спор, отказаться от заказа или отозвать свой спор.
import React, { useState } from 'react';
import { useToast } from '../../components/Toast';
import { useDialogs } from '../../components/DialogProvider.jsx';
import { IconCheck, IconWarning } from '../../components/icons.jsx';
import { Card } from './taskDetailShared.jsx';

export default function DealActions({
  task,
  taskId,
  token,
  user,
  dispute,
  isAuthor,
  isAssignedSpecialist,
  canCancel,
  onChanged,
  onCompleted,
}) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [openingDispute, setOpeningDispute] = useState(false);

  const handleCompleteTask = async () => {
    const ok = await dialogs.confirm({
      title: 'Принять работу?',
      message: 'Замороженный бюджет будет переведён исполнителю. Отменить это действие нельзя.',
      confirmText: 'Принять и выплатить',
    });
    if (!ok) return;

    setCompleting(true);
    try {
      const res = await fetch(`/tasks/${taskId}/complete`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Ошибка при завершении заказа');

      addToast('Заказ завершён, деньги переведены исполнителю', 'success');
      onCompleted();
      onChanged();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCompleting(false);
    }
  };

  const handleOpenDispute = async () => {
    const reason = await dialogs.prompt({
      title: 'Открыть спор',
      message:
        'Деньги останутся замороженными, пока арбитраж площадки не вынесет решение: вернуть их заказчику или выплатить исполнителю.',
      placeholder: 'Опишите проблему: что пошло не так, какие договорённости нарушены...',
      multiline: true,
      confirmText: 'Открыть спор',
      validate: (v) => (v.trim().length < 5 ? 'Опишите причину спора — хотя бы пару слов' : null),
    });
    if (reason === null || reason === undefined) return;

    setOpeningDispute(true);
    try {
      const res = await fetch(`/tasks/${taskId}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось открыть спор');
      addToast(data.message || 'Спор открыт', 'success');
      onChanged();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setOpeningDispute(false);
    }
  };

  const handleCancelTask = async () => {
    const isMyDispute = dispute && dispute.status === 'open' && user && dispute.opened_by === user.id;
    let options;
    if (isMyDispute && isAuthor) {
      options = {
        title: 'Отозвать спор?',
        message: 'Заказ вернётся в работу, деньги останутся замороженными до завершения.',
        confirmText: 'Отозвать спор',
      };
    } else if (isMyDispute) {
      options = {
        title: 'Отозвать спор и отказаться от заказа?',
        message: 'Замороженные деньги вернутся заказчику.',
        confirmText: 'Отказаться',
        danger: true,
      };
    } else {
      options = {
        title: 'Отказаться от заказа?',
        message: 'Замороженные деньги (эскроу) вернутся заказчику, заказ снова станет открытым для других специалистов.',
        confirmText: 'Отказаться',
        danger: true,
      };
    }
    if (!(await dialogs.confirm(options))) return;

    setCancelling(true);
    try {
      const res = await fetch(`/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось выполнить действие');
      addToast(data.message || 'Готово', 'success');
      onChanged();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card eyebrow="Сделка">
      <div className="space-y-2">
        {isAuthor && task.status === 'in_progress' && (
          <button type="button" onClick={handleCompleteTask} disabled={completing} className="btn w-full bg-emerald-600 hover:bg-emerald-500 text-white">
            {completing ? 'Завершение...' : <><IconCheck /> Принять работу и оплатить</>}
          </button>
        )}
        {task.status === 'in_progress' && !task.has_open_dispute && (
          <button
            type="button"
            onClick={handleOpenDispute}
            disabled={openingDispute}
            className="btn w-full border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20"
          >
            <IconWarning /> {openingDispute ? 'Открываем спор...' : 'Открыть спор'}
          </button>
        )}
        {/* Заказ в работе может отменить только исполнитель (отказ); заказчик — через спор.
            В споре — только инициатор: заказчик отзывает спор (заказ возвращается в работу),
            исполнитель отзывает спор и отказывается (эскроу возвращается заказчику). */}
        {canCancel && (
          <button type="button" onClick={handleCancelTask} disabled={cancelling} className="btn btn-secondary w-full">
            {cancelling
              ? 'Отмена...'
              : task.status === 'disputed'
                ? isAuthor
                  ? 'Отозвать спор'
                  : 'Отозвать спор и отказаться'
                : 'Отказаться от заказа'}
          </button>
        )}
      </div>
      {isAuthor && task.status === 'in_progress' && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Заказ в работе нельзя отменить в одностороннем порядке. Если исполнитель не справляется,
          откройте спор — арбитр решит, вернуть ли вам деньги. Исполнитель может сам отказаться
          от заказа, тогда деньги вернутся автоматически.
        </p>
      )}
      {isAssignedSpecialist && task.status === 'in_progress' && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Если откажетесь, замороженные деньги вернутся заказчику.
        </p>
      )}
    </Card>
  );
}
