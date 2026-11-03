import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import { useDialogs } from '../components/DialogProvider.jsx';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { AuthRequired, Spinner, StateCard } from '../components/PageState.jsx';
import { productCategoryLabel } from '../constants/categories.js';
import { IconRecycle, IconTrash, IconBox, IconEdit, IconEye, IconPin, IconProducts } from '../components/icons.jsx';

const STATUS = {
  active: { label: 'Активен', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  sold_out: { label: 'Нет в наличии', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  removed: { label: 'Снят с продажи', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

// Цена приходит с бэкенда в рублях (см. комментарий в ProductsPage).
const formatPrice = (priceInRubles) => (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';

export default function MyProductsPage({ onOpenAuth }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const { myProducts, loading, fetchMyProducts, deleteProduct } = useProductsStore();
  const { user, token } = useAuthStore();

  const [deleting, setDeleting] = useState({});

  // В зависимостях — id, а не весь user: профиль в App перечитывается
  // регулярно, и список товаров перезагружался вместе с ним.
  const userId = user?.id;
  useEffect(() => {
    if (token && userId) {
      // Отдельный эндпоинт: отдаёт все товары продавца, включая распроданные
      // и снятые с продажи. Общий список содержит только активные позиции.
      fetchMyProducts(token).catch(() => {});
    }
  }, [token, userId]);

  const total = myProducts.length;
  const active = myProducts.filter((p) => p.status === 'active').length;
  const inStock = myProducts.reduce((sum, p) => sum + (p.stock || 0), 0);

  const hero = (
    <PageHero
      eyebrow="Кабинет продавца"
      icon={IconProducts}
      title="Мои товары"
      subtitle="Все ваши объявления — активные, распроданные и снятые с продажи."
      actions={
        user && token ? (
          <>
            <Link to="/products" className="btn btn-glass">К каталогу</Link>
            <Link to="/create-product" className="btn btn-cta">+ Добавить товар</Link>
          </>
        ) : null
      }
    >
      {user && token && total > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-xl">
          <div className="hero-stat">
            <p className="hero-stat-label">Всего</p>
            <p className="hero-stat-value">{total}</p>
          </div>
          <div className="hero-stat">
            <p className="hero-stat-label">Активных</p>
            <p className="hero-stat-value">{active}</p>
          </div>
          <div className="hero-stat">
            <p className="hero-stat-label">В наличии, шт.</p>
            <p className="hero-stat-value">{inStock}</p>
          </div>
        </div>
      )}
    </PageHero>
  );

  if (!user || !token) {
    return (
      <>
        {hero}
        <PageBody>
          <AuthRequired onOpenAuth={onOpenAuth} text="Войдите, чтобы управлять своими товарами." />
        </PageBody>
      </>
    );
  }

  const handleDelete = async (productId, productTitle) => {
    const ok = await dialogs.confirm({
      title: 'Удалить товар?',
      message: `«${productTitle}» пропадёт из каталога.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    setDeleting((prev) => ({ ...prev, [productId]: true }));
    try {
      await deleteProduct(productId, token);
      addToast('Товар удалён', 'success');
    } catch (error) {
      addToast(error.message || 'Ошибка при удалении', 'error');
    } finally {
      setDeleting((prev) => ({ ...prev, [productId]: false }));
    }
  };

  return (
    <>
      {hero}
      <PageBody>
        {loading ? (
          <Spinner label="Загрузка товаров..." />
        ) : total === 0 ? (
          <StateCard dashed icon={IconBox} title="У вас пока нет товаров" text="Создайте первое объявление — оплата покупателя будет защищена безопасной сделкой.">
            <Link to="/create-product" className="btn btn-primary">+ Добавить товар</Link>
          </StateCard>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {myProducts.map((product) => {
              const status = STATUS[product.status] || { label: product.status, cls: STATUS.removed.cls };
              const isDeleting = !!deleting[product.id];
              return (
                <article key={product.id} className="flex gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                  <Link
                    to={`/products/${product.id}`}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-50 to-slate-100 dark:from-slate-700/60 dark:to-slate-800 flex items-center justify-center text-indigo-300 dark:text-slate-500"
                  >
                    {product.first_image ? <img src={product.first_image} alt="" className="w-full h-full object-cover" /> : <IconBox size={30} />}
                    {product.condition !== 'new' && (
                      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-white/95 dark:bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                        <IconRecycle size={10} /> Б/У
                      </span>
                    )}
                  </Link>

                  <div className="min-w-0 flex-1 flex flex-col">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link to={`/products/${product.id}`} className="font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                        {product.title}
                      </Link>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
                    </div>
                    <p className="mt-1 font-display font-bold text-slate-900 dark:text-white">{formatPrice(product.price)}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                      <span>{productCategoryLabel(product.category)}</span>
                      <span>В наличии: {product.stock} шт.</span>
                      <span className="inline-flex items-center gap-1"><IconPin size={12} /> {product.city || 'Город не указан'}</span>
                    </p>
                    <div className="mt-auto pt-3 flex flex-wrap gap-2">
                      <Link to={`/products/${product.id}`} className="btn btn-secondary !px-3 !py-1.5 !text-xs">
                        <IconEye /> Просмотр
                      </Link>
                      <Link to={`/products/${product.id}/edit`} className="btn btn-secondary !px-3 !py-1.5 !text-xs">
                        <IconEdit /> Редактировать
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost !px-3 !py-1.5 !text-xs text-red-600 dark:text-red-400"
                        onClick={() => handleDelete(product.id, product.title)}
                        disabled={isDeleting}
                      >
                        <IconTrash /> {isDeleting ? 'Удаление...' : 'Удалить'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
