import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { Spinner, StateCard } from '../components/PageState.jsx';
import { IconRecycle, IconCatAuto, IconCatClothing, IconCatElectronics, IconCatHobby, IconCatHome, IconCatKids, IconCatOther, IconBox, IconCheck, IconLightning, IconPin, IconProducts, IconSearch, IconFilter } from '../components/icons.jsx';

const PRODUCT_CATEGORIES = [
  { id: 'electronics', label: 'Электроника', icon: <IconCatElectronics /> },
  { id: 'clothing', label: 'Одежда и обувь', icon: <IconCatClothing /> },
  { id: 'home', label: 'Товары для дома', icon: <IconCatHome /> },
  { id: 'hobby', label: 'Хобби и развлечения', icon: <IconCatHobby /> },
  { id: 'auto', label: 'Авто и мото', icon: <IconCatAuto /> },
  { id: 'kids', label: 'Детские товары', icon: <IconCatKids /> },
  { id: 'other', label: 'Другое', icon: <IconCatOther /> },
];

const PRODUCT_CONDITIONS = [
  { id: 'new', label: 'Новое' },
  { id: 'used', label: 'Б/У' },
];

// Цена приходит с бэкенда в рублях — в тех же единицах, что баланс,
// эскроу и комиссия. Раньше здесь делили на 100, считая её копейками,
// из-за чего витрина показывала сумму в 100 раз меньше списываемой.
const formatPrice = (priceInRubles) => (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';

const EMPTY_FILTERS = { category: null, condition: null, city: null, price_min: null, price_max: null, search: '' };

export default function ProductsPage() {
  // На телефоне фильтры занимали весь первый экран — прячем их за кнопкой.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navigate = useNavigate();
  const { products, loading, filters, setFilters, fetchProducts } = useProductsStore();

  const [localSearch, setLocalSearch] = useState(filters.search || '');

  // Ошибку сети показывает пустое состояние; здесь её достаточно погасить,
  // иначе она уходит в консоль как необработанная.
  const load = (custom) => fetchProducts(custom).catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const handleCategoryChange = (categoryId) => {
    const newCategory = filters.category === categoryId ? null : categoryId;
    setFilters({ category: newCategory });
    load({ category: newCategory });
  };

  const handleConditionChange = (conditionId) => {
    const newCondition = filters.condition === conditionId ? null : conditionId;
    setFilters({ condition: newCondition });
    load({ condition: newCondition });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters({ search: localSearch });
    load({ search: localSearch });
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setLocalSearch('');
    load(EMPTY_FILTERS);
  };

  const hasFilters = !!(filters.condition || filters.city || filters.price_min || filters.price_max);

  return (
    <>
      <PageHero
        eyebrow="Безопасная сделка на покупках"
        icon={IconProducts}
        title="Товары"
        subtitle="Продавец получит деньги только после того, как вы подтвердите получение товара."
        actions={
          <button type="button" className="btn btn-cta" onClick={() => navigate('/create-product')}>
            + Продать товар
          </button>
        }
      >
        <form className="hero-search max-w-3xl" onSubmit={handleSearch} role="search">
          <IconSearch size={18} className="ml-2.5 text-slate-400" />
          <label htmlFor="products-search" className="sr-only">Поиск товаров</label>
          <input
            id="products-search"
            type="search"
            placeholder="Поиск товаров..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="hero-search-input"
          />
          <button type="submit" className="btn btn-primary">
            Найти
          </button>
        </form>
        <div className="mt-4 flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto sm:overflow-visible no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            type="button"
            aria-pressed={!filters.category}
            onClick={() => handleCategoryChange(null)}
            className={`hero-chip ${!filters.category ? 'hero-chip-active' : ''}`}
          >
            <IconLightning /> Все товары
          </button>
          {PRODUCT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              aria-pressed={filters.category === cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              className={`hero-chip ${filters.category === cat.id ? 'hero-chip-active' : ''}`}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>
      </PageHero>

      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] items-start">
          <button
            type="button"
            className="lg:hidden btn btn-secondary justify-self-start"
            aria-expanded={filtersOpen}
            aria-controls="products-filters"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <IconFilter /> Фильтры
            {hasFilters && <span className="w-2 h-2 rounded-full bg-indigo-500" aria-label="есть активные фильтры" />}
          </button>

          {/* Фильтры */}
          <aside
            id="products-filters"
            aria-label="Фильтры"
            className={`${filtersOpen ? 'block' : 'hidden'} lg:block lg:sticky lg:top-24 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-6`}
          >
            <div>
              <h3 className="section-eyebrow">Состояние</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {PRODUCT_CONDITIONS.map((cond) => (
                  <button
                    key={cond.id}
                    type="button"
                    aria-pressed={filters.condition === cond.id}
                    className={`chip justify-center ${filters.condition === cond.id ? 'chip-active' : ''}`}
                    onClick={() => handleConditionChange(cond.id)}
                  >
                    {cond.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="section-eyebrow">Цена, ₽</h3>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="От"
                  aria-label="Цена от"
                  className="input !px-3 !py-2 text-sm"
                  value={filters.price_min ?? ''}
                  onChange={(e) => setFilters({ price_min: e.target.value ? parseInt(e.target.value, 10) : null })}
                />
                <span className="text-slate-400">—</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="До"
                  aria-label="Цена до"
                  className="input !px-3 !py-2 text-sm"
                  value={filters.price_max ?? ''}
                  onChange={(e) => setFilters({ price_max: e.target.value ? parseInt(e.target.value, 10) : null })}
                />
              </div>
              <button type="button" className="btn btn-primary w-full mt-3" onClick={() => load()}>
                Применить
              </button>
            </div>

            <div>
              <h3 className="section-eyebrow">Город</h3>
              <input
                type="text"
                placeholder="Введите город..."
                aria-label="Город"
                className="input mt-3 !py-2 text-sm"
                value={filters.city || ''}
                onChange={(e) => {
                  setFilters({ city: e.target.value });
                  load({ city: e.target.value });
                }}
              />
            </div>

            {hasFilters && (
              <button type="button" className="btn btn-ghost w-full" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            )}
          </aside>

          {/* Список товаров */}
          <div className="min-w-0">
            {loading ? (
              <Spinner label="Загрузка товаров..." />
            ) : products.length === 0 ? (
              <StateCard dashed icon={IconProducts} title="Товары не найдены" text="Попробуйте изменить параметры поиска.">
                <button type="button" className="btn btn-primary" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              </StateCard>
            ) : (
              <div className="grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3 gap-4">
                {products.map((product) => (
                  <Link
                    key={product.id}
                    to={`/products/${product.id}`}
                    className="group flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover transition-all"
                  >
                    <div className="relative aspect-[4/3] bg-gradient-to-br from-indigo-50 to-slate-100 dark:from-slate-700/60 dark:to-slate-800 overflow-hidden">
                      {product.first_image ? (
                        <img
                          src={product.first_image}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-indigo-300 dark:text-slate-500">
                          <IconBox size={40} strokeWidth={1.5} />
                        </div>
                      )}
                      <span
                        className={`absolute top-3 left-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm ${
                          product.condition === 'new'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-white/95 text-amber-700 dark:bg-slate-900/90 dark:text-amber-300'
                        }`}
                      >
                        {product.condition === 'new' ? 'Новое' : <><IconRecycle size={12} /> Б/У</>}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <p className="font-display text-lg font-bold text-slate-900 dark:text-white">{formatPrice(product.price)}</p>
                      <h3 className="mt-1 font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {product.title}
                      </h3>
                      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">{product.description}</p>
                      <div className="mt-auto pt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <IconPin size={13} />
                          <span className="truncate">{product.city || 'Не указан'}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 min-w-0 font-semibold text-slate-500 dark:text-slate-400">
                          {product.seller_verified && <IconCheck size={13} className="text-emerald-500" title="Продавец проверен" />}
                          <span className="truncate">{product.seller_name}</span>
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
