import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import PageHero, { HeroTabs, PageBody } from '../components/PageHero.jsx';
import { AuthRequired, ErrorState, Spinner, StateCard } from '../components/PageState.jsx';
import {
  IconAdmin,
  IconBell,
  IconChart,
  IconCheck,
  IconJustice,
  IconLightning,
  IconLock,
  IconPayout,
  IconRefresh,
  IconSearch,
  IconStar,
  IconTasks,
  IconUsers,
  IconWallet,
} from '../components/icons.jsx';
import { taskCategoryLabel } from '../utils/taskCategories';
import { transactionTypeLabel } from '../utils/transactionTypes';
import { parseServerDate } from '../utils/format.js';

/*
 * Панель управления площадкой: сводка, очереди модерации, пользователи.
 *
 * Вложенные компоненты вынесены на верхний уровень файла. Раньше они были
 * объявлены внутри страницы и пересоздавались на каждый рендер: React
 * считал их новыми, монтировал заново, и поле поиска в таблице
 * пользователей теряло фокус после каждой буквы.
 */

const money = (value) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
const compactMoney = (value) =>
  `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0)} ₽`;
const day = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
const date = (value) => parseServerDate(value)?.toLocaleDateString('ru-RU') || '—';

const TABS = [
  { id: 'overview', label: 'Обзор', icon: IconChart },
  { id: 'users', label: 'Пользователи', icon: IconUsers },
  { id: 'activity', label: 'Активность', icon: IconLightning },
];

const BAR_TONES = {
  indigo: 'bg-gradient-to-t from-indigo-600 to-violet-400',
  emerald: 'bg-gradient-to-t from-emerald-600 to-teal-400',
};

function Panel({ title, icon: Icon, aside, children, className = '' }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            {Icon && <Icon size={18} className="text-indigo-500 dark:text-indigo-400" />}
            {title}
          </h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Столбики по дням — вместо растянутой SVG-линии, у которой точки сплющивало по ширине. */
function DayBars({ title, icon, data, valueKey, format = (v) => v, tone = 'indigo' }) {
  if (!data?.length) return null;
  const values = data.map((d) => Number(d[valueKey]) || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <Panel
      title={title}
      icon={icon}
      aside={
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
          за 7 дней: <b className="text-slate-900 dark:text-white">{format(total)}</b>
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-2 sm:gap-3 h-36 items-end" role="img" aria-label={`${title}: ${data.map((d, i) => `${day(d.date)} — ${format(values[i])}`).join(', ')}`}>
        {data.map((d, i) => (
          <div key={d.date} className="relative h-full flex items-end justify-center">
            <div
              className={`relative w-full max-w-[2.75rem] rounded-t-lg ${values[i] ? BAR_TONES[tone] : 'bg-slate-200 dark:bg-slate-700'}`}
              style={{ height: `${values[i] ? Math.max(6, (values[i] / max) * 82) : 3}%` }}
            >
              {values[i] > 0 && (
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                  {format(values[i])}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2 sm:gap-3 text-center text-[11px] text-slate-400">
        {data.map((d) => (
          <span key={d.date}>{day(d.date)}</span>
        ))}
      </div>
    </Panel>
  );
}

function CategoryBars({ data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const filled = entries.filter(([, v]) => v > 0);
  if (!entries.length) return null;
  const max = Math.max(1, ...filled.map(([, v]) => v));
  const empty = entries.length - filled.length;
  return (
    <Panel title="Задания по категориям" icon={IconTasks}>
      {filled.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Заданий пока нет.</p>
      ) : (
        <ul className="space-y-3">
          {filled.map(([key, value]) => (
            <li key={key}>
              <div className="flex justify-between gap-3 text-sm mb-1">
                <span className="text-slate-600 dark:text-slate-300 truncate">{taskCategoryLabel(key)}</span>
                <span className="font-bold text-slate-900 dark:text-white">{value}</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full" style={{ width: `${(value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {empty > 0 && filled.length > 0 && (
        <p className="mt-4 text-xs text-slate-400">Ещё {empty} — без заданий</p>
      )}
    </Panel>
  );
}

const QUEUE_TONES = {
  red: { ring: 'border-red-300 dark:border-red-500/50', badge: 'bg-red-500', icon: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  amber: { ring: 'border-amber-300 dark:border-amber-500/50', badge: 'bg-amber-500', icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  emerald: { ring: 'border-emerald-300 dark:border-emerald-500/50', badge: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
};

function QueueCard({ title, count = 0, to, icon: Icon, tone = 'red', hint }) {
  const t = QUEUE_TONES[tone] || QUEUE_TONES.red;
  const content = (
    <>
      <span className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${t.icon}`}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-slate-900 dark:text-white">{title}</span>
        <span className="block text-sm text-slate-500 dark:text-slate-400 truncate">
          {count > 0 ? hint || 'ожидают решения' : 'всё обработано'}
        </span>
      </span>
      {count > 0 && <span className={`px-2.5 py-0.5 rounded-full text-white text-sm font-bold ${t.badge}`}>{count}</span>}
    </>
  );
  const cls = `card flex items-center gap-3 p-4 ${count > 0 ? t.ring : ''}`;
  // Споры разбираются на /disputes, верификация и выводы — во вкладке «Модерация» профиля
  return to ? (
    <Link to={to} className={`${cls} card-hover`}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}

function Metric({ label, value, tone = '' }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 px-4 py-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold text-slate-900 dark:text-white ${tone}`}>{value}</p>
    </div>
  );
}

function Overview({ stats }) {
  const m = stats.money || {};
  const u = stats.users || {};
  const t = stats.tasks || {};
  const q = stats.queues || {};
  const mon = stats.monetization || {};
  return (
    <div className="space-y-6">
      <section>
        <h2 className="section-title flex items-center gap-2 mb-3">
          <IconBell size={18} className="text-indigo-500 dark:text-indigo-400" /> Требуют внимания
        </h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <QueueCard title="Споры" count={q.disputes_open} to="/disputes" icon={IconJustice} tone="red" />
          <QueueCard title="Верификация" count={q.verifications_pending} to="/profile?tab=admin" icon={IconCheck} tone="amber" hint="заявок на проверку" />
          <QueueCard
            title="Выводы средств"
            count={q.withdrawals_pending}
            to="/profile?tab=admin"
            icon={IconPayout}
            tone="emerald"
            hint={m.withdrawals_pending_amount ? `на ${money(m.withdrawals_pending_amount)}` : 'заявок на вывод'}
          />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <DayBars title="Новые пользователи" icon={IconUsers} data={stats.charts?.users_growth_7d} valueKey="count" />
        <DayBars title="Комиссия площадки" icon={IconWallet} data={stats.charts?.revenue_7d} valueKey="revenue" format={compactMoney} tone="emerald" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6 items-start">
        <CategoryBars data={stats.charts?.tasks_by_category} />
        <div className="space-y-6">
          <Panel title="Деньги" icon={IconWallet}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label="Оборот (GMV)" value={money(m.gmv)} />
              <Metric label="Комиссия" value={money(m.commission_earned)} tone="!text-emerald-600 dark:!text-emerald-400" />
              <Metric label="В эскроу" value={money(m.escrow_held)} tone="!text-amber-600 dark:!text-amber-400" />
              <Metric label="На балансах" value={money(m.user_balances)} />
              <Metric label="Обязательства" value={money(m.total_liabilities)} />
              <Metric label="Выплачено" value={money(m.withdrawals_paid_total)} />
            </div>
          </Panel>
          <Panel title="Пользователи и задания" icon={IconChart}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Заказчиков" value={u.customers ?? 0} />
              <Metric label="Специалистов" value={u.specialists ?? 0} />
              <Metric label="PRO" value={u.pro ?? 0} tone="!text-amber-600 dark:!text-amber-400" />
              <Metric label="Проверенных" value={u.verified ?? 0} />
              <Metric label="Открыто" value={t.open ?? 0} />
              <Metric label="В работе" value={t.in_progress ?? 0} />
              <Metric label="Завершено" value={t.completed ?? 0} tone="!text-emerald-600 dark:!text-emerald-400" />
              <Metric label="В споре" value={t.disputed ?? 0} tone="!text-red-600 dark:!text-red-400" />
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Откликов всего: <b className="text-slate-700 dark:text-slate-200">{mon.responses_total ?? 0}</b>
              {' · '}действующих PRO: <b className="text-slate-700 dark:text-slate-200">{mon.pro_subscriptions ?? 0}</b>
              {' · '}неизрасходованных откликов: <b className="text-slate-700 dark:text-slate-200">{mon.credits_in_circulation ?? 0}</b>
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function UsersTable({ token, onError }) {
  const [filters, setFilters] = useState({ page: 1, per_page: 20, search: '', role: '', verified: '' });
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput, page: 1 })), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== '') params.append(key, value);
        });
        const res = await fetch(`/admin/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Не удалось загрузить пользователей');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) onError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [filters, token]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const users = data?.users || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <label htmlFor="admin-users-search" className="sr-only">Поиск пользователей</label>
          <input
            id="admin-users-search"
            type="search"
            placeholder="Email или имя..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input !pl-9"
          />
        </div>
        <label htmlFor="admin-users-role" className="sr-only">Роль</label>
        <select id="admin-users-role" className="select sm:w-48" value={filters.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="">Все роли</option>
          <option value="customer">Заказчики</option>
          <option value="specialist">Специалисты</option>
        </select>
        <label htmlFor="admin-users-verified" className="sr-only">Проверка</label>
        <select id="admin-users-verified" className="select sm:w-52" value={filters.verified} onChange={(e) => set({ verified: e.target.value })}>
          <option value="">Все статусы</option>
          <option value="true">Проверенные</option>
          <option value="false">Не проверенные</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Имя</th>
                <th className="px-4 py-3">Роль</th>
                <th className="px-4 py-3 text-right">Баланс</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Регистрация</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">Загрузка...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">Никого не нашлось</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 ${loading ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{u.id}</td>
                    <td className="px-4 py-3 text-slate-900 dark:text-white">
                      {u.email}
                      {u.email_verified === false && (
                        <span className="block text-xs text-amber-600 dark:text-amber-400">почта не подтверждена</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <Link to={`/specialist/${u.id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">{u.name || '—'}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`badge ${
                          u.role === 'specialist'
                            ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                            : 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                        }`}
                      >
                        {u.role === 'specialist' ? 'Специалист' : 'Заказчик'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white whitespace-nowrap">{money(u.balance)}</td>
                    <td className="px-4 py-3">
                      <span className="flex gap-1.5">
                        {u.verified && <IconCheck size={16} className="text-emerald-500" title="Проверен" />}
                        {u.is_pro && <IconStar size={16} fill="currentColor" className="text-amber-500" title="PRO" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{date(u.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && (
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Показано {users.length} из {data.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => set({ page: filters.page - 1 })}
                disabled={filters.page <= 1}
                className="btn btn-secondary !py-1.5 !px-3"
              >
                ← Назад
              </button>
              <span className="px-2 text-sm text-slate-500 dark:text-slate-400">
                {filters.page} / {Math.max(1, data.pages || 1)}
              </span>
              <button
                type="button"
                onClick={() => set({ page: filters.page + 1 })}
                disabled={filters.page >= (data.pages || 1)}
                className="btn btn-secondary !py-1.5 !px-3"
              >
                Вперёд →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentActivity({ activity }) {
  if (!activity) return null;
  const empty = <p className="text-sm text-slate-500 dark:text-slate-400">Пока пусто.</p>;
  return (
    <div className="grid md:grid-cols-3 gap-6 items-start">
      <Panel title="Новые пользователи" icon={IconUsers}>
        {activity.users?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {activity.users.slice(0, 6).map((u) => (
              <li key={u.id} className="py-2.5 first:pt-0 last:pb-0 flex justify-between items-center gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-900 dark:text-white truncate">{u.name || u.email}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{u.role === 'specialist' ? 'Специалист' : 'Заказчик'}</span>
                </span>
                <span className="text-xs text-slate-400 shrink-0">{date(u.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : empty}
      </Panel>

      <Panel title="Новые задания" icon={IconTasks}>
        {activity.tasks?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {activity.tasks.slice(0, 6).map((t) => (
              <li key={t.id} className="py-2.5 first:pt-0 last:pb-0">
                <Link to={`/tasks/${t.id}`} className="block text-sm group">
                  <span className="block font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{t.title}</span>
                  <span className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>{t.budget ? money(t.budget) : 'Договорная'}</span>
                    <span>{date(t.created_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : empty}
      </Panel>

      <Panel title="Крупные операции" icon={IconWallet}>
        {activity.transactions?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {activity.transactions.slice(0, 6).map((tr) => (
              <li key={tr.id} className="py-2.5 first:pt-0 last:pb-0 flex justify-between items-center gap-3 text-sm">
                <span>
                  <span className="block font-bold text-slate-900 dark:text-white">{money(tr.amount)}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{transactionTypeLabel(tr.type)}</span>
                </span>
                <span className="text-xs text-slate-400 shrink-0">{date(tr.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : empty}
      </Panel>
    </div>
  );
}

export default function AdminDashboardPage({ user, token, onOpenAuth }) {
  const { addToast } = useToast();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | forbidden | error
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      const [statsRes, activityRes] = await Promise.all([fetch('/admin/stats', auth), fetch('/admin/recent-activity', auth)]);
      if (statsRes.status === 403 || activityRes.status === 403) {
        setStatus('forbidden');
        return;
      }
      if (!statsRes.ok || !activityRes.ok) throw new Error('Не удалось загрузить данные');
      setStats(await statsRes.json());
      setActivity(await activityRes.json());
      setStatus('ready');
    } catch (err) {
      setStatus((s) => (s === 'ready' ? s : 'error'));
      addToast(err.message, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  const ready = user && status === 'ready' && stats;
  const u = stats?.users || {};
  const t = stats?.tasks || {};

  return (
    <>
      <PageHero
        eyebrow="Администрирование"
        icon={IconAdmin}
        title="Панель управления"
        subtitle="Пользователи, деньги и очереди модерации площадки «Дело»."
        actions={
          ready && (
            <button type="button" className="btn btn-glass" onClick={fetchData} disabled={refreshing}>
              <IconRefresh className={refreshing ? 'animate-spin' : ''} /> Обновить
            </button>
          )
        }
      >
        {ready && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <div className="hero-stat">
                <p className="hero-stat-label">Пользователи</p>
                <p className="hero-stat-value">{u.total ?? 0}</p>
                <p className="text-xs text-emerald-300 mt-0.5">+{u.new_7d ?? 0} за неделю</p>
              </div>
              <div className="hero-stat">
                <p className="hero-stat-label">Задания</p>
                <p className="hero-stat-value">{t.total ?? 0}</p>
                <p className="text-xs text-emerald-300 mt-0.5">+{t.new_7d ?? 0} за неделю</p>
              </div>
              <div className="hero-stat">
                <p className="hero-stat-label">Оборот</p>
                <p className="hero-stat-value">{compactMoney(stats.money?.gmv)}</p>
                <p className="text-xs text-slate-400 mt-0.5">комиссия {compactMoney(stats.money?.commission_earned)}</p>
              </div>
              <div className="hero-stat">
                <p className="hero-stat-label">Сейчас на сайте</p>
                <p className="hero-stat-value">{u.online ?? 0}</p>
                <p className="text-xs text-slate-400 mt-0.5">за последние минуты</p>
              </div>
            </div>
            <HeroTabs className="mt-5" label="Разделы панели" items={TABS} value={activeTab} onChange={setActiveTab} />
          </>
        )}
      </PageHero>

      <PageBody>
        {!user ? (
          <AuthRequired onOpenAuth={onOpenAuth} text="Войдите под учётной записью администратора." />
        ) : status === 'loading' ? (
          <Spinner label="Загрузка данных..." />
        ) : status === 'forbidden' ? (
          <StateCard icon={IconLock} tone="warning" title="Доступ запрещён" text="Эта страница доступна только администраторам площадки.">
            <Link to="/" className="btn btn-primary">На главную</Link>
          </StateCard>
        ) : status === 'error' ? (
          <ErrorState text="Не удалось загрузить данные панели." onRetry={fetchData} />
        ) : activeTab === 'overview' ? (
          <Overview stats={stats} />
        ) : activeTab === 'users' ? (
          <UsersTable token={token} onError={(msg) => addToast(msg, 'error')} />
        ) : (
          <RecentActivity activity={activity} />
        )}
      </PageBody>
    </>
  );
}
