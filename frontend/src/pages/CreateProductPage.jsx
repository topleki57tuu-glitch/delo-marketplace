import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { AuthRequired, Spinner, StateCard } from '../components/PageState.jsx';
import ProductForm, { EMPTY_PRODUCT_FORM, formToPayload, validateProductForm } from '../components/ProductForm.jsx';
import { IconProducts, IconUser } from '../components/icons.jsx';

export default function CreateProductPage({ onOpenAuth }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { createProduct } = useProductsStore();
  const { token, user } = useAuthStore();

  const [formData, setFormData] = useState(EMPTY_PRODUCT_FORM);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      onOpenAuth?.('login');
      return;
    }
    const found = validateProductForm(formData);
    setErrors(found);
    if (Object.keys(found).length) return;

    setLoading(true);
    try {
      const result = await createProduct(formToPayload(formData, images), token);
      addToast('Товар опубликован', 'success');
      navigate(`/products/${result.product_id}`);
    } catch (error) {
      addToast(error.message || 'Ошибка при создании товара', 'error');
    } finally {
      setLoading(false);
    }
  };

  const hero = (
    <PageHero
      width="medium"
      size="sm"
      back={{ to: '/products', label: 'Все товары' }}
      eyebrow="Новое объявление"
      icon={IconProducts}
      title="Продать товар"
      subtitle="Опишите товар, добавьте фото и цену. Деньги покупателя резервируются до того, как он подтвердит получение."
    />
  );

  // Профиль ещё грузится: без этой ветки на долю секунды мелькало
  // «Требуется авторизация», хотя пользователь вошёл.
  if (token && !user) {
    return (
      <>
        {hero}
        <PageBody width="medium"><Spinner /></PageBody>
      </>
    );
  }

  if (!user) {
    return (
      <>
        {hero}
        <PageBody width="medium">
          <AuthRequired onOpenAuth={onOpenAuth} text="Войдите, чтобы продавать товары." />
        </PageBody>
      </>
    );
  }

  // Проверка была только на «вошёл ли» — роль не проверялась. Покупатель
  // видел полную форму, заполнял её и получал 403 «Размещать товары могут
  // только специалисты» уже на отправке.
  if (user.role !== 'specialist') {
    return (
      <>
        {hero}
        <PageBody width="medium">
          <StateCard
            icon={IconUser}
            tone="warning"
            title="Только для специалистов"
            text="Размещать товары могут только специалисты. Роль переключается в профиле — бесплатно и в любой момент."
            className="max-w-xl mx-auto"
          >
            <Link to="/profile" className="btn btn-primary">Перейти в профиль</Link>
          </StateCard>
        </PageBody>
      </>
    );
  }

  return (
    <>
      {hero}
      <PageBody width="medium">
        <ProductForm
          formData={formData}
          onChange={handleChange}
          images={images}
          setImages={setImages}
          errors={errors}
          submitting={loading}
          submitLabel="Опубликовать товар"
          submittingLabel="Публикация..."
          onSubmit={handleSubmit}
          onCancel={() => navigate('/products')}
        />
      </PageBody>
    </>
  );
}
