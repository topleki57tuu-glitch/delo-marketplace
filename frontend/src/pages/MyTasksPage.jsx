import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import PageHero, { HeroTabs, PageBody } from '../components/PageHero.jsx';
import { AuthRequired, ErrorState, Spinner, StateCard } from '../components/PageState.jsx';
import { IconCatBusiness, IconBriefcase, IconCalendar, IconGlobe, IconMailOpen, IconMessages, IconPin, IconTasks, IconTools } from '../components/icons.jsx';
import { plural } from '../utils/format.js';

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

// Счётчик в шапке считает только показанные заказы. Без уточнения
// «активных» заказчик с завершённой сделкой видел «0 заказов».
const COUNT_WORDS = {
  active: ['активный заказ', 'активных заказа', 'активных заказов'],
  completed: ['завершённый заказ', 'завершённых заказа', 'завершённых заказов'],
  all: ['заказ', 'заказа', 'заказов'],
};

// Пустой список на вкладке «Активные» не значит, что заказов нет вовсе:
// раньше здесь всегда писали «Вы ещё не публиковали заказы».
const EMPTY_TEXT = {
  customer: {
    active: ['Активных заказов нет', 'Новые задания и заказы в работе появятся здесь. Прошлые — на вкладке «Все».'],
    completed: ['Завершённых заказов пока нет', 'Здесь появятся заказы, работу по которым вы приняли.'],
    all: ['Вы ещё не публиковали заказы', 'Опишите задачу — специалисты предложат свои услуги.'],
  },
  executor: {
    active: ['Сейчас вы не выполняете заказов', 'Откликнитесь на подходящий заказ — он появится здесь после назначения. Прошлые — на вкладке «Все».'],
    completed: ['Завершённых заказов пока нет', 'Здесь появятся заказы, которые заказчик принял.'],
    all: ['Вы пока не исполнитель ни по одному заказу', 'Откликнитесь на подходящий заказ, и он появится здесь после назначения.'],
  },
};

// «2026-11-08 11:23:53.514187» → «8 нояб. 2026, 11:23». Раньше дата
// выводилась как есть, прямо из API, с микросекундами.
function toDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(iso) {
  const d = toDate(iso);
  if (!d) return iso || '';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso) {
  const d = toDate(iso);
  if (!d) return iso || '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function MyTasksPage({ onOpenAuth }) {
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

  const hero = (
    <PageHero
      eyebrow="Личный кабинет"
      icon={IconTasks}
      title="Мои заказы"
      subtitle={
        isAuth && !loading && !error ? (
          <>
            {stats.total} {plural(stats.total, ...COUNT_WORDS[filter])}
            {role === 'customer' && stats.responses > 0 && ` · ${stats.responses} ${plural(stats.responses, 'отклик', 'отклика', 'откликов')}`}
          </>
        ) : (
          'Задания, которые вы опубликовали, и те, где вы исполнитель.'
        )
      }
      actions={
        isAuth ? (
          <Link to={role === 'customer' ? '/create-task' : '/tasks'} className="btn btn-cta">
            {role === 'customer' ? '+ Создать задание' : 'Найти заказы'}
          </Link>
        ) : null
      }
    >
      {isAuth && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <HeroTabs
            label="Кто я в этих заказах"
            value={role}
            onChange={(id) => setParam('role', id)}
            items={[
              { id: 'customer', label: 'Я заказчик', icon: IconCatBusiness },
              { id: 'executor', label: 'Я исполнитель', icon: IconTools },
            ]}
          />
          <div role="group" aria-label="Статус" className="flex gap-2 overflow-x-auto no-scrollbar">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setParam('filter', f.id)}
                className={`hero-chip ${filter === f.id ? 'hero-chip-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </PageHero>
  );

  if (!isAuth) {
    return (
      <>
        {hero}
        <PageBody>
          <AuthRequired
            onOpenAuth={onOpenAuth}
            title="Требуется вход"
            text="Войдите, чтобы видеть свои заказы: опубликованные вами и те, где вы исполнитель."
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {hero}
      <PageBody>
        {loading ? (
          <Spinner label="Загрузка заказов..." />
        ) : error ? (
          <ErrorState text={error} />
        ) : tasks.length === 0 ? (
          <StateCard
            dashed
            icon={IconMailOpen}
            title={EMPTY_TEXT[role][filter][0]}
            text={EMPTY_TEXT[role][filter][1]}
          >
            <Link to={role === 'customer' ? '/create-task' : '/tasks'} className="btn btn-primary">
              {role === 'customer' ? '+ Создать задание' : 'Найти заказы'}
            </Link>
            {filter !== 'all' && (
              <button type="button" className="btn btn-secondary" onClick={() => setParam('filter', 'all')}>
                Показать все
              </button>
            )}
          </StateCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tasks.map((t) => {
              const meta = STATUS_META[t.status] || { label: t.status, cls: 'bg-slate-200 text-slate-600' };
              return (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className="group flex flex-col rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`shrink-0 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <span className="font-display font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {t.budget ? `${t.budget.toLocaleString('ru-RU')} ₽` : 'По договорённости'}
                    </span>
                  </div>

                  <h3 className="mt-3 font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {t.title}
                  </h3>

                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
                    <p className="flex items-center gap-1.5 flex-wrap">
                      {role === 'customer' ? (
                        t.counterparty_name ? (
                          <><IconTools size={13} /> Исполнитель: <b className="text-slate-700 dark:text-slate-200">{t.counterparty_name}</b></>
                        ) : (
                          <><IconMessages size={13} /> Откликов: <b className="text-slate-700 dark:text-slate-200">{t.responses_count}</b></>
                        )
                      ) : (
                        <><IconBriefcase size={13} /> Заказчик: <b className="text-slate-700 dark:text-slate-200">{t.counterparty_name || '—'}</b></>
                      )}
                    </p>
                    {t.deadline && (
                      <p className="flex items-center gap-1.5"><IconCalendar size={13} /> до {formatDay(t.deadline)}</p>
                    )}
                  </div>

                  <div className="mt-auto pt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      {t.is_remote ? <IconGlobe size={13} /> : <IconPin size={13} />}
                      <span className="truncate">{t.is_remote ? 'Удалённо' : t.city || 'Город не указан'}</span>
                    </span>
                    {t.created_at && <span className="shrink-0">{formatDate(t.created_at)}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
