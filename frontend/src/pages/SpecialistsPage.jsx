import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import CityInput from '../components/CityInput';

const SORT_OPTIONS = [
  { id: 'rating', label: '⭐ По рейтингу' },
  { id: 'completed', label: '✅ По выполненным заказам' },
  { id: 'reviews', label: '💬 По числу отзывов' },
  { id: 'newest', label: '🆕 Новые' },
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
  const [city, setCity] = useState(null);
  const [sort, setSort] = useState('rating');

  const fetchSpecialists = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort });
      if (search.trim()) params.set('search', search.trim());
      if (city?.name) params.set('city', city.name);

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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 pb-24 pt-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Поиск специалистов
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Найдено: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{total}</span>
          </p>
        </div>
        <Link
          to="/tasks"
          className="self-start md:self-auto px-4 py-2 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
        >
          ⚡ К заданиям
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="🔍 Имя, навык или описание..."
          className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <CityInput selectedCity={city} onSelectCity={(c) => { setCity(c); setPage(1); }} placeholder="Город" />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl border border-slate-200 dark:border-slate-700 text-center space-y-3">
          <div className="text-4xl">🔍</div>
          <p className="font-bold text-slate-900 dark:text-white">Специалисты не найдены</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Попробуйте изменить запрос или снять фильтры.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((s) => {
              let skills = [];
              try { skills = s.skills ? JSON.parse(s.skills) : []; } catch (e) { skills = []; }
              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/specialist/${s.id}`)}
                  className="text-left bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-extrabold text-lg flex items-center justify-center">
                        {s.avatar ? (
                          <img src={s.avatar} alt={s.name || 'S'} className="w-full h-full object-cover rounded-2xl" />
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
                        <span className="font-bold text-slate-900 dark:text-white text-sm truncate">{s.name || 'Специалист'}</span>
                        {s.is_pro && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">PRO</span>
                        )}
                        {s.verified && <span className="text-blue-500 text-xs" title="Проверен">✓</span>}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        ⭐ {s.rating != null ? s.rating.toFixed(1) : '—'} • {s.reviews_count} отзывов • {s.completed_tasks} заказов
                      </div>
                    </div>
                  </div>

                  {s.bio && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">{s.bio}</p>
                  )}

                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {skills.slice(0, 4).map((sk, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded-full text-[10px] font-medium text-slate-600 dark:text-slate-300">
                          {sk}
                        </span>
                      ))}
                      {skills.length > 4 && (
                        <span className="px-2 py-0.5 text-[10px] text-slate-400">+{skills.length - 4}</span>
                      )}
                    </div>
                  )}

                  <div className="text-[11px] text-slate-400">
                    {s.city ? `📍 ${s.city}` : '📍 Город не указан'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
              >
                ← Назад
              </button>
              <span className="text-sm text-slate-500 dark:text-slate-400 px-2">
                {page} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
              >
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
