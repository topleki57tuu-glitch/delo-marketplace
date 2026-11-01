// Вкладка «Модерация» в кабинете администратора: ссылки на панель
// управления и арбитраж, очередь проверки личности и заявки на вывод.
// Компонент монтируется только для администратора и грузит очереди при
// открытии вкладки; права на каждый запрос сервер проверяет сам.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { useDialogs } from '../../components/DialogProvider.jsx';
import { Spinner } from '../../components/PageState.jsx';
import {
  IconArrowRight,
  IconCard,
  IconChart,
  IconCheck,
  IconClose,
  IconJustice,
  IconPhone,
  IconRefresh,
} from '../../components/icons.jsx';
import { EmptyLine, Panel, VERIFICATION_STATUS, WITHDRAWAL_STATUS, dateTime, rub } from './profileShared.jsx';

export default function AdminTab({ token, onUpdateUser }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [adminVerifications, setAdminVerifications] = useState([]);
  const [processingAdminId, setProcessingAdminId] = useState(null);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [processingWdId, setProcessingWdId] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);

  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const loadAdminWithdrawals = () => {
    if (!token) return Promise.resolve();
    return fetch('/admin/withdrawals', { headers: auth })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAdminWithdrawals(Array.isArray(data) ? data : []))
      .catch(() => setAdminWithdrawals([]));
  };

  const loadAdminVerifications = () => {
    if (!token) return Promise.resolve();
    return fetch('/verification/admin/list', { headers: auth })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAdminVerifications(Array.isArray(data) ? data : []))
      .catch(() => setAdminVerifications([]));
  };

  useEffect(() => {
    if (!token) return;
    setAdminLoading(true);
    Promise.allSettled([loadAdminVerifications(), loadAdminWithdrawals()]).finally(() => setAdminLoading(false));
  }, [token]);

  const handleAdminWithdrawalReview = async (w, action) => {
    let comment = null;
    if (action === 'approve') {
      const ok = await dialogs.confirm({
        title: `Отметить выплату ${rub(w.amount)} как проведённую?`,
        message: `Подтверждайте, только когда деньги уже ушли на реквизиты: ${w.requisites}.`,
        confirmText: 'Выплачено',
      });
      if (!ok) return;
    } else {
      comment = await dialogs.prompt({
        title: 'Отклонить заявку на вывод?',
        message: 'Деньги вернутся на баланс пользователя. Причину он увидит в уведомлении.',
        defaultValue: 'Реквизиты не прошли проверку',
        confirmText: 'Отклонить',
        validate: (v) => (v.trim() ? null : 'Укажите причину'),
      });
      if (comment === null || comment === undefined) return;
    }

    setProcessingWdId(w.id);
    try {
      const res = await fetch(`/admin/withdrawals/${w.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ action, comment: comment ? comment.trim() : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось обработать заявку');
      addToast(action === 'approve' ? 'Заявка отмечена как выплаченная' : 'Заявка отклонена, деньги возвращены', 'success');
      loadAdminWithdrawals();
      onUpdateUser?.();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setProcessingWdId(null);
    }
  };

  const handleAdminReview = async (item, action) => {
    let reason = '';
    if (action === 'reject') {
      reason = await dialogs.prompt({
        title: 'Отклонить заявку?',
        message: `${item.full_name} увидит причину и сможет подать заявку заново.`,
        defaultValue: 'Нечёткое фото или неверные реквизиты',
        confirmText: 'Отклонить',
        validate: (v) => (v.trim() ? null : 'Укажите причину'),
      });
      if (reason === null || reason === undefined) return;
    }
    setProcessingAdminId(item.id);
    try {
      const res = await fetch(`/verification/admin/${item.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ action, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Ошибка рассмотрения');

      addToast(action === 'approve' ? 'Пользователь подтверждён' : 'Заявка отклонена', 'success');
      loadAdminVerifications();
      onUpdateUser?.();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setProcessingAdminId(null);
    }
  };

  const pendingVerifications = adminVerifications.filter((v) => v.status === 'pending').length;
  const pendingWithdrawals = adminWithdrawals.filter((w) => w.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { to: '/admin/dashboard', icon: IconChart, title: 'Панель управления', text: 'Сводка, пользователи, активность' },
          { to: '/disputes', icon: IconJustice, title: 'Арбитраж споров', text: 'Решения по спорным сделкам' },
        ].map(({ to, icon: Icon, title, text }) => (
          <Link key={to} to={to} className="card card-hover p-4 sm:p-5 flex items-center gap-4">
            <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              <Icon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-900 dark:text-white">{title}</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">{text}</span>
            </span>
            <IconArrowRight size={18} className="shrink-0 text-slate-400" />
          </Link>
        ))}
      </div>

      <Panel
        eyebrow="Модерация"
        title="Проверка личности"
        text={pendingVerifications ? `Ждут решения: ${pendingVerifications}` : 'Новых заявок нет'}
        action={
          <button type="button" onClick={loadAdminVerifications} className="btn btn-ghost !px-3 !py-2">
            <IconRefresh size={16} /> Обновить
          </button>
        }
      >
        {adminLoading && !adminVerifications.length ? (
          <Spinner label="Загрузка заявок..." />
        ) : adminVerifications.length === 0 ? (
          <EmptyLine>Заявок на проверку пока нет.</EmptyLine>
        ) : (
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-700/70">
            {adminVerifications.map((item) => {
              const meta = VERIFICATION_STATUS[item.status] || VERIFICATION_STATUS.pending;
              const busy = processingAdminId === item.id;
              return (
                <li key={item.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{item.full_name}</span>
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-all">
                      ID {item.user_id} · {item.user_email} · {item.document_type === 'passport' ? 'Паспорт РФ' : 'Самозанятый / ИНН'}
                    </p>
                    {item.document_number && (
                      <p className="mt-0.5 text-xs font-mono text-slate-700 dark:text-slate-300">№ {item.document_number}</p>
                    )}
                    <p className="text-[11px] text-slate-400">{dateTime(item.created_at)}</p>
                  </div>
                  {item.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => handleAdminReview(item, 'approve')} disabled={busy} className="btn btn-primary !px-3 !py-2">
                        <IconCheck size={16} /> Одобрить
                      </button>
                      <button type="button" onClick={() => handleAdminReview(item, 'reject')} disabled={busy} className="btn btn-secondary !px-3 !py-2">
                        <IconClose size={16} /> Отклонить
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        eyebrow="Выплаты"
        title="Заявки на вывод"
        text={pendingWithdrawals ? `Ждут выплаты: ${pendingWithdrawals}` : 'Очередь пуста'}
        action={
          <button type="button" onClick={loadAdminWithdrawals} className="btn btn-ghost !px-3 !py-2">
            <IconRefresh size={16} /> Обновить
          </button>
        }
      >
        {adminLoading && !adminWithdrawals.length ? (
          <Spinner label="Загрузка заявок..." />
        ) : adminWithdrawals.length === 0 ? (
          <EmptyLine>Заявок на вывод пока нет.</EmptyLine>
        ) : (
          <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-700/70">
            {adminWithdrawals.map((w) => {
              const meta = WITHDRAWAL_STATUS[w.status] || { label: w.status, cls: WITHDRAWAL_STATUS.cancelled.cls };
              const busy = processingWdId === w.id;
              return (
                <li key={w.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{rub(w.amount)}</span>
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-all">
                      {w.user_name} · {w.user_email} · баланс {rub(w.user_balance)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs font-mono text-slate-700 dark:text-slate-300 break-all">
                      {w.method === 'card' ? <IconCard size={14} /> : <IconPhone size={14} />} {w.requisites}
                    </p>
                    {w.comment && <p className="text-xs text-slate-500 dark:text-slate-400">{w.comment}</p>}
                    <p className="text-[11px] text-slate-400">{dateTime(w.created_at)}</p>
                  </div>
                  {w.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => handleAdminWithdrawalReview(w, 'approve')} disabled={busy} className="btn btn-primary !px-3 !py-2">
                        <IconCheck size={16} /> Выплачено
                      </button>
                      <button type="button" onClick={() => handleAdminWithdrawalReview(w, 'reject')} disabled={busy} className="btn btn-secondary !px-3 !py-2">
                        <IconClose size={16} /> Отклонить
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
