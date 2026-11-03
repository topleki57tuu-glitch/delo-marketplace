// Личный кабинет: шапка с балансом и вкладки «Профиль», «Кошелёк»,
// «Отклики и PRO» (у специалиста), «Настройки» и «Модерация» (у модератора).
// Сами вкладки — в pages/profile/, здесь — выбор вкладки, общие окна
// (пополнение, вывод, проверка личности) и состояние, которое должно
// переживать переключение вкладок.
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { WithdrawModal } from '../components/WithdrawModal';
import { PaymentModal } from '../components/PaymentModal';
import PageHero, { HeroAvatar, HeroTabs, PageBody } from '../components/PageHero.jsx';
import { AuthRequired } from '../components/PageState.jsx';
import { countLabel } from '../utils/format.js';
import {
  IconAdmin,
  IconBank,
  IconBriefcase,
  IconCheck,
  IconPin,
  IconPlus,
  IconRocket,
  IconSettings,
  IconStar,
  IconUser,
  IconWallet,
} from '../components/icons.jsx';
import AdminTab from './profile/AdminTab.jsx';
import ProfileTab from './profile/ProfileTab.jsx';
import ProTab from './profile/ProTab.jsx';
import SettingsTab from './profile/SettingsTab.jsx';
import WalletTab from './profile/WalletTab.jsx';
import { usePasswordForm, usePendingPayments, useProfileForm } from './profile/profileHooks.js';
import { VerifyDialog, rub } from './profile/profileShared.jsx';
import { apiErrorMessage } from '../utils/apiError';

export default function ProfilePage({ user, token, onUpdateUser, onLogout, onOpenAuth }) {
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const profileForm = useProfileForm({ user, token, onUpdateUser });
  const passwordForm = usePasswordForm({ token });
  const { checkingPayments, checkPendingPayments } = usePendingPayments({ token, onUpdateUser });

  const navigate = useNavigate();
  const [showDepositModal, setShowDepositModal] = useState(false);
  // Пополнение «по делу»: со страницы задания, когда не хватило денег на
  // безопасную сделку, приходят ?topup=<сумма>&return=/tasks/<id>. Окно
  // открывается с этой суммой, а после зачисления возвращает к заданию.
  const [depositPreset, setDepositPreset] = useState(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  // Растёт, когда создана заявка на вывод: по нему вкладка «Кошелёк»
  // перечитывает список заявок (окно вывода открывается и из шапки).
  const [withdrawalsVersion, setWithdrawalsVersion] = useState(0);

  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verificationData, setVerificationData] = useState(null);

  // Признак модератора берём с бэкенда: раньше он вычислялся по email
  // с подстрокой «admin», и панель с очередью выплат раскрывалась перед
  // admin-vasya@x.com — хотя запросы к данным сервер всё равно отклонял.
  const isAdmin = !!user?.is_admin;

  const isSpecialist = user?.role === 'specialist';

  // Разделы кабинета — вкладки в шапке. Выбранная хранится в адресе
  // (?tab=wallet), чтобы на неё можно было сослаться и вернуться «назад».
  const tabIds = ['profile', 'wallet', ...(isSpecialist ? ['pro'] : []), 'settings', ...(isAdmin ? ['admin'] : [])];
  const requestedTab = searchParams.get('tab') || (searchParams.get('payment') === 'return' ? 'wallet' : 'profile');
  const tab = tabIds.includes(requestedTab) ? requestedTab : 'profile';
  const setTab = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'profile') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  const topupParam = searchParams.get('topup');
  useEffect(() => {
    if (!user || topupParam === null) return;
    const amount = Math.min(Math.max(parseInt(topupParam, 10) || 0, 100), 1000000);
    const back = searchParams.get('return');
    // Только свой адрес: «//evil.example» браузер понял бы как чужой сайт.
    const safeBack = back && back.startsWith('/') && !back.startsWith('//') && !back.startsWith('/\\') ? back : null;
    setDepositPreset({ amount, returnTo: safeBack });
    setShowDepositModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete('topup');
    next.delete('return');
    setSearchParams(next, { replace: true });
  }, [user?.id, topupParam]);

  const closeDepositModal = () => {
    setShowDepositModal(false);
    setDepositPreset(null);
  };

  const handleDepositSuccess = () => {
    if (onUpdateUser) onUpdateUser();
    if (depositPreset?.returnTo) navigate(depositPreset.returnTo);
  };

  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const loadVerificationStatus = () => {
    if (!token) return;
    fetch('/verification/status', { headers: auth })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setVerificationData(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (user && token) loadVerificationStatus();
  }, [user?.id, token]);

  const handleVerificationSubmit = async ({ fullName, docType, docNumber }) => {
    if (!fullName.trim()) {
      addToast('Укажите ФИО полностью', 'error');
      return;
    }
    try {
      const res = await fetch('/verification/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          full_name: fullName.trim(),
          document_type: docType,
          document_number: docNumber.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Ошибка отправки заявки'));

      addToast('Заявка на проверку отправлена', 'success');
      setShowVerifyModal(false);
      loadVerificationStatus();
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!user) {
    return (
      <>
        <PageHero width="medium" size="sm" eyebrow="Личный кабинет" icon={IconUser} title="Профиль" />
        <PageBody width="medium">
          <AuthRequired
            onOpenAuth={onOpenAuth}
            title="Войдите в профиль"
            text="В профиле — ваши данные, кошелёк, история операций и настройки безопасности."
          />
        </PageBody>
      </>
    );
  }

  const balance = user.balance || 0;

  const tabs = [
    { id: 'profile', label: 'Профиль', icon: IconUser },
    { id: 'wallet', label: 'Кошелёк', icon: IconWallet },
    ...(isSpecialist ? [{ id: 'pro', label: 'Отклики и PRO', icon: IconRocket }] : []),
    { id: 'settings', label: 'Настройки', icon: IconSettings },
    ...(isAdmin ? [{ id: 'admin', label: 'Модерация', icon: IconAdmin }] : []),
  ];

  const canWithdraw = balance >= 500;
  const withdrawHint = canWithdraw ? 'Вывести средства' : 'Минимальная сумма вывода — 500 ₽';

  return (
    <>
      <PageHero
        width="medium"
        media={<HeroAvatar src={user.avatar} name={user.name} fallback={user.email} verified={!!user.verified} />}
        eyebrow={isSpecialist ? 'Кабинет специалиста' : 'Кабинет заказчика'}
        icon={isSpecialist ? IconBriefcase : IconUser}
        title={user.name || 'Пользователь'}
        titleClassName="hero-title-sm"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            {user.is_pro && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">
                PRO
              </span>
            )}
            {user.verified && (
              <span className="inline-flex items-center gap-1 font-semibold text-sky-300">
                <IconCheck size={14} /> Проверен
              </span>
            )}
            <span className="min-w-0 break-all">{user.email}</span>
            {user.city && (
              <span className="inline-flex items-center gap-1">
                <IconPin size={14} /> {user.city}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <IconStar size={14} fill="currentColor" className="text-amber-300" />
              {user.rating ? Number(user.rating).toFixed(1) : 'Пока без оценок'}
            </span>
            <span>{countLabel(user.completed_tasks || 0, 'завершённая сделка', 'завершённые сделки', 'завершённых сделок')}</span>
          </div>
        }
        aside={
          <div className="hero-stat !p-4 lg:w-80">
            <div className="flex items-baseline justify-between gap-3">
              <p className="hero-stat-label">Баланс</p>
              {isSpecialist && (
                <button type="button" onClick={() => setTab('pro')} className="text-xs font-semibold text-slate-400 hover:text-white transition-colors">
                  {user.is_pro ? 'PRO активен' : countLabel(user.response_credits || 0, 'отклик', 'отклика', 'откликов')}
                </button>
              )}
            </div>
            <p className="hero-stat-value !text-2xl sm:!text-3xl">{rub(balance)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-cta !px-3" onClick={() => setShowDepositModal(true)}>
                <IconPlus size={16} /> Пополнить
              </button>
              <button
                type="button"
                className="btn btn-glass !px-3"
                onClick={() => setShowWithdrawModal(true)}
                disabled={!canWithdraw}
                title={withdrawHint}
              >
                <IconBank size={16} /> Вывести
              </button>
            </div>
          </div>
        }
      >
        <HeroTabs items={tabs} value={tab} onChange={setTab} label="Разделы кабинета" />
      </PageHero>

      <PageBody width="medium">
        {tab === 'profile' && (
          <ProfileTab
            user={user}
            token={token}
            form={profileForm}
            verificationData={verificationData}
            onOpenVerify={() => setShowVerifyModal(true)}
            onUpdateUser={onUpdateUser}
          />
        )}

        {tab === 'wallet' && (
          <WalletTab
            user={user}
            token={token}
            withdrawalsVersion={withdrawalsVersion}
            canWithdraw={canWithdraw}
            withdrawHint={withdrawHint}
            onOpenWithdraw={() => setShowWithdrawModal(true)}
            checkingPayments={checkingPayments}
            onCheckPayments={checkPendingPayments}
          />
        )}

        {tab === 'pro' && isSpecialist && (
          <ProTab
            user={user}
            token={token}
            onUpdateUser={onUpdateUser}
            onOpenDeposit={(amount) => {
              setDepositPreset(amount > 0 ? { amount: Math.max(100, Math.ceil(amount)), returnTo: null } : null);
              setShowDepositModal(true);
            }}
          />
        )}

        {tab === 'settings' && <SettingsTab user={user} token={token} passwordForm={passwordForm} onLogout={onLogout} />}

        {tab === 'admin' && isAdmin && <AdminTab token={token} onUpdateUser={onUpdateUser} />}
      </PageBody>

      <VerifyDialog
        open={showVerifyModal}
        defaultName={user.name}
        onClose={() => setShowVerifyModal(false)}
        onSubmit={handleVerificationSubmit}
      />

      {showDepositModal && (
        <PaymentModal
          onClose={closeDepositModal}
          onSuccess={handleDepositSuccess}
          token={token}
          defaultAmount={depositPreset?.amount}
          note={depositPreset?.returnTo ? 'После зачисления вернём вас к заданию — останется выбрать исполнителя.' : null}
        />
      )}

      {showWithdrawModal && (
        <WithdrawModal
          balance={balance}
          onClose={() => setShowWithdrawModal(false)}
          onCreated={() => {
            setWithdrawalsVersion((v) => v + 1);
            if (onUpdateUser) onUpdateUser();
          }}
        />
      )}
    </>
  );
}
