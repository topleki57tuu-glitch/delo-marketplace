import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import ImageUploader from '../components/ImageUploader';
import './CreateProductPage.css';

const PRODUCT_CATEGORIES = [
  { id: 'electronics', label: 'Электроника', icon: '📱' },
  { id: 'clothing', label: 'Одежда и обувь', icon: '👕' },
  { id: 'home', label: 'Товары для дома', icon: '🏠' },
  { id: 'hobby', label: 'Хобби и развлечения', icon: '🎮' },
  { id: 'auto', label: 'Авто и мото', icon: '🚗' },
  { id: 'kids', label: 'Детские товары', icon: '👶' },
  { id: 'other', label: 'Другое', icon: '📦' },
];

export default function CreateProductPage() {
  const navigate = useNavigate();
  const { createProduct } = useProductsStore();
  const { token, user } = useAuthStore();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'other',
    condition: 'new',
    price: '',
    stock: '1',
    city: '',
    delivery_options: 'both',
  });

  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Очистить ошибку для этого поля
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.title.trim() || formData.title.length < 3) {
      newErrors.title = 'Название должно содержать минимум 3 символа';
    }

    if (!formData.description.trim() || formData.description.length < 10) {
      newErrors.description = 'Описание должно содержать минимум 10 символов';
    }

    const price = parseInt(formData.price);
    if (!price || price <= 0) {
      newErrors.price = 'Укажите корректную цену';
    }

    const stock = parseInt(formData.stock);
    if (!stock || stock < 1) {
      newErrors.stock = 'Количество должно быть минимум 1';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!token) {
      alert('Войдите в систему');
      navigate('/login');
      return;
    }

    if (!validate()) {
      return;
    }

    setLoading(true);

    try {
      const productData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        category: formData.category,
        condition: formData.condition,
        price: parseInt(formData.price) * 100, // в копейки
        stock: parseInt(formData.stock),
        city: formData.city.trim() || null,
        delivery_options: formData.delivery_options,
        images: images.length > 0 ? JSON.stringify(images) : null,
      };

      const result = await createProduct(productData, token);
      alert('Товар успешно создан!');
      navigate(`/products/${result.product_id}`);
    } catch (error) {
      alert(error.message || 'Ошибка при создании товара');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="create-product-page">
        <div className="auth-required">
          <h2>Требуется авторизация</h2>
          <p>Войдите в систему, чтобы продавать товары</p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            Войти
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-product-page">
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate('/products')}>
          ← Назад
        </button>
        <h1>Продать товар</h1>
      </div>

      <form className="product-form" onSubmit={handleSubmit}>
        {/* Основная информация */}
        <div className="form-section">
          <h2>Основная информация</h2>

          <div className="form-group">
            <label>
              Название товара <span className="required">*</span>
            </label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="Например: iPhone 14 Pro 256GB Space Black"
              maxLength="200"
              className={errors.title ? 'error' : ''}
            />
            {errors.title && <div className="error-message">{errors.title}</div>}
          </div>

          <div className="form-group">
            <label>
              Описание <span className="required">*</span>
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Подробное описание товара: состояние, комплектация, особенности..."
              rows="6"
              maxLength="5000"
              className={errors.description ? 'error' : ''}
            />
            {errors.description && <div className="error-message">{errors.description}</div>}
            <div className="char-count">{formData.description.length} / 5000</div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>
                Категория <span className="required">*</span>
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
              >
                {PRODUCT_CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>
                Состояние <span className="required">*</span>
              </label>
              <select
                name="condition"
                value={formData.condition}
                onChange={handleChange}
              >
                <option value="new">🆕 Новое</option>
                <option value="used">♻️ Б/У</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>
                Цена (₽) <span className="required">*</span>
              </label>
              <input
                type="number"
                name="price"
                value={formData.price}
                onChange={handleChange}
                placeholder="10000"
                min="1"
                className={errors.price ? 'error' : ''}
              />
              {errors.price && <div className="error-message">{errors.price}</div>}
            </div>

            <div className="form-group">
              <label>
                Количество <span className="required">*</span>
              </label>
              <input
                type="number"
                name="stock"
                value={formData.stock}
                onChange={handleChange}
                placeholder="1"
                min="1"
                className={errors.stock ? 'error' : ''}
              />
              {errors.stock && <div className="error-message">{errors.stock}</div>}
            </div>
          </div>
        </div>

        {/* Фотографии */}
        <div className="form-section">
          <h2>Фотографии</h2>
          <p className="section-description">
            Загрузите до 10 фотографий товара. Первое фото будет главным.
          </p>
          <ImageUploader
            images={images}
            setImages={setImages}
            maxImages={10}
          />
        </div>

        {/* Доставка */}
        <div className="form-section">
          <h2>Доставка и местоположение</h2>

          <div className="form-group">
            <label>Город</label>
            <input
              type="text"
              name="city"
              value={formData.city}
              onChange={handleChange}
              placeholder="Москва"
            />
          </div>

          <div className="form-group">
            <label>
              Варианты доставки <span className="required">*</span>
            </label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="delivery_options"
                  value="both"
                  checked={formData.delivery_options === 'both'}
                  onChange={handleChange}
                />
                <span>🚚📍 Доставка и самовывоз</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="delivery_options"
                  value="delivery"
                  checked={formData.delivery_options === 'delivery'}
                  onChange={handleChange}
                />
                <span>🚚 Только доставка</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="delivery_options"
                  value="pickup"
                  checked={formData.delivery_options === 'pickup'}
                  onChange={handleChange}
                />
                <span>📍 Только самовывоз</span>
              </label>
            </div>
          </div>
        </div>

        {/* Информация */}
        <div className="info-block">
          <h3>ℹ️ Как работает продажа</h3>
          <ul>
            <li>Покупатель оформляет заказ → деньги замораживаются в эскроу</li>
            <li>Вы подтверждаете заказ и отправляете товар</li>
            <li>Покупатель получает товар и подтверждает получение</li>
            <li>Деньги переводятся на ваш баланс (минус комиссия 5%)</li>
            <li>При споре решение принимает администрация платформы</li>
          </ul>
        </div>

        {/* Кнопки */}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/products')}
            disabled={loading}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
          >
            {loading ? 'Создание...' : 'Опубликовать товар'}
          </button>
        </div>
      </form>
    </div>
  );
}
