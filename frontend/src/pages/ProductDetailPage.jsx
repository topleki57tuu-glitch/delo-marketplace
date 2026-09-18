import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import './ProductDetailPage.css';
import { IconRecycle, IconBox, IconCheck, IconDelivery, IconEdit, IconPin, IconPurchases, IconStar, IconUser } from '../components/icons.jsx';

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentProduct, loading, fetchProduct, createOrder } = useProductsStore();
  const { user, token } = useAuthStore();

  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    fetchProduct(id);
  }, [id]);

  if (loading || !currentProduct) {
    return <div className="loading">Загрузка...</div>;
  }

  const product = currentProduct;
  const isOwner = user && user.id === product.seller_id;
  const canOrder = user && !isOwner && product.stock > 0;

  // Цена приходит с бэкенда в рублях (см. комментарий в ProductsPage).
  const formatPrice = (priceInRubles) => {
    return (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';
  };

  const handleOrder = async () => {
    if (!token) {
      navigate('/login');
      return;
    }

    if (deliveryMethod === 'delivery' && !deliveryAddress.trim()) {
      alert('Укажите адрес доставки');
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

      alert('Заказ создан! Деньги заморожены в эскроу. Ожидайте подтверждения продавца.');
      navigate('/my-orders');
    } catch (error) {
      alert(error.message || 'Ошибка при создании заказа');
    } finally {
      setOrdering(false);
    }
  };

  const totalPrice = product.price * quantity;

  let images = [];
  try {
    if (product.images) {
      images = JSON.parse(product.images);
    }
  } catch (e) {
    console.error('Failed to parse images', e);
  }

  return (
    <div className="product-detail-page">
      <button className="btn-back" onClick={() => navigate('/products')}>
        ← Назад к товарам
      </button>

      <div className="product-detail-container">
        {/* Галерея */}
        <div className="product-gallery">
          {images.length > 0 ? (
            <div className="gallery-main">
              <img src={images[0]} alt={product.title} />
            </div>
          ) : (
            <div className="gallery-main no-image">
              <span><IconBox /></span>
            </div>
          )}

          {images.length > 1 && (
            <div className="gallery-thumbs">
              {images.map((img, idx) => (
                <div key={idx} className="thumb">
                  <img src={img} alt={`${product.title} ${idx + 1}`} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Информация */}
        <div className="product-details">
          <div className="product-header">
            <h1>{product.title}</h1>
            <div className="product-condition-badge">
              {product.condition === 'new' ? '🆕 Новое' : <><IconRecycle /> Б/У</>}
            </div>
          </div>

          <div className="product-price-block">
            <div className="price">{formatPrice(product.price)}</div>
            {product.stock > 0 ? (
              <div className="stock">В наличии: {product.stock} шт.</div>
            ) : (
              <div className="stock out-of-stock">Нет в наличии</div>
            )}
          </div>

          {/* Продавец */}
          <div className="seller-info">
            <h3>Продавец</h3>
            <div className="seller-card">
              <div className="seller-avatar">
                {product.seller_avatar ? (
                  <img src={product.seller_avatar} alt={product.seller_name} />
                ) : (
                  <div className="avatar-placeholder"><IconUser /></div>
                )}
              </div>
              <div className="seller-details">
                <div className="seller-name">
                  {product.seller_verified && <span className="verified"><IconCheck /></span>}
                  {product.seller_name}
                </div>
                {product.seller_rating && (
                  <div className="seller-rating">
                    <IconStar /> {product.seller_rating} ({product.seller_reviews_count} отзывов)
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Доставка */}
          <div className="delivery-info">
            <h3>Доставка</h3>
            <div className="delivery-options">
              {(product.delivery_options === 'both' || product.delivery_options === 'pickup') && (
                <div className="delivery-option"><IconPin /> Самовывоз</div>
              )}
              {(product.delivery_options === 'both' || product.delivery_options === 'delivery') && (
                <div className="delivery-option"><IconDelivery /> Доставка</div>
              )}
            </div>
            {product.city && (
              <div className="location"><IconPin /> {product.city}</div>
            )}
          </div>

          {/* Кнопки действий */}
          <div className="actions">
            {isOwner ? (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate(`/products/${product.id}/edit`)}
                >
                  <IconEdit /> Редактировать
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/my-products')}
                >
                  <IconBox /> Мои товары
                </button>
              </>
            ) : canOrder ? (
              <button
                className="btn btn-primary btn-large"
                onClick={() => setShowOrderForm(!showOrderForm)}
              >
                <IconPurchases /> Купить
              </button>
            ) : !user ? (
              <button
                className="btn btn-primary btn-large"
                onClick={() => navigate('/login')}
              >
                Войдите, чтобы купить
              </button>
            ) : null}
          </div>

          {/* Форма заказа */}
          {showOrderForm && canOrder && (
            <div className="order-form">
              <h3>Оформление заказа</h3>

              <div className="form-group">
                <label>Количество</label>
                <input
                  type="number"
                  min="1"
                  max={product.stock}
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                />
              </div>

              <div className="form-group">
                <label>Способ получения</label>
                <div className="radio-group">
                  {(product.delivery_options === 'both' || product.delivery_options === 'pickup') && (
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="delivery"
                        value="pickup"
                        checked={deliveryMethod === 'pickup'}
                        onChange={(e) => setDeliveryMethod(e.target.value)}
                      />
                      <IconPin /> Самовывоз
                    </label>
                  )}
                  {(product.delivery_options === 'both' || product.delivery_options === 'delivery') && (
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="delivery"
                        value="delivery"
                        checked={deliveryMethod === 'delivery'}
                        onChange={(e) => setDeliveryMethod(e.target.value)}
                      />
                      <IconDelivery /> Доставка
                    </label>
                  )}
                </div>
              </div>

              {deliveryMethod === 'delivery' && (
                <div className="form-group">
                  <label>Адрес доставки</label>
                  <textarea
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Город, улица, дом, квартира"
                    rows="3"
                  />
                </div>
              )}

              <div className="order-summary">
                <div className="summary-row">
                  <span>Товар ({quantity} шт.)</span>
                  <span>{formatPrice(totalPrice)}</span>
                </div>
                <div className="summary-row total">
                  <span>Итого</span>
                  <span>{formatPrice(totalPrice)}</span>
                </div>
                <div className="summary-note">
                  Деньги будут заморожены в эскроу до получения товара
                </div>
              </div>

              <button
                className="btn btn-primary btn-large"
                onClick={handleOrder}
                disabled={ordering}
              >
                {ordering ? 'Оформление...' : `Купить за ${formatPrice(totalPrice)}`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Описание */}
      <div className="product-description-section">
        <h2>Описание</h2>
        <p>{product.description}</p>
      </div>
    </div>
  );
}
