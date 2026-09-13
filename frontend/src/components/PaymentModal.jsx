import React, { useState } from 'react';
import { useToast } from './Toast';

/**
 * Модальное окно для пополнения через ЮMoney
 */
export function PaymentModal({ onClose, onSuccess, token }) {
  const { addToast } = useToast();
  const [amount, setAmount] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentData, setPaymentData] = useState(null);

  const handleCreatePayment = async (e) => {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) {
      addToast('Введите корректную сумму', 'error');
      return;
    }

    if (amt < 100) {
      addToast('Минимальная сумма пополнения: 100 ₽', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/payments/create?provider=yoomoney', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount: amt })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Не удалось создать платеж');
      }

      // Сохраняем данные платежа
      setPaymentData({
        payment_id: data.payment_id,
        confirmation_url: data.confirmation_url,
        amount: amt
      });

      // Открываем форму оплаты ЮMoney в новом окне
      window.open(data.confirmation_url, '_blank');

      addToast('Перейдите в открывшееся окно для оплаты', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckPayment = async () => {
    if (!paymentData) return;

    setCheckingPayment(true);
    try {
      const res = await fetch(`/payments/confirm?payment_id=${paymentData.payment_id}&provider=yoomoney`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Не удалось проверить платеж');
      }

      if (data.credited) {
        addToast(`Баланс пополнен на ${paymentData.amount} ₽!`, 'success');
        onSuccess();
        onClose();
      } else {
        addToast('Платеж еще не завершен. Попробуйте через несколько секунд.', 'info');
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCheckingPayment(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Пополнение баланса</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        {!paymentData ? (
          <form onSubmit={handleCreatePayment} className="space-y-4">
            <div className="bg-indigo-50 dark:bg-indigo-950/30 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 text-sm space-y-2">
              <div className="flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300">
                <span>💳</span> Оплата через ЮMoney
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Принимаем банковские карты, ЮMoney кошельки и другие способы оплаты
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Сумма пополнения (₽)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="100"
                step="1"
                className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                required
              />
              <p className="text-xs text-slate-400 mt-1">Минимум 100 ₽</p>
            </div>

            <div className="flex gap-2">
              {[100, 500, 1000, 3000, 5000].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(String(val))}
                  className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-xs font-semibold transition-colors"
                >
                  {val} ₽
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all"
              >
                {loading ? 'Создание платежа...' : 'Перейти к оплате'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                <span>✓</span> Платеж создан
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Сумма: <span className="font-bold">{paymentData.amount} ₽</span>
              </p>
              <p className="text-xs text-slate-500">
                ID платежа: {paymentData.payment_id}
              </p>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-xl border border-amber-200 dark:border-amber-800 text-sm space-y-2">
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                Инструкция:
              </p>
              <ol className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-decimal list-inside">
                <li>Завершите оплату в открывшемся окне ЮMoney</li>
                <li>После успешной оплаты вернитесь сюда</li>
                <li>Нажмите "Проверить статус платежа"</li>
              </ol>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleCheckPayment}
                disabled={checkingPayment}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all"
              >
                {checkingPayment ? 'Проверка...' : '✓ Проверить статус платежа'}
              </button>

              <button
                onClick={() => window.open(paymentData.confirmation_url, '_blank')}
                className="w-full py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-sm transition-colors"
              >
                🔗 Открыть форму оплаты снова
              </button>

              <button
                onClick={onClose}
                className="w-full py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
