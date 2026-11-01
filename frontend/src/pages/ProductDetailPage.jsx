import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useDocumentTitle } from '../components/RouteMeta.jsx';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { Spinner, StateCard } from '../components/PageState.jsx';
import { productCategoryLabel } from '../constants/categories.js';
import { IconRecycle, IconBox, IconCheck, IconDelivery, IconEdit, IconLock, IconPin, IconProducts, IconPurchases, IconStar, IconUser } from '../components/icons.jsx';

// Цена приходит с бэкенда в рублях (см. комментарий в ProductsPage).
const formatPrice = (priceInRubles) => (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';

function parseImages(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export default function ProductDetailPage({ onOpenAuth }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { currentProduct, fetchProduct, createOrder } = useProductsStore();
  const { user, token } = useAuthStore();
  const product = currentProduct && String(currentProduct.id) === String(id) ? currentProduct : null;
  useDocumentTitle(product ? product.title : null);

  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  // Раньше при ошибке загрузки (например, товар удалён) страница навсегда
  // оставалась на «Загрузка...»: запрос падал, а товара так и не было.
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
    setActiveImage(0);
    fetchProduct(id).catch(() => setLoadError(true));
  }, [id]);

  // Если товар доступен только с доставкой, способ по умолчанию — доставка
  useEffect(() => {
    if (product?.delivery_options === 'delivery') setDeliveryMethod('delivery');
  }, [product?.delivery_options]);

  if (loadError) {
    return (
      <>
        <PageHero size="sm" back={{ to: '/products', label: 'Все товары' }} title="Товар не найден" />
        <PageBody>
          <StateCard icon={IconProducts} title="Такого товара нет" text="Возможно, продавец снял его с продажи или ссылка устарела.">
            <Link to="/products" className="btn btn-primary">Перейти к товарам</Link>
          </StateCard>
        </PageBody>
      </>
    );
  }

  if (!product) {
    return (
      <>
        <PageHero
          size="sm"
          back={{ to: '/products', label: 'Все товары' }}
          title={<span aria-hidden="true" className="inline-block h-8 w-72 max-w-full rounded-lg bg-white/10 animate-pulse align-middle" />}
        />
        <PageBody>
          <Spinner label="Загрузка товара..." />
        </PageBody>
      </>
    );
  }

  const isOwner = !!user && user.id === product.seller_id;
  const canOrder = !!user && !isOwner && product.stock > 0;
  const pickup = product.delivery_options === 'both' || product.delivery_options === 'pickup';
  const delivery = product.delivery_options === 'both' || product.delivery_options === 'delivery';
  const images = parseImages(product.images);
  const totalPrice = product.price * quantity;

  const handleOrder = async () => {
    if (!token) {
      onOpenAuth?.('login');
      return;
    }
    if (deliveryMethod === 'delivery' && !deliveryAddress.trim()) {
      addToast('Укажите адрес доставки', 'error');
      return;
    }

    setOrdering(true);
    try {
      await createOrder({
        product_id: product.id,
        quantity,
        delivery_method: deliveryMethod,
        delivery_address: deliveryMethod === 'delivery' ? deliveryAddress : null,
      }, token);

      addToast('Заказ создан: деньги зарезервированы до получения товара. Ожидайте подтверждения продавца.', 'success');
      navigate('/my-orders');
    } catch (error) {
      addToast(error.message || 'Ошибка при создании заказа', 'error');
    } finally {
      setOrdering(false);
    }
  };

  const conditionBadge = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
        product.condition === 'new'
          ? 'bg-emerald-400/15 text-emerald-300'
          : 'bg-amber-400/15 text-amber-200'
      }`}
    >
      {product.condition === 'new' ? 'Новое' : <><IconRecycle size={12} /> Б/У</>}
    </span>
  );

  return (
    <>
      <PageHero
        size="sm"
        back={{ to: '/products', label: 'Все товары' }}
        eyebrow={productCategoryLabel(product.category)}
        icon={IconProducts}
        title={product.title}
        titleClassName="hero-title-sm"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {conditionBadge}
            {product.stock > 0 ? (
              <span className="text-sm text-slate-300">В наличии: {product.stock} шт.</span>
            ) : (
              <span className="text-sm font-semibold text-red-300">Нет в наличии</span>
            )}
            {product.city && (
              <span className="inline-flex items-center gap-1 text-sm text-slate-300">
                <IconPin size={14} /> {product.city}
              </span>
            )}
          </span>
        }
        aside={
          <div className="hero-stat sm:min-w-[18rem]">
            <p className="hero-stat-label">Цена</p>
            <p className="hero-stat-value !text-[1.75rem] sm:!text-[2rem]">{formatPrice(product.price)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {isOwner ? (
                <>
                  <button type="button" className="btn btn-cta" onClick={() => navigate(`/products/${product.id}/edit`)}>
                    <IconEdit /> Редактировать
                  </button>
                  <Link to="/my-products" className="btn btn-glass">
                    <IconBox /> Мои товары
                  </Link>
                </>
              ) : canOrder ? (
                <button
                  type="button"
                  className="btn btn-cta w-full"
                  aria-expanded={showOrderForm}
                  aria-controls="order-form"
                  onClick={() => setShowOrderForm((v) => !v)}
                >
                  <IconPurchases /> {showOrderForm ? 'Скрыть оформление' : 'Купить'}
                </button>
              ) : !user ? (
                <button type="button" className="btn btn-cta w-full" onClick={() => onOpenAuth?.('login')}>
                  Войдите, чтобы купить
                </button>
              ) : (
                <p className="text-sm text-slate-400">Товар закончился</p>
              )}
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
              <IconLock size={13} className="mt-0.5 text-emerald-400" />
              Оплата резервируется до получения товара
            </p>
          </div>
        }
      />

      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start">
          {/* Галерея и описание */}
          <div className="space-y-6 min-w-0">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
              <div className="aspect-[4/3] bg-gradient-to-br from-indigo-50 to-slate-100 dark:from-slate-700/60 dark:to-slate-800 flex items-center justify-center">
                {images.length > 0 ? (
                  <img src={images[Math.min(activeImage, images.length - 1)]} alt={product.title} className="w-full h-full object-contain" />
                ) : (
                  <IconBox size={64} strokeWidth={1.25} className="text-indigo-300 dark:text-slate-500" />
                )}
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 p-3 overflow-x-auto no-scrollbar border-t border-slate-100 dark:border-slate-700">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveImage(idx)}
                      aria-label={`Фото ${idx + 1}`}
                      aria-pressed={idx === activeImage}
                      className={`w-16 h-16 shrink-0 rounded-xl overflow-hidden border-2 transition-colors ${
                        idx === activeImage ? 'border-indigo-500' : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6">
              <h2 className="section-title">Описание</h2>
              <p className="mt-3 text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">
                {product.description}
              </p>
            </section>
          </div>

          {/* Продавец, получение, оформление */}
          <div className="space-y-4 min-w-0 lg:sticky lg:top-24">
            {showOrderForm && canOrder && (
              <section id="order-form" className="rounded-2xl border border-indigo-200 dark:border-indigo-500/40 bg-white dark:bg-slate-800 p-5 sm:p-6 shadow-card">
                <h2 className="section-title">Оформление заказа</h2>

                <label className="block mt-4">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Количество</span>
                  <input
                    type="number"
                    min="1"
                    max={product.stock}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(product.stock, parseInt(e.target.value, 10) || 1)))}
                    className="input mt-1.5 max-w-[8rem]"
                  />
                </label>

                <fieldset className="mt-4">
                  <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">Способ получения</legend>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {pickup && (
                      <label className={`chip justify-center !py-2.5 ${deliveryMethod === 'pickup' ? 'chip-active' : ''}`}>
                        <input type="radio" name="delivery" value="pickup" className="sr-only" checked={deliveryMethod === 'pickup'} onChange={(e) => setDeliveryMethod(e.target.value)} />
                        <IconPin /> Самовывоз
                      </label>
                    )}
                    {delivery && (
                      <label className={`chip justify-center !py-2.5 ${deliveryMethod === 'delivery' ? 'chip-active' : ''}`}>
                        <input type="radio" name="delivery" value="delivery" className="sr-only" checked={deliveryMethod === 'delivery'} onChange={(e) => setDeliveryMethod(e.target.value)} />
                        <IconDelivery /> Доставка
                      </label>
                    )}
                  </div>
                </fieldset>

                {deliveryMethod === 'delivery' && (
                  <label className="block mt-4">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Адрес доставки</span>
                    <textarea
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Город, улица, дом, квартира"
                      rows="3"
                      className="textarea mt-1.5"
                    />
                  </label>
                )}

                <dl className="mt-5 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-4 text-sm space-y-2">
                  <div className="flex justify-between gap-3 text-slate-500 dark:text-slate-400">
                    <dt>Товар ({quantity} шт.)</dt>
                    <dd>{formatPrice(totalPrice)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 font-bold text-slate-900 dark:text-white">
                    <dt>Итого</dt>
                    <dd className="font-display">{formatPrice(totalPrice)}</dd>
                  </div>
                  <p className="pt-1 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
                    <IconLock size={13} className="mt-0.5 text-emerald-500" />
                    Деньги будут зарезервированы до получения товара
                  </p>
                </dl>

                <button type="button" className="btn btn-primary w-full mt-4 !py-3" onClick={handleOrder} disabled={ordering}>
                  {ordering ? 'Оформление...' : `Купить за ${formatPrice(totalPrice)}`}
                </button>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <h2 className="section-eyebrow">Продавец</h2>
              <div className="mt-3 flex items-center gap-3">
                <span className="w-12 h-12 shrink-0 rounded-2xl overflow-hidden bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                  {product.seller_avatar ? (
                    <img src={product.seller_avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <IconUser size={22} />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span className="truncate">{product.seller_name}</span>
                    {product.seller_verified && <IconCheck size={15} className="text-emerald-500" title="Продавец проверен" />}
                  </p>
                  {product.seller_rating ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <IconStar size={13} className="text-amber-400" /> {product.seller_rating} · {product.seller_reviews_count} отзывов
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Пока без отзывов</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <h2 className="section-eyebrow">Получение</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {pickup && <span className="chip !cursor-default"><IconPin /> Самовывоз</span>}
                {delivery && <span className="chip !cursor-default"><IconDelivery /> Доставка</span>}
              </div>
              {product.city && (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <IconPin size={14} /> {product.city}
                </p>
              )}
            </section>
          </div>
        </div>
      </PageBody>
    </>
  );
}
