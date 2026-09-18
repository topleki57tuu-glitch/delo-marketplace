import React, { useState } from 'react';
import { useToast } from './Toast';
import CityInput from './CityInput';
import { AvatarUploader } from './Avatar';
import { IconClose } from '../components/icons.jsx';

/**
 * Форма редактирования профиля
 */
export function ProfileEditForm({ user, token, onUpdateUser, onClose }) {
  const { addToast } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [city, setCity] = useState(user?.city ? { name: user.city } : null);
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: name.trim() || null,
          bio: bio.trim() || null,
          city: city?.name || null,
          phone: phone.trim() || null
        })
      });

      if (!res.ok) throw new Error('Не удалось сохранить изменения');

      addToast('Профиль обновлен!', 'success');
      onUpdateUser();
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-indigo-200 dark:border-indigo-800 shadow-lg space-y-4">
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">Редактирование профиля</h3>

      {/* Avatar Upload Section */}
      <div className="pb-4 border-b border-slate-200 dark:border-slate-700">
        <label className="block text-xs font-semibold text-slate-500 mb-3">Фото профиля</label>
        <AvatarUploader
          currentAvatar={user.avatar}
          onAvatarUpdate={onUpdateUser}
          token={token}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Имя</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ваше имя"
            className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Телефон</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 (999) 123-45-67"
            className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Город</label>
        <CityInput
          value={city ? (typeof city === 'object' ? city.name : city) : ''}
          onChange={(c) => setCity(c)}
          placeholder="Введите город (Москва, Казань, Сочи...)"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">О себе</label>
        <textarea
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Расскажите о себе, опыте работы, навыках..."
          className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-semibold"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition-colors"
        >
          {saving ? 'Сохранение...' : 'Сохранить изменения'}
        </button>
      </div>
    </form>
  );
}

/**
 * Карточка баланса с кнопками пополнения и вывода
 */
export function BalanceCard({ user, onDeposit, onWithdraw }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 flex flex-col justify-between">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Личный кошелек</span>
        <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
          {(user.balance || 0).toLocaleString('ru-RU')} ₽
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          Баланс используется для безопасных сделок (эскроу-депонирование) и мгновенных выплат.
        </p>
      </div>

      <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={onDeposit}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md shadow-emerald-600/20 transition-all"
          >
            + Пополнить
          </button>
          <button
            onClick={onWithdraw}
            disabled={(user.balance || 0) < 500}
            title={(user.balance || 0) < 500 ? 'Минимальная сумма вывода — 500 ₽' : 'Вывести средства'}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm shadow-md transition-all"
          >
            Вывести
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Модальное окно пополнения баланса
 */
export function DepositModal({ isOpen, onClose, token, onSuccess }) {
  const { addToast } = useToast();
  const [amount, setAmount] = useState('1000');
  const [depositing, setDepositing] = useState(false);
  const [provider, setProvider] = useState('yoomoney');

  const handleDeposit = async (e) => {
    e.preventDefault();
    const numAmount = parseInt(amount, 10);

    if (isNaN(numAmount) || numAmount < 100) {
      addToast('Минимальная сумма пополнения — 100 ₽', 'error');
      return;
    }

    setDepositing(true);
    try {
      const res = await fetch(`/payments/create?provider=${provider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount: numAmount })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось создать платеж');

      if (data.confirmation_url) {
        window.location.href = data.confirmation_url;
      } else {
        addToast('Платеж создан, но URL не получен', 'error');
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDepositing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 max-w-md w-full p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Пополнение баланса</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl font-bold"
            aria-label="Закрыть"
          >
            <IconClose />
          </button>
        </div>

        <form onSubmit={handleDeposit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Сумма пополнения</label>
            <input
              type="number"
              min="100"
              step="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="1000"
            />
            <p className="text-xs text-slate-400 mt-1">Минимум: 100 ₽</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">Способ оплаты</label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setProvider('yoomoney')}
                className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                  provider === 'yoomoney'
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-sm">ЮMoney</div>
                <div className="text-xs text-slate-500">Банковские карты, электронный кошелек</div>
              </button>

              <button
                type="button"
                onClick={() => setProvider('yookassa')}
                className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                  provider === 'yookassa'
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-sm">ЮKassa</div>
                <div className="text-xs text-slate-500">Банковские карты, СБП, рассрочка</div>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={depositing}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-colors"
          >
            {depositing ? 'Создание платежа...' : `Пополнить на ${parseInt(amount || 0).toLocaleString('ru-RU')} ₽`}
          </button>
        </form>
      </div>
    </div>
  );
}
