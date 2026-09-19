import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { IconBell, IconLightning, IconJustice, IconOnline, IconPayout, IconAdmin, IconChart, IconCheck, IconLock, IconRefresh, IconStar, IconTasks, IconUsers, IconWallet } from '../components/icons.jsx';
import { taskCategoryLabel } from '../utils/taskCategories';
import { transactionTypeLabel } from '../utils/transactionTypes';

export default function AdminDashboardPage({ user, token }) {
  const { addToast } = useToast();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [users, setUsers] = useState(null);
  const [userFilters, setUserFilters] = useState({ page: 1, per_page: 20 });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, activityRes] = await Promise.all([
        fetch('/admin/stats', { headers: { Authorization: `Bearer ${token}` }}),
        fetch('/admin/recent-activity', { headers: { Authorization: `Bearer ${token}` }})
      ]);

      if (statsRes.status === 403 || activityRes.status === 403) {
        setForbidden(true);
        return;
      }

      if (!statsRes.ok || !activityRes.ok) {
        throw new Error('Не удалось загрузить данные');
      }

      const statsData = await statsRes.json();
      const activityData = await activityRes.json();

      setStats(statsData);
      setActivity(activityData);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async (filters = userFilters) => {
    try {
      const params = new URLSearchParams();
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined && filters[key] !== '') params.append(key, filters[key]);
      });

      const res = await fetch(`/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Не удалось загрузить пользователей');
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === 'users' && !users) {
      fetchUsers();
    }
  }, [activeTab]);

  // ================== КОМПОНЕНТЫ ==================

  // Карточка статистики
  const StatCard = ({ title, value, icon, change, color = 'indigo' }) => (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg border border-slate-200 dark:border-slate-700`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{title}</p>
          <p className={`text-3xl font-bold mt-2 text-${color}-600 dark:text-${color}-400`}>{value}</p>
          {change !== undefined && (
            <p className={`text-sm mt-2 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% за неделю
            </p>
          )}
        </div>
        <div className={`text-4xl opacity-20`}>{icon}</div>
      </div>
    </div>
  );

  // Простой линейный график (SVG)
  const SimpleLineChart = ({ data, title, height = 150 }) => {
    if (!data || data.length === 0) return null;

    const max = Math.max(...data.map(d => d.count || d.revenue || 0));
    const min = Math.min(...data.map(d => d.count || d.revenue || 0));
    const range = max - min || 1;

    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - (((d.count || d.revenue || 0) - min) / range) * 80;
      return `${x},${y}`;
    }).join(' ');

    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{title}</h3>
        <svg viewBox="0 0 100 100" className="w-full" style={{ height: `${height}px` }}>
          <polyline
            points={points}
            fill="none"
            stroke="rgb(99, 102, 241)"
            strokeWidth="2"
            className="drop-shadow-lg"
          />
          {data.map((d, i) => {
            const x = (i / (data.length - 1)) * 100;
            const y = 100 - (((d.count || d.revenue || 0) - min) / range) * 80;
            return (
              <circle key={i} cx={x} cy={y} r="2" fill="rgb(99, 102, 241)" />
            );
          })}
        </svg>
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-2">
          {data.map((d, i) => i % 2 === 0 && (
            <span key={i}>{d.date?.slice(5)}</span>
          ))}
        </div>
      </div>
    );
  };

  // Столбчатая диаграмма
  const SimpleBarChart = ({ data, title }) => {
    if (!data || Object.keys(data).length === 0) return null;

    const entries = Object.entries(data);
    const max = Math.max(...entries.map(([, v]) => v));

    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{title}</h3>
        <div className="space-y-3">
          {entries.map(([key, value]) => (
            <div key={key}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600 dark:text-slate-300">{taskCategoryLabel(key)}</span>
                <span className="font-bold text-slate-900 dark:text-white">{value}</span>
              </div>
              <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Карточка очереди с бейджем
  const QueueCard = ({ title, count, link, icon, color = 'red' }) => (
    <Link
      to={link}
      className={`block bg-white dark:bg-slate-800 rounded-xl p-4 shadow-md border-2 ${
        count > 0 ? `border-${color}-500` : 'border-slate-200 dark:border-slate-700'
      } hover:shadow-lg transition-all`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {count > 0 ? `${count} ожидают` : 'Все обработано'}
            </p>
          </div>
        </div>
        {count > 0 && (
          <span className={`px-3 py-1 bg-${color}-500 text-white text-sm font-bold rounded-full`}>
            {count}
          </span>
        )}
      </div>
    </Link>
  );

  // Таблица пользователей
  const UsersTable = () => {
    if (!users) return <div className="text-center py-8">Загрузка...</div>;

    return (
      <div className="space-y-4">
        {/* Фильтры */}
        <div className="flex flex-wrap gap-4">
          <input
            type="text"
            placeholder="Поиск по email или имени..."
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            onChange={(e) => {
              const newFilters = { ...userFilters, search: e.target.value, page: 1 };
              setUserFilters(newFilters);
              fetchUsers(newFilters);
            }}
          />
          <select
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            onChange={(e) => {
              const newFilters = { ...userFilters, role: e.target.value || undefined, page: 1 };
              setUserFilters(newFilters);
              fetchUsers(newFilters);
            }}
          >
            <option value="">Все роли</option>
            <option value="customer">Заказчики</option>
            <option value="specialist">Специалисты</option>
          </select>
          <select
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            onChange={(e) => {
              const value = e.target.value === '' ? undefined : e.target.value === 'true';
              const newFilters = { ...userFilters, verified: value, page: 1 };
              setUserFilters(newFilters);
              fetchUsers(newFilters);
            }}
          >
            <option value="">Все статусы</option>
            <option value="true">Верифицированные</option>
            <option value="false">Не верифицированные</option>
          </select>
        </div>

        {/* Таблица */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden border border-slate-200 dark:border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Имя</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Роль</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Баланс</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Статус</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {users.users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{u.id}</td>
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{u.email}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{u.name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        u.role === 'specialist' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {u.role === 'specialist' ? 'Специалист' : 'Заказчик'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-white">{u.balance?.toLocaleString() || 0} ₽</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {u.verified && <span className="text-green-600" title="Верифицирован"><IconCheck /></span>}
                        {u.is_pro && <span className="text-amber-500" title="PRO"><IconStar /></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Пагинация */}
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Показано {users.users.length} из {users.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const newFilters = { ...userFilters, page: userFilters.page - 1 };
                  setUserFilters(newFilters);
                  fetchUsers(newFilters);
                }}
                disabled={userFilters.page === 1}
                className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                ← Назад
              </button>
              <span className="px-3 py-1 text-sm text-slate-600 dark:text-slate-400">
                Страница {userFilters.page} из {users.pages}
              </span>
              <button
                onClick={() => {
                  const newFilters = { ...userFilters, page: userFilters.page + 1 };
                  setUserFilters(newFilters);
                  fetchUsers(newFilters);
                }}
                disabled={userFilters.page >= users.pages}
                className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                Вперёд →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Последняя активность
  const RecentActivity = () => {
    if (!activity) return null;

    return (
      <div className="grid md:grid-cols-3 gap-6">
        {/* Новые пользователи */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4"><IconUsers /> Новые пользователи</h3>
          <div className="space-y-2">
            {activity.users?.slice(0, 5).map(u => (
              <div key={u.id} className="flex justify-between items-center text-sm border-b border-slate-100 dark:border-slate-700 pb-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{u.email}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{u.role === 'specialist' ? 'Специалист' : 'Заказчик'}</p>
                </div>
                <span className="text-xs text-slate-400">{new Date(u.created_at).toLocaleDateString('ru-RU')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Новые задачи */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4"><IconTasks /> Новые задачи</h3>
          <div className="space-y-2">
            {activity.tasks?.slice(0, 5).map(t => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="block text-sm border-b border-slate-100 dark:border-slate-700 pb-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 -mx-2 px-2 rounded transition">
                <p className="font-semibold text-slate-900 dark:text-white truncate">{t.title}</p>
                <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 mt-1">
                  <span>{t.budget?.toLocaleString()} ₽</span>
                  <span>{new Date(t.created_at).toLocaleDateString('ru-RU')}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Крупные транзакции */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4"><IconWallet /> Крупные транзакции</h3>
          <div className="space-y-2">
            {activity.transactions?.slice(0, 5).map(tr => (
              <div key={tr.id} className="flex justify-between items-center text-sm border-b border-slate-100 dark:border-slate-700 pb-2">
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">{tr.amount?.toLocaleString()} ₽</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{transactionTypeLabel(tr.type)}</p>
                </div>
                <span className="text-xs text-slate-400">{new Date(tr.created_at).toLocaleDateString('ru-RU')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ================== РЕНДЕР ==================

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-6xl"><IconLock /></div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Доступ запрещён</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Эта страница доступна только администраторам платформы.
          </p>
          <Link to="/" className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <IconAdmin /> Admin Dashboard
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Управление платформой ДЕЛО
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow-lg"
          >
            <IconRefresh /> Обновить
          </button>
        </div>

        {/* Ключевые метрики */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Пользователи"
              value={stats.users?.total || 0}
              icon={<IconUsers size={22} />}
              change={stats.users?.new_7d}
              color="blue"
            />
            <StatCard
              title="Задачи"
              value={stats.tasks?.total || 0}
              icon={<IconTasks size={22} />}
              change={stats.tasks?.new_7d}
              color="purple"
            />
            <StatCard
              title="GMV"
              value={`${((stats.money?.gmv || 0) / 1000).toFixed(0)}K ₽`}
              icon={<IconWallet size={22} />}
              color="green"
            />
            <StatCard
              title="Онлайн"
              value={stats.users?.online || 0}
              icon={<IconOnline size={22} />}
              color="emerald"
            />
          </div>
        )}

        {/* Графики */}
        {stats?.charts && (
          <div className="grid md:grid-cols-2 gap-6">
            <SimpleLineChart
              data={stats.charts.users_growth_7d}
              title="Рост пользователей (7 дней)"
            />
            <SimpleLineChart
              data={stats.charts.revenue_7d}
              title="Доход - комиссия (7 дней)"
            />
          </div>
        )}

        {/* Категории задач */}
        {stats?.charts?.tasks_by_category && (
          <SimpleBarChart
            data={stats.charts.tasks_by_category}
            title="Задачи по категориям"
          />
        )}

        {/* Очереди - требуют внимания */}
        {stats?.queues && (
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4"><IconBell className="inline align-[-2px]" /> Требуют внимания</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <QueueCard
                title="Споры"
                count={stats.queues.disputes_open}
                link="/admin/disputes"
                icon={<IconJustice size={22} />}
                color="red"
              />
              <QueueCard
                title="Верификация"
                count={stats.queues.verifications_pending}
                link="/verification"
                icon={<IconCheck size={22} />}
                color="amber"
              />
              <QueueCard
                title="Выводы средств"
                count={stats.queues.withdrawals_pending}
                link="/wallet"
                icon={<IconPayout size={22} />}
                color="green"
              />
            </div>
          </div>
        )}

        {/* Вкладки управления */}
        <div>
          <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
            <div className="flex gap-4 overflow-x-auto">
              {[
                { id: 'overview', label: <><IconChart /> Обзор</>, icon: <IconChart /> },
                { id: 'users', label: <><IconUsers /> Пользователи</>, icon: <IconUsers /> },
                { id: 'activity', label: <><IconLightning /> Активность</>, icon: <IconLightning /> },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-3 font-semibold transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Содержимое вкладки */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4"><IconWallet /> Финансы</h3>
                <div className="grid md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">GMV (оборот)</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.money?.gmv?.toLocaleString() || 0} ₽</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Комиссия заработано</p>
                    <p className="text-2xl font-bold text-green-600">{stats.money?.commission_earned?.toLocaleString() || 0} ₽</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">В эскроу</p>
                    <p className="text-2xl font-bold text-amber-600">{stats.money?.escrow_held?.toLocaleString() || 0} ₽</p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4"><IconChart /> Статистика</h3>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Пользователи</p>
                    <div className="space-y-1">
                      <p className="text-sm">Заказчиков: <span className="font-bold">{stats.users?.customers}</span></p>
                      <p className="text-sm">Специалистов: <span className="font-bold">{stats.users?.specialists}</span></p>
                      <p className="text-sm">PRO: <span className="font-bold text-amber-600">{stats.users?.pro}</span></p>
                      <p className="text-sm">Верифицированных: <span className="font-bold text-green-600">{stats.users?.verified}</span></p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Задачи</p>
                    <div className="space-y-1">
                      <p className="text-sm">Открыто: <span className="font-bold">{stats.tasks?.open}</span></p>
                      <p className="text-sm">В работе: <span className="font-bold text-blue-600">{stats.tasks?.in_progress}</span></p>
                      <p className="text-sm">Завершено: <span className="font-bold text-green-600">{stats.tasks?.completed}</span></p>
                      <p className="text-sm">Споры: <span className="font-bold text-red-600">{stats.tasks?.disputed}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && <UsersTable />}
          {activeTab === 'activity' && <RecentActivity />}
        </div>
      </div>
    </div>
  );
}
