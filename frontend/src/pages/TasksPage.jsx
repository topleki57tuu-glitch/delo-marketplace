import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { TaskMap } from '../components/TaskMap';
import CityInput from '../components/CityInput';

const CATEGORIES = [
  { id: 'all', label: 'Все категории', icon: '⚡' },
  { id: 'development', label: 'Разработка сайтов и IT', icon: '💻' },
  { id: 'design', label: 'Дизайн и графика', icon: '🎨' },
  { id: 'repairs', label: 'Ремонт и строительство', icon: '🔨' },
  { id: 'cleaning', label: 'Уборка и клининг', icon: '✨' },
  { id: 'delivery', label: 'Курьеры и доставка', icon: '🚚' },
  { id: 'photo_video', label: 'Фото и видео', icon: '📷' },
  { id: 'tutoring', label: 'Репетиторы', icon: '📚' },
  { id: 'beauty', label: 'Красота', icon: '💅' },
  { id: 'events', label: 'Мероприятия', icon: '🎉' },
  { id: 'business', label: 'Бизнес-услуги', icon: '💼' },
  { id: 'other', label: 'Другое', icon: '📦' },
];

export default function TasksPage({
  tasks = [],
  loading = false,
  user,
  onOpenAuth,
  onTaskClick,
  onFilterChange
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const selectedCategory = searchParams.get('category') || 'all';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState(null);
  const [isRemoteOnly, setIsRemoteOnly] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const handleCategorySelect = (catId) => {
    if (catId === 'all') {
      searchParams.delete('category');
      setSearchParams(searchParams);
    } else {
      setSearchParams({ ...Object.fromEntries(searchParams.entries()), category: catId });
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
    if (isRemoteOnly && !t.is_remote) return false;
    if (selectedCity && t.city && !t.city.toLowerCase().includes(selectedCity.name.toLowerCase())) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title?.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 pb-24 pt-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Задания и поиск заказов
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Найдено заданий: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{filteredTasks.length}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowMap(!showMap)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all flex items-center gap-2 ${
              showMap
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <span>🗺️</span>
            <span>{showMap ? 'Скрыть карту' : 'Показать на карте'}</span>
          </button>

          <button
            onClick={() => {
              if (user) {
                navigate('/create-task');
              } else {
                onOpenAuth('register');
              }
            }}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm shadow-md shadow-amber-500/20 transition-all"
          >
            + Создать задание
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm mb-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Поиск по названию или описанию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="absolute left-3 top-3 text-slate-400">🔍</span>
          </div>

          {/* City Input */}
          <div>
            <CityInput
              selectedCity={selectedCity}
              onSelectCity={(city) => setSelectedCity(city)}
              placeholder="Все города (или выберите)"
            />
          </div>

          {/* Remote Checkbox */}
          <div className="flex items-center px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
            <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
              <input
                type="checkbox"
                checked={isRemoteOnly}
                onChange={(e) => setIsRemoteOnly(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span>Только удаленно (онлайн)</span>
            </label>
          </div>

          {/* Clear Filters */}
          <div className="flex items-center">
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCity(null);
                setIsRemoteOnly(false);
                handleCategorySelect('all');
              }}
              className="w-full py-2.5 px-4 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              Сбросить фильтры
            </button>
          </div>
        </div>

        {/* Categories Chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none pt-2 border-t border-slate-100 dark:border-slate-700/50">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Map View (Toggleable) */}
      {showMap && (
        <div className="mb-8 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden h-96">
          <TaskMap tasks={filteredTasks} onTaskClick={onTaskClick} />
        </div>
      )}

      {/* Tasks List */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-400">Загрузка заданий...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="py-16 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-1">Ничего не найдено</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
            Попробуйте изменить параметры поиска или сбросить фильтры.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCity(null);
              setIsRemoteOnly(false);
              handleCategorySelect('all');
            }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-500 transition-colors"
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTasks.map((t) => (
            <div
              key={t.id}
              onClick={() => {
                if (onTaskClick) onTaskClick(t);
                else navigate(`/tasks/${t.id}`);
              }}
              className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-sm hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-500 transition-all cursor-pointer flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                    {CATEGORIES.find((c) => c.id === t.category)?.label || t.category}
                  </span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {t.budget ? `${t.budget.toLocaleString('ru-RU')} ₽` : 'По договоренности'}
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2 mb-2">
                  {t.title}
                </h3>

                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 line-clamp-3 mb-4">
                  {t.description}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span>📍</span>
                  <span>{t.is_remote ? 'Удаленно' : t.city || 'Город не указан'}</span>
                </div>
                <div className="flex items-center gap-2">
                  {t.responses_count !== undefined && (
                    <span className="text-indigo-500 font-medium">💬 {t.responses_count}</span>
                  )}
                  <span className="text-slate-400 group-hover:translate-x-0.5 transition-transform">
                    Подробнее &rarr;
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
