import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import './ProductsPage.css';

const PRODUCT_CATEGORIES = [
  { id: 'electronics', label: 'Электроника', icon: '📱' },
  { id: 'clothing', label: 'Одежда и обувь', icon: '👕' },
  { id: 'home', label: 'Товары для дома', icon: '🏠' },
  { id: 'hobby', label: 'Хобби и развлечения', icon: '🎮' },
  { id: 'auto', label: 'Авто и мото', icon: '🚗' },
  { id: 'kids', label: 'Детские товары', icon: '👶' },
  { id: 'other', label: 'Другое', icon: '📦' },
];

const PRODUCT_CONDITIONS = [
  { id: 'new', label: 'Новое' },
  { id: 'used', label: 'Б/У' },
];

export default function ProductsPage() {
  const navigate = useNavigate();
  const { products, loading, filters, setFilters, fetchProducts } = useProductsStore();

  const [localSearch, setLocalSearch] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleCategoryChange = (categoryId) => {
    const newCategory = filters.category === categoryId ? null : categoryId;
    setFilters({ category: newCategory });
    fetchProducts({ category: newCategory });
  };

  const handleConditionChange = (conditionId) => {
    const newCondition = filters.condition === conditionId ? null : conditionId;
    setFilters({ condition: newCondition });
    fetchProducts({ condition: newCondition });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters({ search: localSearch });
    fetchProducts({ search: localSearch });
  };

  const handlePriceFilter = () => {
    fetchProducts();
  };

  const formatPrice = (priceInKopecks) => {
    return (priceInKopecks / 100).toLocaleString('ru-RU') + ' ₽';
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <h1>🛍️ Маркетплейс товаров</h1>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/create-product')}
        >
          + Продать товар
        </button>
      </div>

      {/* Поиск */}
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Поиск товаров..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        <button type="submit" className="btn">🔍 Найти</button>
      </form>

      {/* Фильтры */}
      <div className="filters-section">
        <div className="filter-group">
          <h3>Категории</h3>
          <div className="category-buttons">
            {PRODUCT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`category-btn ${filters.category === cat.id ? 'active' : ''}`}
                onClick={() => handleCategoryChange(cat.id)}
              >
                <span className="category-icon">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <h3>Состояние</h3>
          <div className="condition-buttons">
            {PRODUCT_CONDITIONS.map((cond) => (
              <button
                key={cond.id}
                className={`condition-btn ${filters.condition === cond.id ? 'active' : ''}`}
                onClick={() => handleConditionChange(cond.id)}
              >
                {cond.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <h3>Цена</h3>
          <div className="price-filter">
            <input
              type="number"
              placeholder="От"
              value={filters.price_min || ''}
              onChange={(e) => setFilters({ price_min: e.target.value ? parseInt(e.target.value) * 100 : null })}
            />
            <span>—</span>
            <input
              type="number"
              placeholder="До"
              value={filters.price_max || ''}
              onChange={(e) => setFilters({ price_max: e.target.value ? parseInt(e.target.value) * 100 : null })}
            />
            <button className="btn btn-secondary" onClick={handlePriceFilter}>
              Применить
            </button>
          </div>
        </div>

        <div className="filter-group">
          <h3>Город</h3>
          <input
            type="text"
            placeholder="Введите город"
            value={filters.city || ''}
            onChange={(e) => {
              setFilters({ city: e.target.value });
              fetchProducts({ city: e.target.value });
            }}
          />
        </div>
      </div>

      {/* Список товаров */}
      {loading ? (
        <div className="loading">Загрузка товаров...</div>
      ) : products.length === 0 ? (
        <div className="no-products">
          <p>Товары не найдены</p>
          <button className="btn" onClick={() => {
            setFilters({ category: null, condition: null, city: null, price_min: null, price_max: null, search: '' });
            setLocalSearch('');
            fetchProducts({});
          }}>
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="products-grid">
          {products.map((product) => (
            <div
              key={product.id}
              className="product-card"
              onClick={() => navigate(`/products/${product.id}`)}
            >
              <div className="product-image">
                {product.first_image ? (
                  <img src={product.first_image} alt={product.title} />
                ) : (
                  <div className="no-image">📦</div>
                )}
                <div className="product-condition">
                  {product.condition === 'new' ? '🆕 Новое' : '♻️ Б/У'}
                </div>
              </div>

              <div className="product-info">
                <h3 className="product-title">{product.title}</h3>
                <p className="product-description">
                  {product.description.length > 100
                    ? product.description.substring(0, 100) + '...'
                    : product.description}
                </p>

                <div className="product-meta">
                  <div className="product-location">📍 {product.city || 'Не указан'}</div>
                  <div className="product-delivery">
                    {product.delivery_options === 'both' && '🚚 Доставка • 📍 Самовывоз'}
                    {product.delivery_options === 'delivery' && '🚚 Доставка'}
                    {product.delivery_options === 'pickup' && '📍 Самовывоз'}
                  </div>
                </div>

                <div className="product-seller">
                  <span className="seller-name">
                    {product.seller_verified && '✓ '}
                    {product.seller_name}
                  </span>
                  {product.seller_rating && (
                    <span className="seller-rating">⭐ {product.seller_rating}</span>
                  )}
                </div>

                <div className="product-price">{formatPrice(product.price)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
