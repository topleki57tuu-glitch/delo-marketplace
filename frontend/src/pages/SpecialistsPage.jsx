import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import CityInput from '../components/CityInput';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { Spinner, StateCard } from '../components/PageState.jsx';
import { IconBriefcase, IconMessages, IconPin, IconCheck, IconSearch, IconSparkles, IconStar, IconUsers } from '../components/icons.jsx';

// Раньше сортировка была выпадающим списком с иконками внутри <option> —
// браузер такое не рисует (в option допустим только текст), а «🆕» в
// последнем пункте выбивался из набора иконок. Теперь это «таблетки».
const SORT_OPTIONS = [
  { id: 'rating', label: 'По рейтингу', icon: IconStar },
  { id: 'completed', label: 'По выполненным заказам', icon: IconCheck },
  { id: 'reviews', label: 'По отзывам', icon: IconMessages },
  { id: 'newest', label: 'Новые', icon: IconSparkles },
];

const PER_PAGE = 12;

export default function SpecialistsPage({ user, onOpenAuth }) {
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [city, setCity] = useState('');
  const [sort, setSort] = useState('rating');

  const fetchSpecialists = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort });
      if (search.trim()) params.set('search', search.trim());
      if (city.trim()) params.set('city', city.trim());

      const res = await fetch(`/specialists/?${params.toString()}`);
      if (!res.ok) throw new Error('Не удалось загрузить специалистов');
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, city, sort]);

  useEffect(() => {
    fetchSpecialists();
  }, [fetchSpecialists]);

  // Debounce поиска
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Город набирают по буквам — запрос уходит, когда ввод затих
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setCity(cityInput);
    }, 400);
    return () => clearTimeout(t);
  }, [cityInput]);

  return (
    <>
      <PageHero
        eyebrow="Каталог исполнителей"
        icon={IconUsers}
        title="Специалисты"
        subtitle="Исполнители с рейтингом, отзывами и портфолио. Напишите специалисту напрямую или опубликуйте задание — откликнутся сами."
        actions={
          <>
            <Link to="/tasks" className="btn btn-glass">
              <IconBriefcase /> К заданиям
            </Link>
            <button
              type="button"
              onClick={() => (user ? navigate('/create-task') : onOpenAuth?.('register'))}
              className="btn btn-cta"
            >
              + Создать задание
            </button>
          </>
        }
      >
        <div className="hero-search max-w-3xl">
          <IconSearch size={18} className="ml-2.5 text-slate-400" />
          <label htmlFor="specialists-search" className="sr-only">Поиск специалистов</label>
          <input
            id="specialists-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Имя, навык или описание..."
            className="hero-search-input"
          />
        </div>
        <div role="group" aria-label="Сортировка" className="mt-4 flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
          {SORT_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={sort === id}
              onClick={() => { setSort(id); setPage(1); }}
              className={`hero-chip ${sort === id ? 'hero-chip-active' : ''}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </PageHero>

      <PageBody>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <p className="text-sm text-slate-500 dark:text-slate-400 shrink-0">
            Найдено: <span className="font-bold text-slate-900 dark:text-white">{total}</span>
          </p>
          <CityInput
            className="sm:w-72 sm:ml-auto"
            value={cityInput}
            onChange={setCityInput}
            placeholder="Все города"
          />
        </div>

        {loading ? (
          <Spinner label="Загрузка специалистов..." />
        ) : items.length === 0 ? (
          <StateCard
            dashed
            icon={IconSearch}
            title="Специалисты не найдены"
            text="Попробуйте изменить запрос или снять фильтры."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((s) => {
                let skills = [];
                try { skills = s.skills ? JSON.parse(s.skills) : []; } catch (e) { skills = []; }
                return (
                  <Link
                    key={s.id}
                    to={`/specialist/${s.id}`}
                    className="group flex flex-col gap-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-extrabold text-lg flex items-center justify-center overflow-hidden">
                          {s.avatar ? (
                            <img src={s.avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            (s.name ? s.name[0].toUpperCase() : 'S')
                          )}
                        </div>
                        {s.online && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full" title="Онлайн" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{s.name || 'Специалист'}</span>
                          {s.is_pro && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">PRO</span>
                          )}
                          {s.verified && <IconCheck size={14} className="text-sky-500" title="Проверен" />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <IconStar size={13} className="text-amber-400" />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{s.rating != null ? s.rating.toFixed(1) : '—'}</span>
                          <span>· {s.reviews_count} отзывов · {s.completed_tasks} заказов</span>
                        </div>
                      </div>
                    </div>

                    {s.bio && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{s.bio}</p>
                    )}

                    {skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {skills.slice(0, 4).map((sk, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700/70 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            {sk}
                          </span>
                        ))}
                        {skills.length > 4 && (
                          <span className="px-2 py-0.5 text-[11px] text-slate-400">+{skills.length - 4}</span>
                        )}
                      </div>
                    )}

                    <p className="mt-auto pt-1 text-xs text-slate-400 flex items-center gap-1.5">
                      <IconPin size={13} /> {s.city || 'Город не указан'}
                    </p>
                  </Link>
                );
              })}
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn btn-secondary"
                >
                  ← Назад
                </button>
                <span className="text-sm text-slate-500 dark:text-slate-400 px-2">
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="btn btn-secondary"
                >
                  Вперёд →
                </button>
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
