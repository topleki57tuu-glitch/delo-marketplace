// Вкладка «Отклики и PRO» (есть только у специалиста): текущий тариф
// и пакеты откликов и подписки, которые покупаются с баланса.
import React, { useState } from 'react';
import { useToast } from '../../components/Toast';
import { useDialogs } from '../../components/DialogProvider.jsx';
import { PACKAGES, Panel, longDate, rub } from './profileShared.jsx';

export default function ProTab({ user, token, onUpdateUser, onOpenDeposit }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [buyingPackage, setBuyingPackage] = useState(null);
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const handleBuyPackage = async (packageId) => {
    const pkg = PACKAGES[packageId];
    const ok = await dialogs.confirm({
      title: `Купить «${pkg.title}» за ${rub(pkg.price)}?`,
      message: `Сумма спишется с баланса — сейчас на нём ${rub(user.balance)}.`,
      confirmText: 'Купить',
    });
    if (!ok) return;
    setBuyingPackage(packageId);
    try {
      const res = await fetch('/monetization/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ package_id: packageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось приобрести пакет');

      addToast(data.message || 'Пакет активирован', 'success');
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBuyingPackage(null);
    }
  };

  return (
    <div className="space-y-5">
      <Panel eyebrow="Ваш тариф" title={user.is_pro ? 'PRO активен' : 'Стандартный'}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 text-sm text-slate-500 dark:text-slate-400">
            {user.is_pro ? (
              <>
                Подписка действует{longDate(user.pro_until) ? ` до ${longDate(user.pro_until)}` : ' до конца периода'}: комиссия
                сервиса 0% и безлимитные отклики.
              </>
            ) : (
              <>Каждый отклик на задание расходует один кредит. Комиссия безопасной сделки — 5%, с PRO — 0%.</>
            )}
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 px-4 py-3 min-w-[8rem]">
              <p className="text-xs font-semibold text-slate-400">Отклики</p>
              <p className="mt-0.5 text-lg font-extrabold text-slate-900 dark:text-white">{user.is_pro ? '∞' : user.response_credits || 0}</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 px-4 py-3 min-w-[8rem]">
              <p className="text-xs font-semibold text-slate-400">Комиссия</p>
              <p className="mt-0.5 text-lg font-extrabold text-slate-900 dark:text-white">{user.is_pro ? '0%' : '5%'}</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { id: 'resp_10', eyebrow: 'Пакет откликов', text: '19 ₽ за отклик — чтобы начать и попробовать.', cta: 'Купить пакет' },
          { id: 'pro_1', eyebrow: 'PRO на месяц', text: '0% комиссии и безлимитные отклики. Окупается с первого крупного заказа.', cta: 'Подключить PRO', popular: true },
          { id: 'pro_3', eyebrow: 'PRO на 3 месяца', text: '90 дней без комиссии — выгоднее помесячной подписки.', cta: 'Купить на 3 месяца' },
        ].map((p) => {
          const pkg = PACKAGES[p.id];
          return (
            <section
              key={p.id}
              className={`card p-5 flex flex-col ${p.popular ? 'ring-2 ring-indigo-500 dark:ring-indigo-400' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="section-eyebrow">{p.eyebrow}</p>
                {p.popular && <span className="badge bg-indigo-600 text-white">Популярный</span>}
              </div>
              <h3 className="mt-2 text-lg font-extrabold text-slate-900 dark:text-white">{pkg.title}</h3>
              <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{p.text}</p>
              <p className="mt-4 text-2xl font-extrabold text-slate-900 dark:text-white">{rub(pkg.price)}</p>
              <button
                type="button"
                onClick={() => handleBuyPackage(p.id)}
                disabled={buyingPackage === p.id}
                className={`btn w-full mt-4 ${p.popular ? 'btn-primary' : 'btn-secondary'}`}
              >
                {buyingPackage === p.id ? 'Покупаем...' : p.cta}
              </button>
            </section>
          );
        })}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Пакеты оплачиваются с баланса.{' '}
        <button type="button" onClick={onOpenDeposit} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Пополнить баланс
        </button>
      </p>
    </div>
  );
}
