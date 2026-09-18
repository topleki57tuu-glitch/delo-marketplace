import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import './MyProductsPage.css';

export default function MyProductsPage() {
  const navigate = useNavigate();
  const { myProducts, loading, fetchMyProducts, deleteProduct } = useProductsStore();
  const { user, token } = useAuthStore();

  const [deleting, setDeleting] = useState({});

  useEffect(() => {
    if (token && user) {
      // Отдельный эндпоинт: отдаёт все товары продавца, включая распроданные
      // и снятые с продажи. Общий список содержит только активные позиции.
      fetchMyProducts(token);
    }
  }, [token, user]);

  if (!user || !token) {
    return (
      <div className="my-products-page">
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

  const handleDelete = async (productId, productTitle) => {
    if (!confirm(`Удалить товар "${productTitle}"?`)) return;

    setDeleting({ ...deleting, [productId]: true });
    try {
      await deleteProduct(productId, token);
      alert('Товар удалён');
    } catch (error) {
      alert(error.message || 'Ошибка при удалении');
    } finally {
      setDeleting({ ...deleting, [productId]: false });
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'active':
        return { label: 'Активен', color: '#28a745', icon: '✓' };
      case 'sold_out':
        return { label: 'Нет в наличии', color: '#ffc107', icon: '⚠' };
      case 'removed':
        return { label: 'Удалён', color: '#6c757d', icon: '✖' };
      default:
        return { label: status, color: '#999', icon: '•' };
    }
  };

  return (
    <div className="my-products-page">
      <div className="page-header">
        <h1>Мои товары</h1>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={() => navigate('/create-product')}
          >
            + Добавить товар
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => navigate('/products')}
          >
            К каталогу
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Загрузка товаров...</div>
      ) : myProducts.length === 0 ? (
        <div className="no-products">
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <h2>У вас пока нет товаров</h2>
            <p>Создайте первый товар и начните продавать</p>
            <button
              className="btn btn-primary btn-large"
              onClick={() => navigate('/create-product')}
            >
              + Добавить товар
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="products-stats">
            <div className="stat-card">
              <div className="stat-value">{myProducts.length}</div>
              <div className="stat-label">Всего товаров</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {myProducts.filter(p => p.status === 'active').length}
              </div>
              <div className="stat-label">Активных</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {myProducts.reduce((sum, p) => sum + (p.stock || 0), 0)}
              </div>
              <div className="stat-label">В наличии</div>
            </div>
          </div>

          <div className="products-list">
            {myProducts.map((product) => {
              const status = getStatusLabel(product.status);
              const isDeleting = deleting[product.id];

              return (
                <div key={product.id} className="product-item">
                  <div
                    className="product-image"
                    onClick={() => navigate(`/products/${product.id}`)}
                  >
                    {product.first_image ? (
                      <img src={product.first_image} alt={product.title} />
                    ) : (
                      <div className="no-image">📦</div>
                    )}
                    <div className="product-condition">
                      {product.condition === 'new' ? '🆕' : '♻️'}
                    </div>
                  </div>

                  <div className="product-details">
                    <div className="product-header">
                      <h3
                        className="product-title"
                        onClick={() => navigate(`/products/${product.id}`)}
                      >
                        {product.title}
                      </h3>
                      <div
                        className="product-status"
                        style={{ color: status.color }}
                      >
                        <span>{status.icon}</span>
                        <span>{status.label}</span>
                      </div>
                    </div>

                    <p className="product-description">
                      {product.description.length > 150
                        ? product.description.substring(0, 150) + '...'
                        : product.description}
                    </p>

                    <div className="product-meta">
                      <div className="meta-item">
                        <span className="meta-label">Цена:</span>
                        <span className="meta-value price">
                          {formatPrice(product.price)}
                        </span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">В наличии:</span>
                        <span className="meta-value">{product.stock} шт.</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Категория:</span>
                        <span className="meta-value">{product.category}</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Город:</span>
                        <span className="meta-value">
                          {product.city || 'Не указан'}
                        </span>
                      </div>
                    </div>

                    <div className="product-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => navigate(`/products/${product.id}`)}
                      >
                        👁 Просмотр
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => navigate(`/products/${product.id}/edit`)}
                      >
                        ✏️ Редактировать
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(product.id, product.title)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Удаление...' : '🗑 Удалить'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
