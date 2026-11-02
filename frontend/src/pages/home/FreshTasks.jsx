import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowRight, IconGlobe, IconPin } from '../../components/icons.jsx';
import { taskCategoryLabel } from '../../constants/categories.js';
import { parseServerDate, postedAgoLabel } from '../../utils/format.js';
import SectionTitle from './SectionTitle.jsx';
import { delay, revealRef, useDocumentVisible, useFlip, useInView } from './motion.js';

const TASKS_URL = '/tasks/?status_filter=open&page=1&per_page=6';
export const POLL_MS = 60_000;
const FRESH_MS = 15 * 60_000; // моложе 15 минут — зелёная метка «только что / 5 минут назад»

function formatBudget(v) {
  return v ? `${Number(v).toLocaleString('ru-RU')} ₽` : 'Договорная';
}

/**
 * Последние открытые задания. Пока блок на экране и вкладка открыта,
 * список обновляется раз в минуту (не чаще: запрос с page не кэшируется
 * на сервере). Задания, появившиеся после первой загрузки, попадают в
 * arrived — их карточка «въезжает» с подсветкой. Ошибка обновления
 * не стирает уже показанный список.
 */
export function useLatestTasks(live) {
  const [state, setState] = useState({ loading: true, tasks: [], arrived: [], now: Date.now() });
  const known = useRef(null);
  const loadedAt = useRef(0);

  const load = useCallback((signal) => {
    loadedAt.current = Date.now();
    return fetch(TASKS_URL, { signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (signal.aborted) return;
        if (!d) {
          setState((s) => ({ ...s, loading: false }));
          return;
        }
        const list = (Array.isArray(d) ? d : d?.tasks || []).filter((t) => t.status === 'open').slice(0, 6);
        const seen = known.current;
        const fresh = seen ? list.filter((t) => !seen.has(t.id)).map((t) => t.id) : [];
        known.current = new Set([...(seen || []), ...list.map((t) => t.id)]);
        setState((s) => ({
          loading: false,
          tasks: list,
          arrived: fresh.length ? [...s.arrived, ...fresh] : s.arrived,
          now: Date.now(),
        }));
      })
      .catch(() => {
        if (!signal.aborted) setState((s) => ({ ...s, loading: false }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!live) return undefined;
    const controller = new AbortController();
    // Вернулись к блоку после перерыва — сразу освежаем, не ждём минуту.
    if (loadedAt.current && Date.now() - loadedAt.current >= POLL_MS) load(controller.signal);
    const timer = setInterval(() => load(controller.signal), POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [live, load]);

  return state;
}

export default function FreshTasks() {
  const [ref, inView] = useInView({ rootMargin: '120px 0px' });
  const pageVisible = useDocumentVisible();
  const { loading, tasks, arrived, now } = useLatestTasks(inView && pageVisible);
  const grid = useRef(null);
  useFlip(grid, tasks.map((t) => t.id).join());

  if (!loading && tasks.length === 0) return null;

  return (
    <section ref={ref} className="bg-slate-50 dark:bg-slate-950/40 border-y border-slate-100 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
        <div data-reveal ref={revealRef} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <SectionTitle
            className="home-rv"
            eyebrow={
              <span className="inline-flex items-center gap-2">
                <span className="home-live-dot" aria-hidden="true" /> Прямо сейчас
              </span>
            }
            title="Свежие задания"
            text="Открытые заказы, на которые можно откликнуться."
          />
          <Link
            to="/tasks"
            style={delay(1, 100)}
            className="home-rv inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:gap-2.5 transition-all"
          >
            Все задания <IconArrowRight size={16} />
          </Link>
        </div>
        <div ref={grid} className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="home-skeleton h-40 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
              ))
            : tasks.map((t, i) => {
                const isArrived = arrived.includes(t.id);
                const created = parseServerDate(t.created_at);
                const isFresh = isArrived || (created && now - created.getTime() < FRESH_MS);
                const ago = postedAgoLabel(t.created_at, now);
                return (
                  <Link
                    key={t.id}
                    data-flip={t.id}
                    ref={isArrived ? undefined : revealRef}
                    data-reveal={isArrived ? undefined : ''}
                    to={`/tasks/${t.id}`}
                    style={delay(i % 3, 90)}
                    className={`${i >= 3 ? 'hidden sm:flex' : 'flex'} ${isArrived ? 'home-task-new' : 'home-rv'} home-lift group flex-col rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold px-2.5 py-1">
                        {taskCategoryLabel(t.category)}
                      </span>
                      <span className="font-display font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatBudget(t.budget)}</span>
                    </div>
                    <p className="mt-3 font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {t.title}
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">{t.description}</p>
                    <p className="mt-auto pt-4 text-xs text-slate-400 flex items-center gap-1.5">
                      {t.is_remote ? <IconGlobe size={13} /> : <IconPin size={13} />}
                      <span className="truncate">{t.is_remote ? 'Удалённо' : t.city || 'Город не указан'}</span>
                      {isFresh && ago ? (
                        <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold px-2 py-0.5">
                          <span className="home-live-dot" aria-hidden="true" /> {ago}
                        </span>
                      ) : (
                        ago && <span className="ml-auto shrink-0">{ago}</span>
                      )}
                    </p>
                  </Link>
                );
              })}
        </div>
      </div>
    </section>
  );
}
