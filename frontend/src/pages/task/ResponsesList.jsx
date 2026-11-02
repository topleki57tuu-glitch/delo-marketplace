// Список откликов на задание. Чужие отклики бэкенд отдаёт только автору
// задания — он же выбирает здесь исполнителя (бюджет при этом замораживается).
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { useDialogs } from '../../components/DialogProvider.jsx';
import { countLabel } from '../../utils/format.js';
import { IconCheck, IconStar } from '../../components/icons.jsx';
import { Card, formatMoney } from './taskDetailShared.jsx';
import { apiErrorMessage } from '../../utils/apiError';
import { fetchFreshBalance } from '../../utils/balance.js';

export default function ResponsesList({ task, taskId, token, responses, responsesCount, isAuthor, balance, onChanged }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const [assigningId, setAssigningId] = useState(null);

  const budget = Number(task.budget) || 0;

  // Денег на балансе меньше бюджета — сервер всё равно откажет. Вместо
  // ошибки после подтверждения сразу предлагаем пополнить баланс: кошелёк
  // откроется с нужной суммой и после оплаты вернёт обратно к заданию.
  const offerTopUp = async (missing, current) => {
    const known = Number.isFinite(missing) && missing > 0;
    const goTopUp = await dialogs.confirm({
      title: 'Не хватает денег для безопасной сделки',
      message: known
        ? `При выборе исполнителя с баланса замораживается бюджет задания — ${formatMoney(budget)}. Сейчас на балансе ${formatMoney(current || 0)}, не хватает ${formatMoney(missing)}.\n\nПополните баланс и вернитесь к выбору исполнителя.`
        : `При выборе исполнителя с баланса замораживается бюджет задания — ${formatMoney(budget)}. Пополните баланс и вернитесь к выбору исполнителя.`,
      confirmText: 'Пополнить баланс',
    });
    if (!goTopUp) return;
    // Сколько не хватает, известно не всегда (баланс на странице мог
    // устареть) — тогда предлагаем пополнить на весь бюджет.
    const amount = Math.max(100, Math.ceil(known ? missing : budget));
    const params = new URLSearchParams({ tab: 'wallet', topup: String(amount), return: `/tasks/${taskId}` });
    navigate(`/profile?${params}`);
  };

  const handleAssignSpecialist = async (resp) => {
    const specialistId = resp.specialist_id;
    const name = resp.specialist_name;
    const price = Number(resp.proposed_price) || 0;

    if (budget > 0 && typeof balance === 'number' && balance < budget) {
      const actual = await fetchFreshBalance(token, balance);
      if (actual < budget) {
        await offerTopUp(budget - actual, actual);
        return;
      }
    }

    // В сделке участвует бюджет задания, а не цена из отклика: изменить
    // бюджет после публикации нельзя, поэтому говорим об этом заранее.
    let message;
    if (budget > 0) {
      message = `С вашего баланса заморозится ${formatMoney(budget)} — бюджет задания. Деньги перейдут исполнителю, когда вы примете работу.`;
      if (price > 0 && price !== budget) {
        message += `\n\nСпециалист предложил ${formatMoney(price)}, но в безопасной сделке участвует бюджет задания.`;
      }
      message += '\n\nПосле назначения отменить заказ в одностороннем порядке нельзя: если что-то пойдёт не так, откройте спор — арбитр решит, вернуть ли деньги.';
    } else {
      message = 'У задания не указан бюджет, поэтому деньги не замораживаются и безопасная сделка не действует: об оплате договоритесь с исполнителем в чате.';
    }

    const ok = await dialogs.confirm({
      title: `Выбрать исполнителем${name ? ` — ${name}` : ''}?`,
      message,
      confirmText: 'Назначить',
    });
    if (!ok) return;

    setAssigningId(specialistId);
    try {
      const res = await fetch(`/tasks/${taskId}/assign?specialist_id=${specialistId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text = apiErrorMessage(data, 'Ошибка при назначении исполнителя');
        // Баланс на странице мог устареть (деньги ушли в другой вкладке).
        if (res.status === 400 && /Недостаточно средств/i.test(text)) {
          setAssigningId(null);
          const actual = await fetchFreshBalance(token, NaN);
          await offerTopUp(budget - actual, actual);
          return;
        }
        throw new Error(text);
      }

      addToast('Исполнитель назначен — заказ в работе', 'success');
      onChanged();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <Card eyebrow="Отклики" title={`Специалисты · ${responsesCount || 0}`}>
      {/* Чужие отклики видит только автор задания (бэкенд отдаёт остальным
          лишь их собственный). Поэтому «Будьте первым» показываем, только
          когда откликов действительно нет. */}
      {responses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          {!isAuthor && (task.responses_count || 0) > 0
            ? 'Отклики видит только заказчик. Откликнитесь, чтобы предложить свою цену и сроки.'
            : task.status === 'open'
              ? 'Пока нет откликов. Будьте первым!'
              : 'Откликов не было.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {responses.map((resp) => {
            const isExecutor = task.executor_id === resp.specialist_id;
            return (
              <li key={resp.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="relative shrink-0">
                      <span className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center overflow-hidden">
                        {resp.specialist_avatar ? (
                          <img src={resp.specialist_avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          (resp.specialist_name || 'С')[0].toUpperCase()
                        )}
                      </span>
                      {resp.specialist_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full" title="В сети" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          to={`/specialist/${resp.specialist_id}`}
                          className="font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                        >
                          {resp.specialist_name || 'Специалист'}
                        </Link>
                        {resp.specialist_pro && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">PRO</span>
                        )}
                        {resp.specialist_verified && <IconCheck size={14} className="text-sky-500" title="Проверен" />}
                        {isExecutor && (
                          <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Исполнитель</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <IconStar size={13} fill="currentColor" className="text-amber-400" />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {resp.specialist_rating != null ? Number(resp.specialist_rating).toFixed(1) : '—'}
                        </span>
                        <span>· {countLabel(resp.specialist_completed_tasks || 0, 'заказ', 'заказа', 'заказов')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {resp.proposed_price ? (
                      <span className="block font-extrabold text-slate-900 dark:text-white">{formatMoney(resp.proposed_price)}</span>
                    ) : null}
                    {resp.estimated_days ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {countLabel(resp.estimated_days, 'день', 'дня', 'дней')}
                      </span>
                    ) : null}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{resp.text}</p>

                {isAuthor && task.status === 'open' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAssignSpecialist(resp)}
                      disabled={assigningId === resp.specialist_id}
                      className="btn btn-primary !py-2 !text-xs"
                    >
                      {assigningId === resp.specialist_id ? 'Назначение...' : 'Выбрать исполнителем'}
                    </button>
                    <Link to={`/specialist/${resp.specialist_id}`} className="btn btn-secondary !py-2 !text-xs">
                      Профиль и отзывы
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
