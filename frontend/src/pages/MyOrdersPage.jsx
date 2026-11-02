import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import { useDialogs } from '../components/DialogProvider.jsx';
import PageHero, { HeroTabs, PageBody } from '../components/PageHero.jsx';
import { AuthRequired, Spinner, StateCard } from '../components/PageState.jsx';
import { IconBox, IconPin, IconCatDelivery, IconClose, IconCheck, IconDelivery, IconProducts, IconPurchases, IconReceipt, IconWallet, IconWarning } from '../components/icons.jsx';

const ORDER_STATUS = {
  pending: { label: 'Ожидает подтверждения', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  confirmed: { label: 'Подтверждён', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  shipped: { label: 'Отправлен', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  delivered: { label: 'Доставлен', cls: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300' },
  completed: { label: 'Завершён', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  disputed: { label: 'Спор', cls: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  cancelled: { label: 'Отменён', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

// Цена приходит с бэкенда в рублях (см. комментарий в ProductsPage).
const formatPrice = (priceInRubles) => (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-semibold text-slate-800 dark:text-slate-100 min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default function MyOrdersPage({ onOpenAuth }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const { orders, loading, fetchOrders, confirmOrder, shipOrder, completeOrder, cancelOrder, openOrderDispute } = useProductsStore();
  const { token, user } = useAuthStore();

  // Вкладка — в адресе (?tab=sales): на неё ведут уведомления о новом заказе.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'sales' ? 'sales' : 'purchases';
  const setActiveTab = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'purchases') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };
  const [trackingNumber, setTrackingNumber] = useState({});
  const [actionLoading, setActionLoading] = useState({});

  useEffect(() => {
    if (token) fetchOrders(token);
  }, [token]);

  const hero = (children) => (
    <PageHero
      eyebrow="Товары"
      icon={IconReceipt}
      title="Покупки и продажи"
      subtitle="Заказы товаров через безопасную сделку: деньги покупателя зарезервированы, пока он не подтвердит получение."
      actions={
        <Link to="/products" className="btn btn-glass">
          <IconProducts /> К товарам
        </Link>
      }
    >
      {children}
    </PageHero>
  );

  if (!user || !token) {
    return (
      <>
        {hero()}
        <PageBody>
          <AuthRequired onOpenAuth={onOpenAuth} text="Войдите, чтобы видеть свои покупки и продажи." />
        </PageBody>
      </>
    );
  }

  // Общая обёртка действий: блокирует кнопки заказа на время запроса и
  // показывает результат всплывающим уведомлением (раньше — alert()).
  const run = async (orderId, action, successText) => {
    setActionLoading((prev) => ({ ...prev, [orderId]: true }));
    try {
      await action();
      if (successText) addToast(successText, 'success');
      return true;
    } catch (error) {
      addToast(error.message || 'Не удалось выполнить действие', 'error');
      return false;
    } finally {
      setActionLoading((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const handleConfirm = async (orderId) => {
    if (!(await dialogs.confirm({ title: 'Подтвердить заказ?', message: 'Покупатель увидит, что заказ принят, и будет ждать отправки.', confirmText: 'Подтвердить' }))) return;
    await run(orderId, () => confirmOrder(orderId, token), 'Заказ подтверждён');
  };

  const handleShip = async (orderId) => {
    const tracking = trackingNumber[orderId];
    if (!tracking || !tracking.trim()) {
      addToast('Укажите трек-номер', 'error');
      return;
    }
    const ok = await run(orderId, () => shipOrder(orderId, tracking.trim(), token), 'Заказ отправлен');
    if (ok) setTrackingNumber((prev) => ({ ...prev, [orderId]: '' }));
  };

  const handleComplete = async (orderId) => {
    if (!(await dialogs.confirm({ title: 'Подтвердить получение?', message: 'Деньги будут переведены продавцу. Отменить это действие нельзя.', confirmText: 'Товар получен' }))) return;
    await run(orderId, () => completeOrder(orderId, token), 'Заказ завершён. Деньги переведены продавцу.');
  };

  const handleCancel = async (orderId) => {
    if (!(await dialogs.confirm({ title: 'Отменить заказ?', message: 'Деньги будут возвращены покупателю.', confirmText: 'Отменить заказ', cancelText: 'Не отменять', danger: true }))) return;
    await run(orderId, () => cancelOrder(orderId, token), 'Заказ отменён');
  };

  // Спор открывает арбитраж: деньги остаются в эскроу до его решения.
  // Доступен обеим сторонам и только после того, как продавец принял заказ.
  const handleDispute = async (orderId) => {
    const reason = await dialogs.prompt({
      title: 'Открыть спор',
      message: 'Опишите проблему. Средства будут заморожены до решения арбитра.',
      placeholder: 'Например: товар не соответствует описанию',
      confirmText: 'Открыть спор',
      danger: true,
      multiline: true,
      validate: (v) => (v.trim().length < 5 ? 'Опишите причину подробнее — минимум 5 символов' : null),
    });
    if (reason === null || reason === undefined) return;
    await run(orderId, () => openOrderDispute(orderId, reason.trim(), token), 'Спор открыт. Средства заморожены до решения арбитра.');
  };

  const renderOrder = (order, isSale = false) => {
    const status = ORDER_STATUS[order.status] || ORDER_STATUS.pending;
    const isLoading = !!actionLoading[order.id];
    const created = order.created_at ? new Date(order.created_at) : null;

    const actions = [];
    if (isSale) {
      if (order.status === 'pending') {
        actions.push(
          <button key="confirm" type="button" className="btn btn-primary" onClick={() => handleConfirm(order.id)} disabled={isLoading}>
            <IconCheck /> Подтвердить заказ
          </button>,
          <button key="cancel" type="button" className="btn btn-secondary" onClick={() => handleCancel(order.id)} disabled={isLoading}>
            Отменить
          </button>
        );
      }
      if (order.status === 'confirmed') {
        actions.push(
          <div key="ship" className="flex flex-1 min-w-[16rem] gap-2">
            <input
              type="text"
              placeholder="Трек-номер"
              aria-label="Трек-номер"
              className="input !py-2"
              value={trackingNumber[order.id] || ''}
              onChange={(e) => setTrackingNumber((prev) => ({ ...prev, [order.id]: e.target.value }))}
            />
            <button type="button" className="btn btn-primary shrink-0" onClick={() => handleShip(order.id)} disabled={isLoading}>
              <IconDelivery /> Отправить
            </button>
          </div>
        );
      }
      if (order.status === 'confirmed' || order.status === 'shipped') {
        actions.push(
          <button key="dispute" type="button" className="btn btn-ghost" onClick={() => handleDispute(order.id)} disabled={isLoading}>
            <IconWarning /> Открыть спор
          </button>
        );
      }
    } else {
      if (order.status === 'shipped' || order.status === 'delivered') {
        actions.push(
          <button key="complete" type="button" className="btn btn-primary" onClick={() => handleComplete(order.id)} disabled={isLoading}>
            <IconCheck /> Подтвердить получение
          </button>
        );
      }
      if (order.status === 'pending' || order.status === 'confirmed') {
        actions.push(
          <button key="cancel" type="button" className="btn btn-secondary" onClick={() => handleCancel(order.id)} disabled={isLoading}>
            <IconClose /> Отменить заказ
          </button>
        );
      }
      if (['confirmed', 'shipped', 'delivered'].includes(order.status)) {
        actions.push(
          <button key="dispute" type="button" className="btn btn-ghost" onClick={() => handleDispute(order.id)} disabled={isLoading}>
            <IconWarning /> Открыть спор
          </button>
        );
      }
    }

    return (
      <article key={order.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-5">
        <div className="flex gap-4">
          <Link
            to={`/products/${order.product_id}`}
            className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-50 to-slate-100 dark:from-slate-700/60 dark:to-slate-800 flex items-center justify-center text-indigo-300 dark:text-slate-500"
            aria-hidden="true"
            tabIndex={-1}
          >
            {order.product_image ? <img src={order.product_image} alt="" className="w-full h-full object-cover" /> : <IconBox size={26} />}
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link to={`/products/${order.product_id}`} className="font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors line-clamp-2">
                {order.product_title}
              </Link>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Заказ #{order.id}
              {created && !Number.isNaN(created.getTime()) && ` · ${created.toLocaleDateString('ru-RU')}`}
            </p>
            <p className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white">{formatPrice(order.total_price)}</p>
          </div>
        </div>

        <dl className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 px-4 py-2 text-sm divide-y divide-slate-200/70 dark:divide-slate-700/60">
          <Row label="Количество">{order.quantity} шт.</Row>
          <Row label="Способ получения">
            {order.delivery_method === 'pickup' ? <><IconPin /> Самовывоз</> : <><IconCatDelivery /> Доставка</>}
          </Row>
          {order.delivery_address && <Row label="Адрес доставки">{order.delivery_address}</Row>}
          {order.tracking_number && <Row label="Трек-номер"><span className="font-mono">{order.tracking_number}</span></Row>}
          <Row label={isSale ? 'Покупатель' : 'Продавец'}>{order.counterparty_name || '—'}</Row>
          {isSale && order.status === 'completed' && (
            <Row label="Комиссия (5%)"><span className="text-red-600 dark:text-red-400">−{formatPrice(order.platform_fee)}</span></Row>
          )}
        </dl>

        {actions.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
      </article>
    );
  };

  const purchases = orders.purchases || [];
  const sales = orders.sales || [];
  const currentOrders = activeTab === 'purchases' ? purchases : sales;

  return (
    <>
      {hero(
        <HeroTabs
          label="Покупки и продажи"
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { id: 'purchases', label: 'Покупки', icon: IconPurchases, count: purchases.length },
            { id: 'sales', label: 'Продажи', icon: IconWallet, count: sales.length },
          ]}
        />
      )}
      <PageBody>
        {loading ? (
          <Spinner label="Загрузка заказов..." />
        ) : currentOrders.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {currentOrders.map((order) => renderOrder(order, activeTab === 'sales'))}
          </div>
        ) : (
          <StateCard
            dashed
            icon={activeTab === 'purchases' ? IconPurchases : IconWallet}
            title={activeTab === 'purchases' ? 'У вас пока нет покупок' : 'У вас пока нет продаж'}
            text={
              activeTab === 'purchases'
                ? 'Купленные товары появятся здесь — вместе со статусом доставки.'
                : 'Когда кто-то купит ваш товар, заказ появится здесь.'
            }
          >
            <Link to="/products" className="btn btn-primary">Перейти к товарам</Link>
          </StateCard>
        )}
      </PageBody>
    </>
  );
}
