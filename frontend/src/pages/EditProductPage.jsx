import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useProductsStore } from '../store/productsStore';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../components/Toast';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { AuthRequired, Spinner, StateCard } from '../components/PageState.jsx';
import ProductForm, { EMPTY_PRODUCT_FORM, formToPayload, productToForm, validateProductForm } from '../components/ProductForm.jsx';
import { IconEdit, IconWarning } from '../components/icons.jsx';

function parseImages(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export default function EditProductPage({ onOpenAuth }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { fetchProduct, updateProduct } = useProductsStore();
  const { token, user } = useAuthStore();

  const [formData, setFormData] = useState(EMPTY_PRODUCT_FORM);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  // 'loading' | 'ready' | 'missing' | 'forbidden'
  const [state, setState] = useState('loading');

  // Ждём профиль: раньше проверка владельца шла, пока user ещё не
  // загрузился, — и владелец получал «Вы не можете редактировать чужой
  // товар» с переходом на другую страницу.
  useEffect(() => {
    if (!id || !token || !user) return;
    let alive = true;
    setState('loading');
    fetchProduct(id)
      .then((product) => {
        if (!alive) return;
        if (!product) return setState('missing');
        if (product.seller_id !== user.id) return setState('forbidden');
        setFormData(productToForm(product));
        setImages(parseImages(product.images));
        setState('ready');
      })
      .catch(() => alive && setState('missing'));
    return () => {
      alive = false;
    };
  }, [id, token, user?.id]);

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
      await updateProduct(id, formToPayload(formData, images), token);
      addToast('Изменения сохранены', 'success');
      navigate(`/products/${id}`);
    } catch (error) {
      addToast(error.message || 'Ошибка при обновлении товара', 'error');
    } finally {
      setLoading(false);
    }
  };

  const hero = (
    <PageHero
      width="medium"
      size="sm"
      back={{ to: '/my-products', label: 'Мои товары' }}
      eyebrow="Редактирование"
      icon={IconEdit}
      title="Редактировать товар"
      subtitle={state === 'ready' ? formData.title : undefined}
    />
  );

  let content;
  if (!token) {
    content = <AuthRequired onOpenAuth={onOpenAuth} text="Войдите, чтобы редактировать свои товары." />;
  } else if (!user || state === 'loading') {
    content = <Spinner label="Загрузка товара..." />;
  } else if (state === 'missing' || state === 'forbidden') {
    content = (
      <StateCard
        icon={IconWarning}
        tone="warning"
        title={state === 'missing' ? 'Товар не найден' : 'Это не ваш товар'}
        text={state === 'missing' ? 'Возможно, он был удалён.' : 'Редактировать товар может только его продавец.'}
        className="max-w-xl mx-auto"
      >
        <Link to="/my-products" className="btn btn-primary">Мои товары</Link>
      </StateCard>
    );
  } else {
    content = (
      <ProductForm
        formData={formData}
        onChange={handleChange}
        images={images}
        setImages={setImages}
        errors={errors}
        submitting={loading}
        submitLabel="Сохранить изменения"
        submittingLabel="Сохранение..."
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/products/${id}`)}
      />
    );
  }

  return (
    <>
      {hero}
      <PageBody width="medium">{content}</PageBody>
    </>
  );
}
