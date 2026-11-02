// Вкладка «Кошелёк» личного кабинета: история операций с выгрузкой в CSV,
// заявки на вывод и ручная проверка зависших пополнений. Окна пополнения
// и вывода открывает страница — до них можно дойти и из шапки кабинета.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { Spinner } from '../../components/PageState.jsx';
import { IconArrowRight, IconBank, IconCard, IconDownload, IconPhone, IconRefresh, IconWallet } from '../../components/icons.jsx';
import { EmptyLine, Panel, TX_TYPES, WITHDRAWAL_STATUS, dateTime, rub } from './profileShared.jsx';

const iconBox = 'w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300';

export default function WalletTab({
  user,
  token,
  withdrawalsVersion,
  canWithdraw,
  withdrawHint,
  onOpenWithdraw,
  checkingPayments,
  onCheckPayments,
}) {
  const { addToast } = useToast();
  const isSpecialist = user.role === 'specialist';
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [showAllTx, setShowAllTx] = useState(false);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);

  const loadWithdrawals = () => {
    if (!token) return;
    setLoadingWithdrawals(true);
    fetch('/wallet/withdrawals', { headers: auth })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setWithdrawals(Array.isArray(data) ? data : []))
      .catch(() => setWithdrawals([]))
      .finally(() => setLoadingWithdrawals(false));
  };

  const loadTransactions = () => {
    if (!token) return;
    setLoadingTx(true);
    fetch('/wallet/transactions', { headers: auth })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTransactions(Array.isArray(data) ? data : []))
      .catch(() => setTransactions([]))
      .finally(() => setLoadingTx(false));
  };

  useEffect(() => {
    loadTransactions();
  }, [user.id, token]);

  // Заявки перечитываем и после новой заявки на вывод: страница меняет
  // withdrawalsVersion, когда окно вывода сообщает о созданной заявке.
  useEffect(() => {
    loadWithdrawals();
  }, [user.id, token, withdrawalsVersion]);

  const handleDownloadCsv = async () => {
    try {
      const res = await fetch('/wallet/transactions.csv', { headers: auth });
      if (!res.ok) throw new Error('Не удалось скачать отчёт');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'delo_transactions.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const visibleTx = showAllTx ? transactions : transactions.slice(0, 8);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
      <div className="space-y-5 min-w-0">
        <Panel
          eyebrow="Кошелёк"
          title="История операций"
          text="Пополнения, сделки, выплаты и покупки"
          action={
            <button type="button" onClick={handleDownloadCsv} disabled={!transactions.length} className="btn btn-secondary !px-3 !py-2">
              <IconDownload size={16} /> CSV
            </button>
          }
        >
          {loadingTx ? (
            <Spinner label="Загрузка операций..." />
          ) : transactions.length === 0 ? (
            <EmptyLine>Операций пока не было. Пополните баланс — и оплачивайте задания через безопасную сделку.</EmptyLine>
          ) : (
            <>
              <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-700/70">
                {visibleTx.map((tx) => {
                  const meta = TX_TYPES[tx.type] || { label: tx.type, icon: IconWallet };
                  const Icon = meta.icon;
                  const amount = Number(tx.amount) || 0;
                  return (
                    <li key={tx.id} className="flex items-start gap-3 py-3">
                      <span className={iconBox}>
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{meta.label}</p>
                        {tx.task_title && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{tx.task_title}</p>}
                        {tx.fee > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Комиссия сервиса: {rub(tx.fee)}</p>}
                        <p className="text-[11px] text-slate-400">{dateTime(tx.created_at)}</p>
                      </div>
                      <span className={`shrink-0 text-sm font-extrabold ${amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        {amount >= 0 ? '+' : '−'}
                        {rub(Math.abs(amount))}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {transactions.length > 8 && (
                <button type="button" onClick={() => setShowAllTx((v) => !v)} className="btn btn-ghost w-full mt-4">
                  {showAllTx ? 'Свернуть' : `Показать все (${transactions.length})`}
                </button>
              )}
            </>
          )}
        </Panel>

        <Panel
          eyebrow="Выплаты"
          title="Вывод средств"
          text="На карту или по СБП, от 500 ₽"
          action={
            <button
              type="button"
              onClick={onOpenWithdraw}
              disabled={!canWithdraw}
              title={withdrawHint}
              className="btn btn-secondary !px-3 !py-2"
            >
              <IconBank size={16} /> Новая заявка
            </button>
          }
        >
          {loadingWithdrawals ? (
            <Spinner label="Загрузка заявок..." />
          ) : withdrawals.length === 0 ? (
            <EmptyLine>Заявок на вывод пока не было.</EmptyLine>
          ) : (
            <ul className="-my-3 divide-y divide-slate-100 dark:divide-slate-700/70">
              {withdrawals.map((w) => {
                const meta = WITHDRAWAL_STATUS[w.status] || { label: w.status, cls: WITHDRAWAL_STATUS.cancelled.cls };
                return (
                  <li key={w.id} className="flex items-start gap-3 py-3">
                    <span className={iconBox}>{w.method === 'card' ? <IconCard size={16} /> : <IconPhone size={16} />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {rub(w.amount)}
                        <span className="font-normal text-slate-500 dark:text-slate-400"> · {w.method === 'card' ? 'на карту' : 'по СБП'}</span>
                      </p>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">{w.requisites}</p>
                      {w.comment && <p className="text-xs text-slate-500 dark:text-slate-400">{w.comment}</p>}
                      <p className="text-[11px] text-slate-400">{dateTime(w.created_at)}</p>
                    </div>
                    <span className={`badge shrink-0 ${meta.cls}`}>{meta.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <aside className="space-y-5">
        <Panel eyebrow="Пополнение" title="Не видите оплату?">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Обычно деньги зачисляются сразу. Если оплата прошла, а баланс не изменился, — проверьте её вручную.
          </p>
          <button type="button" onClick={() => onCheckPayments()} disabled={checkingPayments} className="btn btn-secondary w-full mt-4">
            <IconRefresh size={16} className={checkingPayments ? 'animate-spin' : ''} />
            {checkingPayments ? 'Проверяем...' : 'Проверить оплату'}
          </button>
        </Panel>
        <Panel eyebrow="Безопасная сделка" title="Как работают деньги">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isSpecialist
              ? `Оплата за задание резервируется у заказчика и приходит вам после приёмки работы. Комиссия сервиса — ${user.is_pro ? '0% с PRO' : '5%'}.`
              : 'При выборе исполнителя сумма резервируется на балансе. Исполнитель получит деньги, только когда вы примете работу.'}
          </p>
          <Link to="/my-tasks" className="btn btn-ghost w-full mt-4">
            Мои заказы <IconArrowRight size={16} />
          </Link>
        </Panel>
      </aside>
    </div>
  );
}
