import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import './MyOrdersPage.css';

const ORDER_STATUS_LABELS = {
  pending: { label: 'Ожидает подтверждения', icon: '⏳', color: '#ffc107' },
  confirmed: { label: 'Подтверждён', icon: '✅', color: '#28a745' },
  shipped: { label: 'Отправлен', icon: '🚚', color: '#007bff' },
  delivered: { label: 'Доставлен', icon: '📦', color: '#17a2b8' },
  completed: { label: 'Завершён', icon: '✓', color: '#28a745' },
  disputed: { label: 'Спор', icon: '⚠️', color: '#dc3545' },
  cancelled: { label: 'Отменён', icon: '✖', color: '#6c757d' },
};

export default function MyOrdersPage() {
  const navigate = useNavigate();
  const { orders, loading, fetchOrders, confirmOrder, shipOrder, completeOrder, cancelOrder, openOrderDispute } = useProductsStore();
  const { token, user } = useAuthStore();

  const [activeTab, setActiveTab] = useState('purchases');
  const [trackingNumber, setTrackingNumber] = useState({});
  const [actionLoading, setActionLoading] = useState({});

  useEffect(() => {
    if (token) {
      fetchOrders(token);
    }
  }, [token]);

  if (!user || !token) {
    return (
      <div className="my-orders-page">
        <div className="auth-required">
          <h2>Требуется авторизация</h2>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            Войти
          </button>
        </div>
      </div>
    );
  }

  // Цена приходит с бэкенда в рублях (см. комментарий в ProductsPage).
  const formatPrice = (priceInRubles) => {
    return (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';
  };

  const handleConfirm = async (orderId) => {
    if (!confirm('Подтвердить заказ?')) return;

    setActionLoading({ ...actionLoading, [orderId]: true });
    try {
      await confirmOrder(orderId, token);
      alert('Заказ подтверждён');
    } catch (error) {
      alert(error.message);
    } finally {
      setActionLoading({ ...actionLoading, [orderId]: false });
    }
  };

  const handleShip = async (orderId) => {
    const tracking = trackingNumber[orderId];
    if (!tracking || !tracking.trim()) {
      alert('Укажите трек-номер');
      return;
    }

    setActionLoading({ ...actionLoading, [orderId]: true });
    try {
      await shipOrder(orderId, tracking.trim(), token);
      alert('Заказ отправлен');
      setTrackingNumber({ ...trackingNumber, [orderId]: '' });
    } catch (error) {
      alert(error.message);
    } finally {
      setActionLoading({ ...actionLoading, [orderId]: false });
    }
  };

  const handleComplete = async (orderId) => {
    if (!confirm('Подтвердить получение товара? Деньги будут переведены продавцу.')) return;

    setActionLoading({ ...actionLoading, [orderId]: true });
    try {
      await completeOrder(orderId, token);
      alert('Заказ завершён. Деньги переведены продавцу.');
    } catch (error) {
      alert(error.message);
    } finally {
      setActionLoading({ ...actionLoading, [orderId]: false });
    }
  };

  const handleCancel = async (orderId) => {
    if (!confirm('Отменить заказ? Деньги будут возвращены покупателю.')) return;

    setActionLoading({ ...actionLoading, [orderId]: true });
    try {
      await cancelOrder(orderId, token);
      alert('Заказ отменён');
    } catch (error) {
      alert(error.message);
    } finally {
      setActionLoading({ ...actionLoading, [orderId]: false });
    }
  };

  // Спор открывает арбитраж: деньги остаются в эскроу до его решения.
  // Доступен обеим сторонам и только после того, как продавец принял заказ.
  const handleDispute = async (orderId) => {
    const reason = window.prompt(
      'Опишите проблему (минимум 5 символов).\nСредства будут заморожены до решения арбитра.'
    );
    if (reason === null) return;
    if (!reason || reason.trim().length < 5) {
      alert('Опишите причину подробнее — минимум 5 символов');
      return;
    }

    setActionLoading({ ...actionLoading, [orderId]: true });
    try {
      await openOrderDispute(orderId, reason.trim(), token);
      alert('Спор открыт. Средства заморожены до решения арбитра.');
    } catch (error) {
      alert(error.message);
    } finally {
      setActionLoading({ ...actionLoading, [orderId]: false });
    }
  };

  const renderOrder = (order, isSale = false) => {    const status = ORDER_STATUS_LABELS[order.status] || ORDER_STATUS_LABELS.pending;
    const isLoading = actionLoading[order.id];

    return (
      <div key={order.id} className="order-card">
        <div className="order-header">
          <div className="order-info">
            <h3 onClick={() => navigate(`/products/${order.product_id}`)}>
              {order.product_title}
            </h3>
            <div className="order-meta">
              <span className="order-id">Заказ #{order.id}</span>
              <span className="order-date">
                {new Date(order.created_at).toLocaleDateString('ru-RU')}
              </span>
            </div>
          </div>
          <div className="order-status" style={{ color: status.color }}>
            <span className="status-icon">{status.icon}</span>
            <span>{status.label}</span>
          </div>
        </div>

        {order.product_image && (
          <div className="order-image">
            <img src={order.product_image} alt={order.product_title} />
          </div>
        )}

        <div className="order-details">
          <div className="detail-row">
            <span>Количество:</span>
            <span>{order.quantity} шт.</span>
          </div>
          <div className="detail-row">
            <span>Способ получения:</span>
            <span>
              {order.delivery_method === 'pickup' ? '📍 Самовывоз' : '🚚 Доставка'}
            </span>
          </div>
          {order.delivery_address && (
            <div className="detail-row">
              <span>Адрес доставки:</span>
              <span>{order.delivery_address}</span>
            </div>
          )}
          {order.tracking_number && (
            <div className="detail-row">
              <span>Трек-номер:</span>
              <span className="tracking-number">{order.tracking_number}</span>
            </div>
          )}
          <div className="detail-row">
            <span>{isSale ? 'Покупатель' : 'Продавец'}:</span>
            <span>{order.counterparty_name || '—'}</span>
          </div>
          <div className="detail-row total">
            <span>Сумма:</span>
            <span className="price">{formatPrice(order.total_price)}</span>
          </div>
          {isSale && order.status === 'completed' && (
            <div className="detail-row">
              <span>Комиссия (5%):</span>
              <span className="fee">-{formatPrice(order.platform_fee)}</span>
            </div>
          )}
        </div>

        {/* Действия для продавца */}
        {isSale && (
          <div className="order-actions">
            {order.status === 'pending' && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => handleConfirm(order.id)}
                  disabled={isLoading}
                >
                  ✅ Подтвердить заказ
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleCancel(order.id)}
                  disabled={isLoading}
                >
                  Отменить
                </button>
              </>
            )}

            {order.status === 'confirmed' && (
              <div className="ship-form">
                <input
                  type="text"
                  placeholder="Введите трек-номер"
                  value={trackingNumber[order.id] || ''}
                  onChange={(e) => setTrackingNumber({
                    ...trackingNumber,
                    [order.id]: e.target.value
                  })}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => handleShip(order.id)}
                  disabled={isLoading}
                >
                  🚚 Отправить
                </button>
              </div>
            )}

            {(order.status === 'confirmed' || order.status === 'shipped') && (
              <button
                className="btn btn-secondary"
                onClick={() => handleDispute(order.id)}
                disabled={isLoading}
              >
                ⚠️ Открыть спор
              </button>
            )}
          </div>
        )}

        {/* Действия для покупателя */}
        {!isSale && (
          <div className="order-actions">
            {(order.status === 'pending' || order.status === 'confirmed') && (
              <button
                className="btn btn-secondary"
                onClick={() => handleCancel(order.id)}
                disabled={isLoading}
              >
                Отменить заказ
              </button>
            )}

            {(order.status === 'shipped' || order.status === 'delivered') && (
              <button
                className="btn btn-primary"
                onClick={() => handleComplete(order.id)}
                disabled={isLoading}
              >
                ✓ Подтвердить получение
              </button>
            )}

            {['confirmed', 'shipped', 'delivered'].includes(order.status) && (
              <button
                className="btn btn-secondary"
                onClick={() => handleDispute(order.id)}
                disabled={isLoading}
              >
                ⚠️ Открыть спор
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const currentOrders = activeTab === 'purchases' ? orders.purchases : orders.sales;

  return (
    <div className="my-orders-page">
      <div className="page-header">
        <h1>Мои заказы</h1>
        <button className="btn btn-back" onClick={() => navigate('/products')}>
          ← К товарам
        </button>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'purchases' ? 'active' : ''}`}
          onClick={() => setActiveTab('purchases')}
        >
          🛒 Покупки ({orders.purchases?.length || 0})
        </button>
        <button
          className={`tab ${activeTab === 'sales' ? 'active' : ''}`}
          onClick={() => setActiveTab('sales')}
        >
          💰 Продажи ({orders.sales?.length || 0})
        </button>
      </div>

      {loading ? (
        <div className="loading">Загрузка заказов...</div>
      ) : currentOrders && currentOrders.length > 0 ? (
        <div className="orders-list">
          {currentOrders.map(order => renderOrder(order, activeTab === 'sales'))}
        </div>
      ) : (
        <div className="no-orders">
          <p>
            {activeTab === 'purchases'
              ? 'У вас пока нет покупок'
              : 'У вас пока нет продаж'}
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/products')}>
            Перейти к товарам
          </button>
        </div>
      )}
    </div>
  );
}
