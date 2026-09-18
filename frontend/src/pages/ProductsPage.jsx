import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import './ProductsPage.css';
import { IconRecycle, IconCatAuto, IconCatClothing, IconCatElectronics, IconCatHobby, IconCatHome, IconCatKids, IconCatOther, IconBox, IconCheck, IconPin, IconProducts, IconSearch } from '../components/icons.jsx';

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

  // Цена приходит с бэкенда в рублях — в тех же единицах, что баланс,
  // эскроу и комиссия. Раньше здесь делили на 100, считая её копейками,
  // из-за чего витрина показывала сумму в 100 раз меньше списываемой.
  const formatPrice = (priceInRubles) => {
    return (priceInRubles ?? 0).toLocaleString('ru-RU') + ' ₽';
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <h1><IconProducts /> Маркетплейс товаров</h1>
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
        <button type="submit" className="btn"><IconSearch /> Найти</button>
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
          <div className="price-inputs">
            <input
              type="number"
              placeholder="От (₽)"
              value={filters.price_min ?? ''}
              onChange={(e) => setFilters({ price_min: e.target.value ? parseInt(e.target.value) : null })}
            />
            <span>—</span>
            <input
              type="number"
              placeholder="До (₽)"
              value={filters.price_max ?? ''}
              onChange={(e) => setFilters({ price_max: e.target.value ? parseInt(e.target.value) : null })}
            />
            <button onClick={handlePriceFilter}>
              Применить
            </button>
          </div>
        </div>

        <div className="filter-group">
          <h3>Город</h3>
          <div className="city-input">
            <input
              type="text"
              placeholder="Введите город..."
              value={filters.city || ''}
              onChange={(e) => {
                setFilters({ city: e.target.value });
                fetchProducts({ city: e.target.value });
              }}
            />
          </div>
        </div>
      </div>

      {/* Список товаров */}
      {loading ? (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Загрузка товаров...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="no-products">
          <div className="no-products-icon"><IconProducts /></div>
          <h2>Товары не найдены</h2>
          <p>Попробуйте изменить параметры поиска</p>
          <button className="btn btn-primary" onClick={() => {
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
              <div className="product-image-container">
                {product.first_image ? (
                  <img src={product.first_image} alt={product.title} />
                ) : (
                  <div className="no-image"><IconBox /></div>
                )}
                <div className={`product-condition-badge ${product.condition}`}>
                  {product.condition === 'new' ? '🆕 Новое' : <><IconRecycle /> Б/У</>}
                </div>
              </div>

              <div className="product-details">
                <h3 className="product-title">{product.title}</h3>
                <p className="product-description">
                  {product.description.length > 80
                    ? product.description.substring(0, 80) + '...'
                    : product.description}
                </p>

                <div className="product-price">{formatPrice(product.price)}</div>

                <div className="product-meta">
                  <div className="product-city">
                    <IconPin /> {product.city || 'Не указан'}
                  </div>
                </div>

                <div className="product-seller">
                  {product.seller_verified && <span className="seller-verified"><IconCheck /></span>}
                  <span>{product.seller_name}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
