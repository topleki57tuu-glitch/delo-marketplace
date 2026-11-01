import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useDialogs } from '../components/DialogProvider.jsx';
import CityInput from '../components/CityInput';
import { PortfolioUploader } from '../components/ImageUploader';
import { WithdrawModal } from '../components/WithdrawModal';
import { PaymentModal } from '../components/PaymentModal';
import { AvatarUploader } from '../components/Avatar';
import PageHero, { HeroAvatar, HeroTabs, PageBody } from '../components/PageHero.jsx';
import { ThemeSwitch } from '../components/ThemeToggle.jsx';
import { AuthRequired, Spinner } from '../components/PageState.jsx';
import { countLabel, parseList } from '../utils/format.js';
import { useAuthStore } from '../store/authStore';
import {
  IconAdmin,
  IconArrowRight,
  IconBank,
  IconBriefcase,
  IconCard,
  IconCheck,
  IconDownload,
  IconEdit,
  IconEye,
  IconLock,
  IconLogout,
  IconPhone,
  IconPin,
  IconPlus,
  IconRecycle,
  IconRefresh,
  IconRocket,
  IconSettings,
  IconStar,
  IconUser,
  IconWallet,
} from '../components/icons.jsx';
import AdminTab from './profile/AdminTab.jsx';
import {
  EmptyLine,
  PACKAGES,
  Panel,
  TX_TYPES,
  VerifyDialog,
  WITHDRAWAL_STATUS,
  dateTime,
  longDate,
  rub,
} from './profile/profileShared.jsx';

export default function ProfilePage({ user, token, onUpdateUser, onLogout, onOpenAuth }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [city, setCity] = useState(user?.city || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [skills, setSkills] = useState(parseList(user?.skills).join(', '));
  const [saving, setSaving] = useState(false);

  // Смена пароля — отдельная форма со своим запросом: Enter в поле пароля
  // не должен отправлять сохранение профиля.
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwRepeat, setPwRepeat] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [checkingPayments, setCheckingPayments] = useState(false);
  const [buyingPackage, setBuyingPackage] = useState(null);
  const [switchingRole, setSwitchingRole] = useState(false);

  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verificationData, setVerificationData] = useState(null);

  // Признак модератора берём с бэкенда: раньше он вычислялся по email
  // с подстрокой «admin», и панель с очередью выплат раскрывалась перед
  // admin-vasya@x.com — хотя запросы к данным сервер всё равно отклонял.
  const isAdmin = !!user?.is_admin;

  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [showAllTx, setShowAllTx] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);

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

  // Поля формы подтягиваем, когда профиль догрузился или обновился
  useEffect(() => {
    if (!user || isEditing) return;
    setName(user.name || '');
    setBio(user.bio || '');
    setCity(user.city || '');
    setPhone(user.phone || '');
    setSkills(parseList(user.skills).join(', '));
  }, [user, isEditing]);

  const auth = token ? { Authorization: `Bearer ${token}` } : {};

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

  useEffect(() => {
    if (!user || !token) return;
    if (tab === 'wallet') {
      loadTransactions();
      loadWithdrawals();
    }
  }, [tab, user?.id, token]);

  // Дозачисление «зависших» платежей. Зачисление держится на вебхуке —
  // он настраивается в кабинете провайдера отдельно от кода, и пока там
  // указан старый домен, уведомления не приходят вообще, — и на возврате
  // плательщика в браузере. Оба пути могут отказать молча, поэтому есть
  // отдельный вызов: он спрашивает провайдера про НАШИ незачисленные
  // платежи и зачисляет те, что оплачены. Сервер ничего не берёт из
  // запроса, так что перебрать чужие платежи этим вызовом нельзя.
  const checkPendingPayments = useCallback(async ({ quiet = false } = {}) => {
    if (!token) return;
    setCheckingPayments(true);
    try {
      const res = await fetch('/payments/confirm-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (!quiet) addToast(data.detail || 'Не удалось проверить платежи', 'error');
        return;
      }

      if (data.credited?.length) {
        addToast(`Баланс пополнен на ${data.total.toLocaleString('ru-RU')} ₽!`, 'success');
        if (onUpdateUser) onUpdateUser();
      } else if (!quiet) {
        // «Проверено, но не оплачено» и «нечего проверять» — разные ответы:
        // в первом случае стоит подождать, во втором ждать нечего.
        addToast(
          data.checked
            ? 'Оплата пока не подтверждена провайдером. Попробуйте через минуту.'
            : 'Незавершённых платежей нет.',
          'info'
        );
      }
    } catch {
      if (!quiet) addToast('Не удалось проверить платежи', 'error');
    } finally {
      setCheckingPayments(false);
    }
  }, [token, addToast, onUpdateUser]);

  // Возврат из ЮMoney после оплаты (successURL в платёжной форме ведёт сюда
  // с параметром `payment=return`). Само по себе возвращение денег не
  // зачисляет: вебхук может ещё не прийти, а зачисление — отдельный шаг.
  //
  // Раньше здесь читался `delo_pending_payment` из `sessionStorage`, и без
  // него подтверждение молча пропускалось. На iOS форма оплаты открывается
  // отдельной вкладкой, и хранилище сеанса туда не доезжает — платёж
  // оставался неоплаченным с точки зрения приложения навсегда, потому что
  // восстановить его из интерфейса было нечем.
  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'return') return;

    // Параметр из адреса убираем сразу: проверка должна сработать один раз,
    // а не при каждом обновлении страницы или возврате по «назад».
    // Вместо него открываем вкладку кошелька — там видно результат.
    params.delete('payment');
    params.set('tab', 'wallet');
    setSearchParams(params, { replace: true });

    checkPendingPayments();
  }, [token, checkPendingPayments]);

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

  const parsePortfolio = () => {
    try {
      const items = user?.portfolio ? JSON.parse(user.portfolio) : [];
      return Array.isArray(items) ? items : [];
    } catch (e) {
      return [];
    }
  };

  const savePortfolio = async (items) => {
    try {
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ portfolio: JSON.stringify(items) }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить портфолио');
      onUpdateUser();
      return true;
    } catch (err) {
      addToast(err.message, 'error');
      return false;
    }
  };

  const handlePortfolioAdd = async (url) => {
    if (await savePortfolio([...parsePortfolio(), url])) addToast('Работа добавлена в портфолио', 'success');
  };

  const handlePortfolioDelete = async (idx) => {
    const ok = await dialogs.confirm({ title: 'Удалить работу из портфолио?', confirmText: 'Удалить', danger: true });
    if (!ok) return;
    if (await savePortfolio(parsePortfolio().filter((_, i) => i !== idx))) addToast('Работа удалена из портфолио', 'success');
  };

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
      if (!res.ok) throw new Error(data.detail || 'Ошибка отправки заявки');

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

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || null,
        bio: bio.trim(),
        city: (typeof city === 'object' && city ? city.name : city || '').trim(),
        phone: phone.trim(),
      };
      if (isSpecialist) {
        payload.skills = JSON.stringify(parseList(skills).slice(0, 20));
      }
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Не удалось обновить профиль');

      addToast('Профиль обновлён', 'success');
      setIsEditing(false);
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Разбор ошибки от бэкенда. Pydantic на неверный пароль отдаёт не строку,
  // а список объектов; при наивном new Error(data.detail) пользователь увидел
  // бы «[object Object]» вместо причины отказа.
  const readApiError = (data, fallback) => {
    const detail = data && data.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0];
      if (typeof first === 'string') return first;
      if (first && typeof first.msg === 'string') {
        return first.msg.replace(/^Value error,\s*/, '');
      }
    }
    return fallback;
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();

    // Проверки ниже повторяют серверные, но не заменяют их: они экономят
    // запрос, а решение всё равно принимает бэкенд (app/schemas/_check_password).
    if (pwNew !== pwRepeat) {
      addToast('Новый пароль и повтор не совпадают', 'error');
      return;
    }
    if (pwNew.length < 8) {
      addToast('Новый пароль короче 8 символов', 'error');
      return;
    }
    if (!/\d/.test(pwNew)) {
      addToast('В новом пароле нужна хотя бы одна цифра', 'error');
      return;
    }

    setPwSaving(true);
    try {
      const res = await fetch('/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readApiError(data, 'Не удалось сменить пароль'));

      setPwCurrent('');
      setPwNew('');
      setPwRepeat('');
      // Бэкенд закрыл все сессии и выдал этой вкладке новую пару токенов:
      // здесь вход продолжается, на других устройствах нужно войти заново.
      if (data.refresh_token) {
        const { login, role: currentRole } = useAuthStore.getState();
        login(data.access_token || token, currentRole, data.refresh_token);
      }
      addToast('Пароль изменён', 'success');
      addToast('На других устройствах нужно войти заново', 'info');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const handleSwitchRole = async () => {
    const toSpecialist = !isSpecialist;
    const ok = await dialogs.confirm({
      title: toSpecialist ? 'Перейти в режим специалиста?' : 'Перейти в режим заказчика?',
      message: toSpecialist
        ? 'Вы сможете откликаться на задания и продавать услуги. Вернуться в режим заказчика можно в любой момент.'
        : 'Вы сможете публиковать задания и выбирать исполнителей. Вернуться в режим специалиста можно в любой момент.',
      confirmText: 'Переключить',
    });
    if (!ok) return;
    setSwitchingRole(true);
    try {
      const res = await fetch('/users/me/switch-role', {
        method: 'POST',
        headers: auth,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось переключить роль');

      if (data.token) {
        const { login } = useAuthStore.getState();
        login(data.token, data.role);
      }

      addToast(`Теперь вы ${data.role === 'specialist' ? 'специалист' : 'заказчик'}`, 'success');
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSwitchingRole(false);
    }
  };

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

  const reqStatus = verificationData?.request?.status;
  const balance = user.balance || 0;
  const portfolio = parsePortfolio();
  const userSkills = parseList(user.skills);

  const tabs = [
    { id: 'profile', label: 'Профиль', icon: IconUser },
    { id: 'wallet', label: 'Кошелёк', icon: IconWallet },
    ...(isSpecialist ? [{ id: 'pro', label: 'Отклики и PRO', icon: IconRocket }] : []),
    { id: 'settings', label: 'Настройки', icon: IconSettings },
    ...(isAdmin ? [{ id: 'admin', label: 'Модерация', icon: IconAdmin }] : []),
  ];

  const iconBox = 'w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300';
  const canWithdraw = balance >= 500;
  const withdrawHint = canWithdraw ? 'Вывести средства' : 'Минимальная сумма вывода — 500 ₽';
  const visibleTx = showAllTx ? transactions : transactions.slice(0, 8);

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
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
            <div className="space-y-5 min-w-0">
              {isEditing ? (
                <Panel eyebrow="Анкета" title="Редактирование профиля">
                  <form onSubmit={handleSaveProfile} className="space-y-4">
                    <div className="pb-4 border-b border-slate-100 dark:border-slate-700/70">
                      <p className="field-label">Фото профиля</p>
                      <AvatarUploader currentAvatar={user.avatar} onAvatarUpdate={onUpdateUser} token={token} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="pf-name" className="field-label">Имя</label>
                        <input id="pf-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label htmlFor="pf-phone" className="field-label">Телефон</label>
                        <input
                          id="pf-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+7 900 000-00-00"
                          className="input"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="pf-city" className="field-label">Город</label>
                      <CityInput
                        id="pf-city"
                        value={typeof city === 'object' && city ? city.name : city || ''}
                        onChange={setCity}
                        placeholder="Любой город России"
                      />
                    </div>
                    <div>
                      <label htmlFor="pf-bio" className="field-label">О себе</label>
                      <textarea
                        id="pf-bio"
                        rows={4}
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder={isSpecialist ? 'Опыт, чем занимаетесь, в какое время на связи' : 'Пара слов о себе — исполнителям проще откликаться'}
                        className="textarea"
                      />
                    </div>
                    {isSpecialist && (
                      <div>
                        <label htmlFor="pf-skills" className="field-label">Навыки</label>
                        <input
                          id="pf-skills"
                          type="text"
                          value={skills}
                          onChange={(e) => setSkills(e.target.value)}
                          placeholder="Например: сантехника, электрика, сборка мебели"
                          className="input"
                        />
                        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Через запятую — по ним вас находят в каталоге специалистов.</p>
                      </div>
                    )}
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                      <button type="button" onClick={() => setIsEditing(false)} className="btn btn-secondary">
                        Отмена
                      </button>
                      <button type="submit" disabled={saving} className="btn btn-primary">
                        {saving ? 'Сохранение...' : 'Сохранить'}
                      </button>
                    </div>
                  </form>
                </Panel>
              ) : (
                <Panel
                  eyebrow="Анкета"
                  title="О себе"
                  action={
                    <>
                      <Link to={`/specialist/${user.id}`} className="btn btn-ghost !px-3 !py-2">
                        <IconEye size={16} /> Как видят другие
                      </Link>
                      <button type="button" onClick={() => setIsEditing(true)} className="btn btn-secondary !px-3 !py-2">
                        <IconEdit size={16} /> Редактировать
                      </button>
                    </>
                  }
                >
                  {user.bio ? (
                    <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line break-words">{user.bio}</p>
                  ) : (
                    <EmptyLine>
                      {isSpecialist
                        ? 'Расскажите об опыте и о том, за какие задачи беретесь, — заказчики читают это перед выбором исполнителя.'
                        : 'Пара слов о себе помогает исполнителям быстрее откликаться.'}
                    </EmptyLine>
                  )}
                  <dl className="mt-5 grid gap-3 sm:grid-cols-3 text-sm">
                    {[
                      ['Email', user.email],
                      ['Телефон', user.phone],
                      ['Город', user.city],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3.5 py-2.5 min-w-0">
                        <dt className="text-xs font-semibold text-slate-400">{label}</dt>
                        <dd className={`mt-0.5 font-semibold truncate ${value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>
                          {value || 'не указан'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {isSpecialist && (
                    <div className="mt-5">
                      <p className="text-xs font-semibold text-slate-400 mb-2">Навыки</p>
                      {userSkills.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {userSkills.map((s) => (
                            <span key={s} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Не указаны — добавьте их в редакторе профиля.</p>
                      )}
                    </div>
                  )}
                </Panel>
              )}

              {isSpecialist && (
                <section className="card p-5 sm:p-6">
                  <PortfolioUploader
                    token={token}
                    portfolio={portfolio}
                    onUploadSuccess={handlePortfolioAdd}
                    onDelete={handlePortfolioDelete}
                  />
                </section>
              )}
            </div>

            <aside className="space-y-5">
              <Panel eyebrow="Доверие" title="Проверка личности">
                {user.verified ? (
                  <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                    <IconCheck size={16} className="mt-0.5 shrink-0" />
                    Личность подтверждена — в анкете стоит знак «Проверен».
                  </p>
                ) : reqStatus === 'pending' ? (
                  <p className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <IconRefresh size={16} className="mt-0.5 shrink-0" />
                    Заявка на проверке. Обычно это занимает до 2 часов.
                  </p>
                ) : (
                  <>
                    {reqStatus === 'rejected' && (
                      <p className="mb-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-300">
                        Заявка отклонена: «{verificationData?.request?.rejection_reason || 'уточните данные'}». Исправьте данные и отправьте снова.
                      </p>
                    )}
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Паспорт или статус самозанятого — и в анкете появится знак «Проверен». Таким пользователям доверяют больше.
                    </p>
                    <button type="button" onClick={() => setShowVerifyModal(true)} className="btn btn-primary w-full mt-4">
                      <IconAdmin size={16} /> {reqStatus === 'rejected' ? 'Подать заново' : 'Пройти проверку'}
                    </button>
                  </>
                )}
              </Panel>

              <Panel eyebrow="Режим" title={isSpecialist ? 'Вы — специалист' : 'Вы — заказчик'}>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {isSpecialist
                    ? 'Нужно что-то сделать самим? Переключитесь в режим заказчика и опубликуйте задание.'
                    : 'Хотите зарабатывать на своих навыках? В режиме специалиста можно откликаться на задания и продавать услуги.'}
                </p>
                <button type="button" onClick={handleSwitchRole} disabled={switchingRole} className="btn btn-secondary w-full mt-4">
                  <IconRecycle size={16} />
                  {switchingRole ? 'Переключаем...' : isSpecialist ? 'Стать заказчиком' : 'Стать специалистом'}
                </button>
              </Panel>
            </aside>
          </div>
        )}

        {tab === 'wallet' && (
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
                    onClick={() => setShowWithdrawModal(true)}
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
                <button type="button" onClick={() => checkPendingPayments()} disabled={checkingPayments} className="btn btn-secondary w-full mt-4">
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
        )}

        {tab === 'pro' && isSpecialist && (
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
              <button type="button" onClick={() => setShowDepositModal(true)} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Пополнить баланс
              </button>
            </p>
          </div>
        )}

        {tab === 'settings' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
            <Panel
              eyebrow="Безопасность"
              title="Смена пароля"
              text="После смены пароля на других устройствах нужно будет войти заново."
            >
              <form onSubmit={handleChangePassword} className="space-y-4">
                <input type="text" name="username" autoComplete="username" value={user.email || ''} readOnly hidden />
                <div>
                  <label htmlFor="pw-current" className="field-label">Текущий пароль</label>
                  <input
                    id="pw-current"
                    type="password"
                    autoComplete="current-password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    required
                    className="input"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="pw-new" className="field-label">Новый пароль</label>
                    <input
                      id="pw-new"
                      type="password"
                      autoComplete="new-password"
                      value={pwNew}
                      onChange={(e) => setPwNew(e.target.value)}
                      required
                      className="input"
                    />
                  </div>
                  <div>
                    <label htmlFor="pw-repeat" className="field-label">Повторите новый пароль</label>
                    <input
                      id="pw-repeat"
                      type="password"
                      autoComplete="new-password"
                      value={pwRepeat}
                      onChange={(e) => setPwRepeat(e.target.value)}
                      required
                      className="input"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Не меньше 8 символов и хотя бы одна цифра.</p>
                  <button type="submit" disabled={pwSaving} className="btn btn-primary">
                    <IconLock size={16} /> {pwSaving ? 'Меняем...' : 'Сменить пароль'}
                  </button>
                </div>
              </form>
            </Panel>

            <aside className="space-y-5">
              <Panel eyebrow="Оформление" title="Тема">
                <ThemeSwitch className="w-full" />
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">«Авто» — как в настройках устройства.</p>
              </Panel>
              <Panel eyebrow="Аккаунт" title="Выход">
                <p className="text-sm text-slate-500 dark:text-slate-400 break-all">{user.email}</p>
                <button type="button" onClick={onLogout} className="btn btn-secondary w-full mt-4 !text-red-600 dark:!text-red-400">
                  <IconLogout size={16} /> Выйти из аккаунта
                </button>
              </Panel>
            </aside>
          </div>
        )}

        {tab === 'admin' && isAdmin && <AdminTab token={token} onUpdateUser={onUpdateUser} />}
      </PageBody>

      <VerifyDialog
        open={showVerifyModal}
        defaultName={user.name}
        onClose={() => setShowVerifyModal(false)}
        onSubmit={handleVerificationSubmit}
      />

      {showDepositModal && (
        <PaymentModal onClose={() => setShowDepositModal(false)} onSuccess={onUpdateUser} token={token} />
      )}

      {showWithdrawModal && (
        <WithdrawModal
          balance={balance}
          onClose={() => setShowWithdrawModal(false)}
          onCreated={() => {
            loadWithdrawals();
            if (onUpdateUser) onUpdateUser();
          }}
        />
      )}
    </>
  );
}
