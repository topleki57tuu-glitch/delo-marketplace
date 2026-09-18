import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { IconCatBusiness, IconBriefcase, IconCalendar, IconGlobe, IconLock, IconMailOpen, IconMessages, IconPin, IconTools, IconWarning } from '../components/icons.jsx';

const STATUS_META = {
  open:        { label: 'Открыт',     cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  in_progress: { label: 'В работе',   cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  completed:   { label: 'Завершён',   cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  disputed:    { label: 'Спор',       cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  cancelled:   { label: 'Отменён',    cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const FILTERS = [
  { id: 'active',    label: 'Активные' },
  { id: 'completed', label: 'Завершённые' },
  { id: 'all',       label: 'Все' },
];

function formatDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 16).replace('T', ' ');
}

export default function MyTasksPage({ onOpenAuth }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, isAuth } = useAuthStore();

  const role = searchParams.get('role') === 'executor' ? 'executor' : 'customer';
  const filter = FILTERS.some((f) => f.id === searchParams.get('filter'))
    ? searchParams.get('filter')
    : 'active';

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAuth || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ role });
    if (filter !== 'all') params.set('status_filter', filter);

    fetch(`/tasks/my?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => setError('Не удалось загрузить ваши заказы'))
      .finally(() => setLoading(false));
  }, [role, filter, token, isAuth]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const stats = useMemo(() => ({
    total: tasks.length,
    responses: tasks.reduce((sum, t) => sum + (t.responses_count || 0), 0),
  }), [tasks]);

  if (!isAuth) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 max-w-md w-full p-8 rounded-3xl border border-slate-200 dark:border-slate-700 text-center space-y-4">
          <div className="text-4xl"><IconLock /></div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Требуется вход</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Войдите, чтобы видеть свои заказы: опубликованные вами и те, где вы исполнитель.
          </p>
          <button
            onClick={() => onOpenAuth('login')}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all"
          >
            Войти в аккаунт
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 pt-6 pb-28 md:pb-10 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Мои заказы
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {stats.total} {stats.total === 1 ? 'заказ' : 'заказов'}
          {role === 'customer' && stats.responses > 0 && ` · ${stats.responses} откликов`}
        </p>
      </div>

      {/* Кто я в этих заказах */}
      <div className="flex gap-2 mb-3">
        {[
          { id: 'customer', label: 'Я заказчик', icon: <IconCatBusiness /> },
          { id: 'executor', label: 'Я исполнитель', icon: <IconTools /> },
        ].map((r) => (
          <button
            key={r.id}
            onClick={() => setParam('role', r.id)}
            className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              role === r.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-400'
            }`}
          >
            <span className="mr-1.5">{r.icon}</span>{r.label}
          </button>
        ))}
      </div>

      {/* Статус */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setParam('filter', f.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              filter === f.id
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-400">Загрузка заказов...</p>
        </div>
      ) : error ? (
        <div className="py-16 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-red-300 dark:border-red-800 p-8">
          <div className="text-4xl mb-3"><IconWarning /></div>
          <p className="text-sm text-red-500">{error}</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-16 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8">
          <div className="text-4xl mb-3"><IconMailOpen /></div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-1">
            {role === 'customer' ? 'Вы ещё не публиковали заказы' : 'Вы пока не исполнитель ни по одному заказу'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
            {role === 'customer'
              ? 'Опишите задачу — специалисты предложат свои услуги.'
              : 'Откликнитесь на подходящий заказ, и он появится здесь после назначения.'}
          </p>
          <Link
            to={role === 'customer' ? '/create-task' : '/tasks'}
            className="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-all"
          >
            {role === 'customer' ? '+ Создать задание' : 'Найти заказы'}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tasks.map((t) => {
            const meta = STATUS_META[t.status] || { label: t.status, cls: 'bg-slate-200 text-slate-600' };
            return (
              <div
                key={t.id}
                onClick={() => navigate(`/tasks/${t.id}`)}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-indigo-400 transition-all cursor-pointer flex flex-col"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-bold text-slate-900 dark:text-white leading-snug line-clamp-2">
                    {t.title}
                  </h3>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${meta.cls}`}>
                    {meta.label}
                  </span>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 mt-auto">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {t.budget ? `${t.budget.toLocaleString('ru-RU')} ₽` : 'По договорённости'}
                    </span>
                    {t.is_remote ? <span><IconGlobe /> Удалённо</span> : t.city ? <span><IconPin /> {t.city}</span> : null}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {role === 'customer' ? (
                      t.counterparty_name
                        ? <span><IconTools /> Исполнитель: <b>{t.counterparty_name}</b></span>
                        : <span><IconMessages /> Откликов: <b>{t.responses_count}</b></span>
                    ) : (
                      <span><IconBriefcase /> Заказчик: <b>{t.counterparty_name || '—'}</b></span>
                    )}
                    {t.deadline && <span><IconCalendar /> до {t.deadline}</span>}
                  </div>

                  {t.created_at && (
                    <div className="text-[10px] text-slate-400">
                      Опубликовано: {formatDate(t.created_at)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
