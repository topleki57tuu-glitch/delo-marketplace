import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { TaskMap } from '../components/TaskMap';
import CityInput from '../components/CityInput';
import TelegramRadarLink from '../components/TelegramRadarLink.jsx';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { Spinner, StateCard } from '../components/PageState.jsx';
import { IconCatBeauty, IconCatBusiness, IconCatCleaning, IconCatDelivery, IconCatDesign, IconCatDevelopment, IconCatEvents, IconCatOther, IconCatPhotoVideo, IconCatRepairs, IconCatTutoring, IconCatWriting, IconBriefcase, IconFilter, IconGlobe, IconLightning, IconMap, IconMessages, IconPin, IconSearch } from '../components/icons.jsx';

const CATEGORIES = [
  { id: 'all', label: 'Все категории', icon: <IconLightning /> },
  { id: 'development', label: 'Разработка сайтов и IT', icon: <IconCatDevelopment /> },
  { id: 'design', label: 'Дизайн и графика', icon: <IconCatDesign /> },
  { id: 'writing', label: 'Тексты и переводы', icon: <IconCatWriting /> },
  { id: 'repairs', label: 'Ремонт и строительство', icon: <IconCatRepairs /> },
  { id: 'cleaning', label: 'Уборка и клининг', icon: <IconCatCleaning /> },
  { id: 'delivery', label: 'Курьеры и доставка', icon: <IconCatDelivery /> },
  { id: 'photo_video', label: 'Фото и видео', icon: <IconCatPhotoVideo /> },
  { id: 'tutoring', label: 'Репетиторы', icon: <IconCatTutoring /> },
  { id: 'beauty', label: 'Красота', icon: <IconCatBeauty /> },
  { id: 'events', label: 'Мероприятия', icon: <IconCatEvents /> },
  { id: 'business', label: 'Бизнес-услуги', icon: <IconCatBusiness /> },
  { id: 'other', label: 'Другое', icon: <IconCatOther /> },
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
  const [selectedCity, setSelectedCity] = useState('');
  const [isRemoteOnly, setIsRemoteOnly] = useState(false);
  // На телефоне город, «удалённо» и сброс прячутся за кнопкой «Фильтры»:
  // раскрытая панель с 13 категориями в несколько строк занимала больше
  // экрана, и первое задание оказывалось ниже сгиба. Скрытие — классами,
  // а не условным рендером: с sm и шире всё видно как раньше.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cityQuery = selectedCity.trim().toLowerCase();
  const activeFilters = (cityQuery ? 1 : 0) + (isRemoteOnly ? 1 : 0);
  // Вид «карта» храним в URL (?view=map), чтобы на него можно было
  // вести ссылкой из нижней навигации и чтобы работала кнопка «назад».
  const showMap = searchParams.get('view') === 'map';

  const toggleMap = () => {
    const next = new URLSearchParams(searchParams);
    if (showMap) {
      next.delete('view');
    } else {
      next.set('view', 'map');
    }
    setSearchParams(next, { replace: true });
  };

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
    if (cityQuery && t.city && !t.city.toLowerCase().includes(cityQuery)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title?.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }
    return true;
  });

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCity('');
    setIsRemoteOnly(false);
    handleCategorySelect('all');
  };

  const openTask = (e, t) => {
    if (!onTaskClick) return;
    e.preventDefault();
    onTaskClick(t);
  };

  return (
    <>
      <PageHero
        eyebrow="Биржа заданий"
        icon={IconBriefcase}
        title="Задания"
        subtitle="Выбирайте задачу и предлагайте свою цену. Оплата заказчика резервируется до приёмки работы."
        actions={
          <>
            <TelegramRadarLink />
            <button
              type="button"
              onClick={toggleMap}
              aria-pressed={showMap}
              className={`btn btn-glass ${showMap ? 'btn-glass-active' : ''}`}
            >
              <IconMap />
              {showMap ? 'Скрыть карту' : 'На карте'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (user) navigate('/create-task');
                else onOpenAuth?.('register');
              }}
              className="btn btn-cta"
            >
              + Создать задание
            </button>
          </>
        }
      >
        {/* Поиск — белая плашка, как на главной */}
        <div className="hero-search max-w-3xl">
          <IconSearch size={18} className="ml-2.5 text-slate-400" />
          <label htmlFor="tasks-search" className="sr-only">Поиск заданий</label>
          <input
            id="tasks-search"
            type="search"
            placeholder="Поиск по названию или описанию..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="hero-search-input"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="tasks-extra-filters"
            className={`sm:hidden shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
              filtersOpen || activeFilters ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <IconFilter /> Фильтры
            {activeFilters > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-indigo-600 text-white text-[11px] leading-5 text-center">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Категории. На телефоне — одна прокручиваемая строка: перенос
            давал пять-шесть рядов «таблеток» над списком. */}
        <div className="mt-4 flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategorySelect(cat.id)}
                aria-pressed={active}
                className={`hero-chip ${active ? 'hero-chip-active' : ''}`}
              >
                {cat.icon}
                {cat.label}
              </button>
            );
          })}
        </div>
      </PageHero>

      <PageBody>
        {/* Найдено + город, «удалённо», сброс. На телефоне фильтры
            прячутся за кнопкой «Фильтры»: раскрытая панель занимала больше
            экрана, и первое задание оказывалось ниже сгиба. Скрытие —
            классами, а не условным рендером: с sm и шире всё видно сразу. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <p className="text-sm text-slate-500 dark:text-slate-400 shrink-0">
            Найдено заданий:{' '}
            <span className="font-bold text-slate-900 dark:text-white">{filteredTasks.length}</span>
          </p>
          <div
            id="tasks-extra-filters"
            className={`${filtersOpen ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 sm:ml-auto`}
          >
            <CityInput
              className="sm:w-72"
              value={selectedCity}
              onChange={setSelectedCity}
              placeholder="Все города (или выберите)"
            />
            <label className="inline-flex items-center gap-2 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200 select-none">
              <input
                type="checkbox"
                checked={isRemoteOnly}
                onChange={(e) => setIsRemoteOnly(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              Только удалённо
            </label>
            <button type="button" onClick={resetFilters} className="btn btn-ghost">
              Сбросить фильтры
            </button>
          </div>
        </div>

        {/* Карта (по кнопке «На карте») */}
        {showMap && (
          <div className="mb-8 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden h-96">
            <TaskMap tasks={filteredTasks} onTaskClick={onTaskClick} />
          </div>
        )}

        {loading ? (
          <Spinner label="Загрузка заданий..." />
        ) : filteredTasks.length === 0 ? (
          <StateCard
            dashed
            icon={IconSearch}
            title="Ничего не найдено"
            text="Попробуйте изменить параметры поиска или сбросить фильтры."
          >
            <button type="button" onClick={resetFilters} className="btn btn-primary">
              Сбросить фильтры
            </button>
          </StateCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTasks.map((t) => (
              <Link
                key={t.id}
                to={`/tasks/${t.id}`}
                onClick={(e) => openTask(e, t)}
                className="group flex flex-col rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold px-2.5 py-1">
                    {CATEGORIES.find((c) => c.id === t.category)?.label || t.category}
                  </span>
                  <span className="font-display font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {t.budget ? `${t.budget.toLocaleString('ru-RU')} ₽` : 'По договоренности'}
                  </span>
                </div>

                <h3 className="mt-3 font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {t.title}
                </h3>

                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 line-clamp-3">
                  {t.description}
                </p>

                <div className="mt-auto pt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    {t.is_remote ? <IconGlobe size={13} /> : <IconPin size={13} />}
                    <span className="truncate">{t.is_remote ? 'Удалённо' : t.city || 'Город не указан'}</span>
                  </span>
                  <span className="inline-flex items-center gap-3 shrink-0">
                    {t.responses_count !== undefined && (
                      <span className="inline-flex items-center gap-1 font-semibold text-indigo-500 dark:text-indigo-400" title="Откликов">
                        <IconMessages size={13} /> {t.responses_count}
                      </span>
                    )}
                    <span className="font-semibold group-hover:text-indigo-500 transition-colors">Подробнее →</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
