import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useDialogs } from '../components/DialogProvider.jsx';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { AuthRequired, ErrorState, Spinner, StateCard } from '../components/PageState.jsx';
import {
  IconAdmin,
  IconBox,
  IconBriefcase,
  IconJustice,
  IconLock,
  IconParty,
  IconPayout,
  IconRefresh,
  IconTools,
} from '../components/icons.jsx';
import { plural } from '../utils/format.js';
import { apiErrorMessage } from '../utils/apiError';

const formatMoney = (value) => (value ? `${Number(value).toLocaleString('ru-RU')} ₽` : '—');

const DECISIONS = {
  refund_customer: {
    title: 'Вернуть деньги заказчику?',
    message: 'Сумма из эскроу вернётся на баланс заказчика, спор и сделка закроются.',
    confirmText: 'Вернуть заказчику',
  },
  pay_specialist: {
    title: 'Выплатить исполнителю?',
    message: 'Сумма из эскроу (за вычетом комиссии) уйдёт на баланс исполнителя, спор и сделка закроются.',
    confirmText: 'Выплатить',
  },
};

export default function DisputesPage({ user, token, onOpenAuth }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [disputes, setDisputes] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | forbidden | error
  const [resolvingId, setResolvingId] = useState(null);
  const [comments, setComments] = useState({});

  const fetchDisputes = useCallback(async () => {
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const res = await fetch('/admin/disputes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        setStatus('forbidden');
        return;
      }
      if (!res.ok) throw new Error('Не удалось загрузить споры');
      const data = await res.json();
      setDisputes(data.disputes || []);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
    }
  }, [token]);

  // Права арбитра видны по профилю (is_admin). Если профиль уже загружен и
  // прав нет, сразу показываем «нет доступа» — без запроса, который
  // заканчивался 403 и ошибкой в консоли.
  const profileLoaded = !!user;
  const isAdmin = !!user?.is_admin;
  useEffect(() => {
    if (!token || !profileLoaded) return;
    if (!isAdmin) {
      setStatus('forbidden');
      return;
    }
    fetchDisputes();
  }, [token, profileLoaded, isAdmin, fetchDisputes]);

  const handleResolve = async (disputeId, decision) => {
    const ok = await dialogs.confirm({ ...DECISIONS[decision], cancelText: 'Отмена' });
    if (!ok) return;

    setResolvingId(disputeId + decision);
    try {
      const res = await fetch(`/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision, comment: comments[disputeId] || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Ошибка при вынесении решения'));
      addToast(data.message || 'Спор закрыт', 'success');
      fetchDisputes();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setResolvingId(null);
    }
  };

  const total = disputes.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const ready = user && status === 'ready';

  return (
    <>
      <PageHero
        width="medium"
        eyebrow="Модерация"
        icon={IconJustice}
        title="Арбитраж споров"
        subtitle="Споры по заданиям и заказам товаров. Решение закрывает сделку: деньги из эскроу уходят заказчику или исполнителю."
        actions={
          ready && (
            <>
              <button type="button" className="btn btn-glass" onClick={fetchDisputes}>
                <IconRefresh /> Обновить
              </button>
              {user?.is_admin && (
                <Link to="/admin/dashboard" className="btn btn-glass">
                  <IconAdmin /> Панель управления
                </Link>
              )}
            </>
          )
        }
      >
        {ready && (
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <div className="hero-stat">
              <p className="hero-stat-label">Открытых споров</p>
              <p className="hero-stat-value">{disputes.length}</p>
            </div>
            <div className="hero-stat">
              <p className="hero-stat-label">В эскроу</p>
              <p className="hero-stat-value">{formatMoney(total)}</p>
            </div>
          </div>
        )}
      </PageHero>

      <PageBody width="medium">
        {!user ? (
          <AuthRequired onOpenAuth={onOpenAuth} text="Войдите под учётной записью арбитра." />
        ) : status === 'loading' ? (
          <Spinner label="Загрузка споров..." />
        ) : status === 'forbidden' ? (
          <StateCard icon={IconLock} tone="warning" title="Нет доступа" text="Эта страница доступна только арбитрам платформы.">
            <Link to="/tasks" className="btn btn-primary">К списку заданий</Link>
          </StateCard>
        ) : status === 'error' ? (
          <ErrorState text="Не удалось загрузить споры." onRetry={fetchDisputes} />
        ) : disputes.length === 0 ? (
          <StateCard dashed icon={IconParty} title="Открытых споров нет" text="Все сделки идут без конфликтов." />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {disputes.length} {plural(disputes.length, 'спор ждёт', 'спора ждут', 'споров ждут')} решения
            </p>
            {disputes.map((d) => (
              <article key={d.id} className="card p-5 sm:p-6 space-y-4 border-l-4 !border-l-red-500">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Спор может быть по заданию (task_id) или по заказу товара
                        (order_id) — арбитру нужна одна очередь на оба вида. */}
                    <span className="badge bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 mb-2">
                      {d.kind === 'order' ? <><IconBox size={13} /> Заказ товара</> : <><IconBriefcase size={13} /> Задание</>}
                    </span>
                    {d.kind === 'order' ? (
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        {d.title || `Заказ #${d.order_id}`}
                      </h2>
                    ) : (
                      <h2 className="text-lg font-bold">
                        <Link
                          to={`/tasks/${d.task_id}`}
                          className="text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {d.title}
                        </Link>
                      </h2>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                      <span className="inline-flex items-center gap-1"><IconBriefcase size={13} /> {d.customer_name}</span>
                      <span aria-hidden="true">→</span>
                      <span className="inline-flex items-center gap-1"><IconTools size={13} /> {d.executor_name}</span>
                      <span aria-hidden="true">·</span>
                      <span>Спор открыл: <b className="text-slate-700 dark:text-slate-200">{d.opened_by_name}</b></span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <span className="text-xs text-slate-400 block">Сумма эскроу</span>
                    <span className="text-xl font-extrabold text-amber-600 dark:text-amber-400">{formatMoney(d.amount)}</span>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-4 text-sm text-slate-700 dark:text-slate-300">
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Причина спора</span>
                  {d.reason}
                </div>

                <div>
                  <label htmlFor={`dispute-comment-${d.id}`} className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                    Комментарий арбитра — его увидят обе стороны
                  </label>
                  <textarea
                    id={`dispute-comment-${d.id}`}
                    rows={2}
                    placeholder="Почему принято такое решение..."
                    value={comments[d.id] || ''}
                    onChange={(e) => setComments({ ...comments, [d.id]: e.target.value })}
                    className="textarea"
                  />
                </div>

                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => handleResolve(d.id, 'refund_customer')}
                    disabled={!!resolvingId}
                    className="btn btn-secondary"
                  >
                    {resolvingId === d.id + 'refund_customer' ? 'Обработка...' : '↩ Вернуть заказчику'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(d.id, 'pay_specialist')}
                    disabled={!!resolvingId}
                    className="btn bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    {resolvingId === d.id + 'pay_specialist' ? 'Обработка...' : <><IconPayout /> Выплатить исполнителю</>}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
