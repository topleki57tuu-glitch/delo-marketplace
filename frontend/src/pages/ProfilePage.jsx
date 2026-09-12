import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import CityInput from '../components/CityInput';
import { PortfolioUploader } from '../components/ImageUploader';
import { WithdrawModal } from '../components/WithdrawModal';

const TX_TYPE_NAMES = {
  deposit: '💰 Пополнение',
  escrow_hold: '🔒 Заморозка (эскроу)',
  escrow_release: '💸 Выплата (эскроу)',
  escrow_refund: '↩ Возврат (эскроу)',
  purchase: '🛒 Покупка пакета',
  withdraw_hold: '🏦 Вывод средств (заявка)',
  withdraw_refund: '↩ Возврат заявки на вывод',
};

const WITHDRAWAL_STATUS = {
  pending:   { label: 'Ожидает',   cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  paid:      { label: 'Выплачено', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected:  { label: 'Отклонено', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  cancelled: { label: 'Отменено',  cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

function Stat({ label, value, sub }) {
  return (
    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

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

  // Verification request modal & state
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verificationData, setVerificationData] = useState(null);
  const [loadingVerification, setLoadingVerification] = useState(false);
  const [verFullName, setVerFullName] = useState(user?.name || '');
  const [verDocType, setVerDocType] = useState('passport');
  const [verDocNumber, setVerDocNumber] = useState('');
  const [submittingVer, setSubmittingVer] = useState(false);

  // Admin moderation tab/state (if admin)
  const isAdmin = user?.email && (user.email.toLowerCase() === 'admin@delo.ru' || user.email.toLowerCase().includes('admin'));
  const [adminVerifications, setAdminVerifications] = useState([]);
  const [showAdminVerifications, setShowAdminVerifications] = useState(false);
  const [processingAdminId, setProcessingAdminId] = useState(null);

  // Transactions history
  const [transactions, setTransactions] = useState([]);
  const [showTransactions, setShowTransactions] = useState(false);
  const [loadingTx, setLoadingTx] = useState(false);

  // Вывод средств
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawals, setWithdrawals] = useState([]);
  const [showWithdrawals, setShowWithdrawals] = useState(false);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);

  // Админ: заявки на вывод и сводка по платформе
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [showAdminWithdrawals, setShowAdminWithdrawals] = useState(false);
  const [processingWdId, setProcessingWdId] = useState(null);
  const [adminStats, setAdminStats] = useState(null);
  const [showAdminStats, setShowAdminStats] = useState(false);

  const loadWithdrawals = () => {
    if (!token) return;
    setLoadingWithdrawals(true);
    fetch('/wallet/withdrawals', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setWithdrawals(Array.isArray(data) ? data : []))
      .catch(() => setWithdrawals([]))
      .finally(() => setLoadingWithdrawals(false));
  };

  const loadAdminWithdrawals = () => {
    if (!token || !isAdmin) return;
    fetch('/admin/withdrawals', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAdminWithdrawals(Array.isArray(data) ? data : []))
      .catch(() => setAdminWithdrawals([]));
  };

  const loadAdminStats = () => {
    if (!token || !isAdmin) return;
    fetch('/admin/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAdminStats(data))
      .catch(() => setAdminStats(null));
  };

  const handleAdminWithdrawalReview = async (id, action) => {
    setProcessingWdId(id);
    try {
      const res = await fetch(`/admin/withdrawals/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось обработать заявку');
      addToast(action === 'approve' ? 'Заявка одобрена' : 'Заявка отклонена, деньги возвращены', 'success');
      loadAdminWithdrawals();
      loadAdminStats();
      if (onUpdateUser) onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setProcessingWdId(null);
    }
  };

  useEffect(() => {
    if (showWithdrawals && token) loadWithdrawals();
  }, [showWithdrawals, token]);

  useEffect(() => {
    if (showAdminWithdrawals && isAdmin) loadAdminWithdrawals();
  }, [showAdminWithdrawals, isAdmin]);

  useEffect(() => {
    if (showAdminStats && isAdmin) loadAdminStats();
  }, [showAdminStats, isAdmin]);

  useEffect(() => {
    if (user && token) {
      loadVerificationStatus();
    }
  }, [user, token]);

  const loadVerificationStatus = () => {
    if (!token) return;
    setLoadingVerification(true);
    fetch('/verification/status', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setVerificationData(data);
      })
      .catch(() => {})
      .finally(() => setLoadingVerification(false));
  };

  const loadAdminVerifications = () => {
    if (!token || !isAdmin) return;
    fetch('/verification/admin/list', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then(setAdminVerifications)
      .catch(() => setAdminVerifications([]));
  };

  useEffect(() => {
    if (showAdminVerifications && isAdmin) {
      loadAdminVerifications();
    }
  }, [showAdminVerifications, isAdmin]);

  useEffect(() => {
    if (user && token && showTransactions) {
      setLoadingTx(true);
      fetch('/wallet/transactions', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : []))
        .then(setTransactions)
        .catch(() => setTransactions([]))
        .finally(() => setLoadingTx(false));
    }
  }, [user, token, showTransactions]);

  const handleDownloadCsv = async () => {
    try {
      const res = await fetch('/wallet/transactions.csv', {
        headers: { Authorization: `Bearer ${token}` },
      });
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

  // Portfolio
  const parsePortfolio = () => {
    try { return user?.portfolio ? JSON.parse(user.portfolio) : []; } catch (e) { return []; }
  };

  const savePortfolio = async (items) => {
    try {
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ portfolio: JSON.stringify(items) }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить портфолио');
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handlePortfolioAdd = async (url) => {
    await savePortfolio([...parsePortfolio(), url]);
    addToast('Работа добавлена в портфолио', 'success');
  };

  const handlePortfolioDelete = async (idx) => {
    const items = parsePortfolio().filter((_, i) => i !== idx);
    await savePortfolio(items);
    addToast('Работа удалена из портфолио', 'success');
  };

  const handleVerificationSubmit = async (e) => {
    e.preventDefault();
    if (!verFullName.trim()) {
      addToast('Укажите ФИО полностью', 'error');
      return;
    }
    setSubmittingVer(true);
    try {
      const res = await fetch('/verification/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          full_name: verFullName.trim(),
          document_type: verDocType,
          document_number: verDocNumber.trim() || null,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка отправки заявки');

      addToast('Заявка на верификацию успешно отправлена!', 'success');
      setShowVerifyModal(false);
      loadVerificationStatus();
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmittingVer(false);
    }
  };

  const handleAdminReview = async (requestId, action, reason = '') => {
    setProcessingAdminId(requestId);
    try {
      const res = await fetch(`/verification/admin/${requestId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action, reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка рассмотрения');

      addToast(action === 'approve' ? 'Специалист успешно верифицирован!' : 'Заявка отклонена', 'success');
      loadAdminVerifications();
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setProcessingAdminId(null);
    }
  };

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
          city: city ? (typeof city === 'object' ? city.name : city) : null,
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
  const reqStatus = verificationData?.request?.status;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-8 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-extrabold text-3xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
            </div>
            {user.verified && (
              <span className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1 rounded-full shadow-md text-xs font-bold" title="Документы проверены">
                ✓
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {user.name || 'Пользователь'}
              </h1>
              {user.verified && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-1 border border-emerald-300 dark:border-emerald-700">
                  <span>✓</span> Проверен
                </span>
              )}
              {user.is_pro && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 shadow-sm">
                  PRO
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
              <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 font-medium">
                {isSpecialist ? '🛠️ Специалист' : '💼 Заказчик'}
              </span>
              <span>⭐ Рейтинг: {user.rating || '5.0'}</span>
              <span>•</span>
              <span>Завершено: {user.completed_tasks || 0}</span>
              {user.city && (
                <>
                  <span>•</span>
                  <span>📍 {user.city}</span>
                </>
              )}
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

      {/* Trust & Verification Status Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-6 sm:p-7 rounded-3xl shadow-md border border-indigo-900/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            <h2 className="text-lg font-bold text-white">Безопасность и доверие сервиса «ДЕЛО»</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {user.verified
              ? 'Ваша личность подтверждена. Все ваши сделки защищены сервисом безопасных платежей (эскроу). В каталоге ваши отклики отображаются выше.'
              : reqStatus === 'pending'
              ? 'Ваша заявка на верификацию находится на рассмотрении у модератора. Обычно проверка занимает до 2 часов.'
              : reqStatus === 'rejected'
              ? `Предыдущая заявка была отклонена: «${verificationData?.request?.rejection_reason || 'уточните данные'}». Подайте заявку повторно.`
              : 'Пройдите быструю верификацию (паспорт или статус самозанятого), чтобы получить зелёный бейдж доверия, поднять анкету в топе поиска и получать крупные заказы с гарантией выплаты.'}
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-3">
          {user.verified ? (
            <div className="px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center gap-2">
              <span>✓</span> Документы подтверждены
            </div>
          ) : reqStatus === 'pending' ? (
            <div className="px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-2">
              <span className="animate-spin">⏳</span> На проверке
            </div>
          ) : (
            <button
              onClick={() => setShowVerifyModal(true)}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
            >
              <span>🛡️</span> Пройти верификацию
            </button>
          )}

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowAdminVerifications(!showAdminVerifications)}
                className="px-4 py-2 bg-indigo-800/80 hover:bg-indigo-700 text-indigo-100 text-xs font-semibold rounded-xl border border-indigo-600 transition-all"
              >
              👑 Модерация заявок
            </button>
              <button
                onClick={() => setShowAdminWithdrawals(!showAdminWithdrawals)}
                className="px-4 py-2 bg-indigo-800/80 hover:bg-indigo-700 text-indigo-100 text-xs font-semibold rounded-xl border border-indigo-600 transition-all"
              >
                🏦 Заявки на вывод
              </button>
              <button
                onClick={() => setShowAdminStats(!showAdminStats)}
                className="px-4 py-2 bg-indigo-800/80 hover:bg-indigo-700 text-indigo-100 text-xs font-semibold rounded-xl border border-indigo-600 transition-all"
              >
                📊 Сводка
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Admin Verification Management Center */}
      {isAdmin && showAdminVerifications && (
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-amber-300 dark:border-amber-700/60 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>👑</span> Панель модератора: Заявки на верификацию
            </h3>
            <button
              onClick={loadAdminVerifications}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              🔄 Обновить
            </button>
          </div>

          {adminVerifications.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Заявок на проверку пока нет.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {adminVerifications.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">{item.full_name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                        item.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {item.status === 'approved' ? 'Одобрено' : item.status === 'rejected' ? 'Отклонено' : 'Ожидает'}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      ID: {item.user_id} • Email: {item.user_email} • Тип: {item.document_type === 'passport' ? 'Паспорт РФ' : 'Самозанятый / ИНН'}
                    </div>
                    {item.document_number && (
                      <div className="font-mono text-slate-700 dark:text-slate-300">
                        Номер документа: {item.document_number}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400">
                      Подано: {(item.created_at || '').slice(0, 16).replace('T', ' ')}
                    </div>
                  </div>

                  {item.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleAdminReview(item.id, 'approve')}
                        disabled={processingAdminId === item.id}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                      >
                        ✓ Одобрить
                      </button>
                      <button
                        onClick={() => {
                          const reason = prompt('Укажите причину отклонения:', 'Нечеткое фото или неверные реквизиты');
                          if (reason !== null) handleAdminReview(item.id, 'reject', reason);
                        }}
                        disabled={processingAdminId === item.id}
                        className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                      >
                        ✕ Отклонить
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin: заявки на вывод средств */}
      {isAdmin && showAdminWithdrawals && (
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-indigo-200 dark:border-indigo-800 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>🏦</span> Панель модератора: Заявки на вывод
            </h3>
            <button onClick={loadAdminWithdrawals} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              🔄 Обновить
            </button>
          </div>

          {adminWithdrawals.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">Заявок на вывод пока нет.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {adminWithdrawals.map((w) => {
                const meta = WITHDRAWAL_STATUS[w.status] || { label: w.status, cls: 'bg-slate-200 text-slate-600' };
                return (
                  <div key={w.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {w.amount.toLocaleString('ru-RU')} ₽
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="text-slate-500">
                        {w.user_name} ({w.user_email}) · баланс: {(w.user_balance || 0).toLocaleString('ru-RU')} ₽
                      </div>
                      <div className="font-mono text-slate-700 dark:text-slate-300">
                        {w.method === 'card' ? '💳' : '📱'} {w.requisites}
                      </div>
                      {w.comment && <div className="text-[10px] text-slate-400">{w.comment}</div>}
                    </div>

                    {w.status === 'pending' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleAdminWithdrawalReview(w.id, 'approve')}
                          disabled={processingWdId === w.id}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                        >
                          ✓ Выплачено
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt('Причина отклонения:', 'Реквизиты не прошли проверку');
                            if (reason !== null) handleAdminWithdrawalReview(w.id, 'reject');
                          }}
                          disabled={processingWdId === w.id}
                          className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                        >
                          ✕ Отклонить
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Admin: сводка по платформе */}
      {isAdmin && showAdminStats && adminStats && (
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-indigo-200 dark:border-indigo-800 shadow-lg space-y-5">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>📊</span> Сводка по платформе
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Пользователей" value={adminStats.users.total} sub={`+${adminStats.users.new_7d} за неделю`} />
            <Stat label="Заказов" value={adminStats.tasks.total} sub={`+${adminStats.tasks.new_7d} за неделю`} />
            <Stat label="Оборот" value={`${adminStats.money.gmv.toLocaleString('ru-RU')} ₽`} sub="завершённые сделки" />
            <Stat label="Комиссия" value={`${adminStats.money.commission_earned.toLocaleString('ru-RU')} ₽`} sub="заработано" />
            <Stat label="В эскроу" value={`${adminStats.money.escrow_held.toLocaleString('ru-RU')} ₽`} sub="заморожено по сделкам" />
            <Stat label="На балансах" value={`${adminStats.money.user_balances.toLocaleString('ru-RU')} ₽`} sub="обязательства" />
            <Stat label="Заявок на вывод" value={adminStats.queues.withdrawals_pending} sub={`${adminStats.money.withdrawals_pending_amount.toLocaleString('ru-RU')} ₽ в очереди`} />
            <Stat label="Споров открыто" value={adminStats.queues.disputes_open} sub={`верификаций: ${adminStats.queues.verifications_pending}`} />
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs">
            <span className="text-slate-500">Всего должны пользователям: </span>
            <b className="text-slate-900 dark:text-white">
              {adminStats.money.total_liabilities.toLocaleString('ru-RU')} ₽
            </b>
            <span className="text-slate-400"> — эскроу + балансы + очереди на вывод. Сверяйте с фактическим счётом.</span>
          </div>
        </div>
      )}

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
            <label className="block text-xs font-semibold text-slate-500 mb-1">Город (любой населенный пункт России)</label>
            <CityInput value={city ? (typeof city === 'object' ? city.name : city) : ''} onChange={(c) => setCity(c)} placeholder="Введите любой город РФ (Москва, Казань, Сочи, Анапа...)" />
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
              Баланс используется для безопасных сделок (эскроу-депонирование) и мгновенных выплат.
            </p>
          </div>
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => setShowDepositModal(true)}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md shadow-emerald-600/20 transition-all"
              >
                + Пополнить
              </button>
              <button
                onClick={() => setShowWithdrawModal(true)}
                disabled={(user.balance || 0) < 500}
                title={(user.balance || 0) < 500 ? 'Минимальная сумма вывода — 500 ₽' : 'Вывести средства'}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm shadow-md shadow-indigo-600/20 transition-all"
              >
                🏦 Вывести
              </button>
            </div>
            <Link
              to="/my-tasks"
              className="block text-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline pt-1"
            >
              Мои заказы →
            </Link>
          </div>
        </div>

        {/* Responses / PRO Card (for Specialist) */}
        {isSpecialist ? (
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Монетизация и статус</span>
                {user.is_pro && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                    0% комиссия платформы
                  </span>
                )}
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                {user.is_pro ? 'PRO-аккаунт (0% комиссия)' : `${user.response_credits || 0} откликов`}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {user.is_pro
                  ? `Подписка активна до ${user.pro_until ? user.pro_until.slice(0, 10) : 'конца периода'}. Вы получаете 100% выплаты по заказам без комиссии платформы.`
                  : 'Стандартная комиссия безопасной сделки: 5%. С подпиской PRO комиссия 0% и безлимитные отклики.'}
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
                PRO на месяц (590 ₽)
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Безопасная сделка</span>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">100% гарантия сохранности</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              При назначении специалиста средства депонируются на эскроу-счете заказа. Исполнитель получает деньги только после того, как вы лично подтвердите выполнение задачи или через арбитраж.
            </p>
          </div>
        )}
      </div>

      {/* Monetization Showcase for Specialists */}
      {isSpecialist && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-slate-800 dark:to-slate-800/60 p-6 sm:p-8 rounded-3xl border border-indigo-100 dark:border-slate-700 shadow-sm space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>🚀</span> Выгодная монетизация для специалистов
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
              Сравните условия работы: окупите подписку PRO уже с первого заказа благодаря отсутствию 5% комиссии!
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <span className="text-xs font-bold uppercase text-slate-400">Пакет откликов</span>
              <div className="text-xl font-black text-slate-900 dark:text-white">10 откликов</div>
              <p className="text-xs text-slate-500">19 ₽ за отклик. Базовый старт для начинающих специалистов.</p>
              <div className="text-lg font-bold text-indigo-600">190 ₽</div>
              <button
                onClick={() => handleBuyPackage('resp_10')}
                disabled={buyingPackage === 'resp_10'}
                className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-bold rounded-xl transition-all"
              >
                Купить пакет
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border-2 border-indigo-500 shadow-md space-y-3 relative overflow-hidden">
              <div className="absolute top-2 right-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                Популярный
              </div>
              <span className="text-xs font-bold uppercase text-indigo-500">PRO Месяц</span>
              <div className="text-xl font-black text-slate-900 dark:text-white">0% комиссия + Безлимит</div>
              <p className="text-xs text-slate-500">Экономия до 5 000 ₽ на комиссии эскроу при выполнении заказов.</p>
              <div className="text-lg font-bold text-indigo-600">590 ₽ / мес.</div>
              <button
                onClick={() => handleBuyPackage('pro_1')}
                disabled={buyingPackage === 'pro_1'}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md transition-all"
              >
                Подключить PRO
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-amber-300 dark:border-amber-700 space-y-3">
              <span className="text-xs font-bold uppercase text-amber-500">PRO на 3 месяца</span>
              <div className="text-xl font-black text-slate-900 dark:text-white">Максимальная выгода</div>
              <p className="text-xs text-slate-500">90 дней без комиссии и с приоритетом в откликах заказчикам.</p>
              <div className="text-lg font-bold text-amber-600">1 490 ₽</div>
              <button
                onClick={() => handleBuyPackage('pro_3')}
                disabled={buyingPackage === 'pro_3'}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-md transition-all"
              >
                Купить на 3 мес.
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portfolio (specialist only) */}
      {isSpecialist && (
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <PortfolioUploader
            token={token}
            portfolio={parsePortfolio()}
            onUploadSuccess={handlePortfolioAdd}
            onDelete={handlePortfolioDelete}
          />
        </div>
      )}

      {/* Transactions history */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">История операций</h3>
            <p className="text-xs text-slate-400">Все движения средств, эскроу-депонирование и покупки</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadCsv}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-bold rounded-xl transition-all"
            >
              ⬇ Скачать CSV
            </button>
            <button
              onClick={() => setShowTransactions(!showTransactions)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all"
            >
              {showTransactions ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </div>

        {showTransactions && (
          loadingTx ? (
            <div className="flex justify-center py-6">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Операций пока не было.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {TX_TYPE_NAMES[tx.type] || tx.type}
                    </span>
                    {tx.task_title && (
                      <span className="block text-xs text-slate-400 truncate">{tx.task_title}</span>
                    )}
                    {tx.fee > 0 && (
                      <span className="block text-[11px] text-amber-500">Комиссия сервиса 5%: -{tx.fee} ₽</span>
                    )}
                    <span className="block text-[10px] text-slate-400">
                      {(tx.created_at || '').slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <span
                    className={`font-extrabold shrink-0 ${
                      tx.amount >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Заявки на вывод средств */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Вывод средств</h3>
            <p className="text-xs text-slate-400">Заявки на выплату заработанного на карту или по СБП</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowWithdrawals(!showWithdrawals)}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-bold rounded-xl transition-all"
            >
              {showWithdrawals ? 'Скрыть' : 'Показать'}
            </button>
            <button
              onClick={() => setShowWithdrawModal(true)}
              disabled={(user.balance || 0) < 500}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all"
            >
              🏦 Новая заявка
            </button>
          </div>
        </div>

        {showWithdrawals && (
          loadingWithdrawals ? (
            <div className="flex justify-center py-6">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : withdrawals.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              Заявок на вывод пока не было.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {withdrawals.map((w) => {
                const meta = WITHDRAWAL_STATUS[w.status] || { label: w.status, cls: 'bg-slate-200 text-slate-600' };
                return (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {w.amount.toLocaleString('ru-RU')} ₽
                        <span className="text-slate-400 font-normal"> · {w.method === 'card' ? '💳 карта' : '📱 СБП'} {w.requisites}</span>
                      </span>
                      {w.comment && (
                        <span className="block text-[11px] text-slate-400">{w.comment}</span>
                      )}
                      <span className="block text-[10px] text-slate-400">
                        {(w.created_at || '').slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Verification Request Modal */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>🛡️</span> Верификация специалиста
              </h3>
              <button
                onClick={() => setShowVerifyModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Подтверждение личности повышает доверие заказчиков на 85% и даёт специальный знак отличия в анкете.
            </p>

            <form onSubmit={handleVerificationSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">ФИО (по паспорту)</label>
                <input
                  type="text"
                  value={verFullName}
                  onChange={(e) => setVerFullName(e.target.value)}
                  placeholder="Иванов Иван Иванович"
                  required
                  className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Тип подтверждения</label>
                <select
                  value={verDocType}
                  onChange={(e) => setVerDocType(e.target.value)}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
                >
                  <option value="passport">Паспорт гражданина РФ</option>
                  <option value="inn_self_employed">ИНН / Справка о самозанятости</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {verDocType === 'passport' ? 'Серия и номер паспорта' : 'Номер ИНН (12 цифр)'}
                </label>
                <input
                  type="text"
                  value={verDocNumber}
                  onChange={(e) => setVerDocNumber(e.target.value)}
                  placeholder={verDocType === 'passport' ? '4515 123456' : '770123456789'}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
                />
              </div>

              <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300">
                🔒 Данные защищены и обрабатываются в строгом соответствии с 152-ФЗ.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVerifyModal(false)}
                  className="px-4 py-2 text-sm text-slate-500"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submittingVer}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md"
                >
                  {submittingVer ? 'Отправка...' : 'Отправить на проверку'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <WithdrawModal
          balance={user.balance || 0}
          onClose={() => setShowWithdrawModal(false)}
          onCreated={() => {
            loadWithdrawals();
            if (onUpdateUser) onUpdateUser();
          }}
        />
      )}
    </div>
  );
}
