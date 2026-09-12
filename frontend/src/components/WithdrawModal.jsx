import React, { useState } from 'react';
import { useToast } from './Toast';
import { useAuthStore } from '../store/authStore';

const MIN_AMOUNT = 500;

const METHODS = [
  { id: 'card', label: 'На карту', icon: '💳', hint: 'Номер карты, 16 цифр' },
  { id: 'sbp',  label: 'По СБП',   icon: '📱', hint: 'Номер телефона, привязанный к банку' },
];

/**
 * Заявка на вывод заработанных средств.
 *
 * Сумма резервируется сразу при подаче (как эскроу при назначении исполнителя),
 * поэтому на экране прямо сказано, что деньги уйдут с баланса в резерв.
 */
export const WithdrawModal = ({ balance = 0, onClose, onCreated }) => {
  const toast = useToast();
  const { token } = useAuthStore();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('card');
  const [requisites, setRequisites] = useState('');
  const [loading, setLoading] = useState(false);

  const numericAmount = Number(amount) || 0;
  const tooSmall = numericAmount > 0 && numericAmount < MIN_AMOUNT;
  const tooBig = numericAmount > balance;
  const canSubmit = numericAmount >= MIN_AMOUNT && !tooBig && requisites.trim().length >= 5 && !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      const res = await fetch('/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: numericAmount, method, requisites: requisites.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось создать заявку');

      toast.success(`Заявка на ${numericAmount.toLocaleString('ru-RU')} ₽ создана`);
      if (onCreated) onCreated(data);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-800 max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl space-y-5 my-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Вывод средств</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Доступно: <b className="text-slate-800 dark:text-slate-200">{balance.toLocaleString('ru-RU')} ₽</b>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="shrink-0 w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white font-bold transition"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Сумма, ₽ <span className="text-slate-400 font-normal">(минимум {MIN_AMOUNT})</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={MIN_AMOUNT}
                max={balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5000"
                className="flex-1 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-bold rounded-xl transition-all whitespace-nowrap"
              >
                Всё
              </button>
            </div>
            {tooSmall && <p className="text-[11px] text-red-500 mt-1">Минимальная сумма — {MIN_AMOUNT} ₽</p>}
            {tooBig && <p className="text-[11px] text-red-500 mt-1">Не больше доступного баланса</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Способ вывода</label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                    method === m.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span className="mr-1">{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {method === 'card' ? 'Номер карты' : 'Номер телефона'}
            </label>
            <input
              type="text"
              value={requisites}
              onChange={(e) => setRequisites(e.target.value)}
              placeholder={method === 'card' ? '4276 3800 1234 5678' : '+7 916 123-45-67'}
              className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {METHODS.find((m) => m.id === method)?.hint}. Реквизиты хранятся в зашифрованном виде.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
            Сумма будет зарезервирована сразу после подачи заявки и вернётся на баланс, если заявку отклонят.
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm shadow-md transition-all"
          >
            {loading ? 'Отправка...' : 'Создать заявку на вывод'}
          </button>
        </form>
      </div>
    </div>
  );
};
