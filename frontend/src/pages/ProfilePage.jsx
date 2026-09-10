import React, { useState } from 'react';
import { useToast } from '../components/Toast';
import CityInput from '../components/CityInput';

export default function ProfilePage({ user, token, onUpdateUser, onLogout, onOpenAuth }) {
  const { addToast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [city, setCity] = useState(user?.city ? { name: user.city } : null);
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);

  // Wallet top up modal
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('1000');
  const [depositing, setDepositing] = useState(false);

  // Monetization buy
  const [buyingPackage, setBuyingPackage] = useState(null);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-4xl">👤</div>
          <h2 className="text-xl font-bold">Войдите в профиль</h2>
          <button
            onClick={() => onOpenAuth('login')}
            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl"
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim() || null,
          bio: bio.trim() || null,
          city: city ? city.name : null,
          phone: phone.trim() || null,
        }),
      });

      if (!res.ok) throw new Error('Не удалось обновить профиль');

      addToast('Профиль успешно обновлен', 'success');
      setIsEditing(false);
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchRole = async () => {
    try {
      const res = await fetch('/users/me/switch-role', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось переключить роль');

      addToast(`Роль изменена на: ${data.role === 'specialist' ? 'Специалист' : 'Заказчик'}`, 'success');
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    const amt = parseInt(depositAmount, 10);
    if (!amt || amt <= 0) {
      addToast('Введите корректную сумму', 'error');
      return;
    }

    setDepositing(true);
    try {
      const res = await fetch('/wallet/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка пополнения');

      addToast(`Баланс пополнен на ${amt} ₽`, 'success');
      setShowDepositModal(false);
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDepositing(false);
    }
  };

  const handleBuyPackage = async (packageId) => {
    setBuyingPackage(packageId);
    try {
      const res = await fetch('/monetization/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ package_id: packageId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось приобрести пакет');

      addToast(data.message || 'Пакет успешно активирован!', 'success');
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBuyingPackage(null);
    }
  };

  const isSpecialist = user.role === 'specialist';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-extrabold text-3xl flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {user.name || 'Пользователь'}
              </h1>
              {user.is_pro && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">
                  PRO
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
            <div className="flex items-center gap-3 text-xs pt-1">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 font-medium">
                {isSpecialist ? '🛠️ Специалист' : '💼 Заказчик'}
              </span>
              <span>⭐ Рейтинг: {user.rating || '5.0'}</span>
              <span>•</span>
              <span>Завершено: {user.completed_tasks || 0}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <button
            onClick={handleSwitchRole}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs sm:text-sm font-semibold rounded-xl transition-all"
          >
            Переключить на {isSpecialist ? 'Заказчика' : 'Специалиста'}
          </button>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md transition-all"
          >
            {isEditing ? 'Закрыть редактор' : 'Редактировать профиль'}
          </button>
          <button
            onClick={onLogout}
            className="px-4 py-2.5 text-xs sm:text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
          >
            Выйти
          </button>
        </div>
      </div>

      {/* Edit Profile Form */}
      {isEditing && (
        <form onSubmit={handleSaveProfile} className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-indigo-200 dark:border-indigo-800 shadow-lg space-y-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Редактирование профиля</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Имя</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Телефон</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Город</label>
            <CityInput selectedCity={city} onSelectCity={(c) => setCity(c)} placeholder="Ваш город" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">О себе</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 text-sm text-slate-500"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-md"
            >
              {saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </form>
      )}

      {/* Wallet & Balance Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Balance Card */}
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Личный кошелек</span>
            <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
              {(user.balance || 0).toLocaleString('ru-RU')} ₽
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Баланс используется для безопасных сделок (эскроу) и покупки пакетов откликов.
            </p>
          </div>
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => setShowDepositModal(true)}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md shadow-emerald-600/20 transition-all"
            >
              + Пополнить баланс
            </button>
          </div>
        </div>

        {/* Responses / PRO Card (for Specialist) */}
        {isSpecialist ? (
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Статус откликов</span>
              <div className="text-2xl sm:text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                {user.is_pro ? 'Безлимит (PRO)' : `${user.response_credits || 0} откликов`}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {user.is_pro
                  ? `PRO-статус активен до ${user.pro_until ? user.pro_until.slice(0, 10) : 'конца периода'}.`
                  : 'С каждого отклика на задание списывается 1 кредит.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-4 border-t border-slate-100 dark:border-slate-700">
              <button
                onClick={() => handleBuyPackage('resp_10')}
                disabled={buyingPackage === 'resp_10'}
                className="py-2.5 px-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-bold rounded-xl transition-all text-center"
              >
                +10 откликов (190 ₽)
              </button>
              <button
                onClick={() => handleBuyPackage('pro_1')}
                disabled={buyingPackage === 'pro_1'}
                className="py-2.5 px-3 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all text-center"
              >
                PRO на 1 мес. (590 ₽)
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Безопасная сделка</span>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">Гарантия выполнения</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              При назначении специалиста средства резервируются на балансе заказа и перечисляются исполнителю только после того, как вы подтвердите успешный результат.
            </p>
          </div>
        )}
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Пополнение баланса</h3>
            <form onSubmit={handleDeposit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Сумма в рублях (₽)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-bold outline-none"
                  required
                />
              </div>

              <div className="flex gap-2">
                {[500, 1000, 3000, 5000].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDepositAmount(String(val))}
                    className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
                  >
                    +{val} ₽
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDepositModal(false)}
                  className="px-4 py-2 text-sm text-slate-500"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={depositing}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md"
                >
                  {depositing ? 'Обработка...' : 'Пополнить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
