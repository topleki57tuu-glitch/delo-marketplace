import React from 'react';
import { ImageUploader } from './ImageUploader';
import { PRODUCT_CATEGORY_OPTIONS } from '../constants/categories.js';
import { IconDelivery, IconLock, IconPin, IconRecycle, IconSparkles } from './icons.jsx';

/*
 * Форма товара — общая для «Продать товар» и «Редактировать товар».
 * Раньше это были две копии по ~200 строк разметки со своим CSS-файлом
 * (CreateProductPage.css), и правка в одной форме забывалась в другой.
 */

export const EMPTY_PRODUCT_FORM = {
  title: '',
  description: '',
  category: 'other',
  condition: 'new',
  price: '',
  stock: '1',
  city: '',
  delivery_options: 'both',
};

export function productToForm(product) {
  return {
    title: product.title || '',
    description: product.description || '',
    category: product.category || 'other',
    condition: product.condition || 'new',
    price: String(product.price ?? ''), // цена в рублях, как её хранит бэкенд
    stock: String(product.stock ?? '1'),
    city: product.city || '',
    delivery_options: product.delivery_options || 'both',
  };
}

export function formToPayload(formData, images) {
  return {
    title: formData.title.trim(),
    description: formData.description.trim(),
    category: formData.category,
    condition: formData.condition,
    price: parseInt(formData.price, 10), // в рублях
    stock: parseInt(formData.stock, 10),
    city: formData.city.trim() || null,
    delivery_options: formData.delivery_options,
    images: images.length > 0 ? JSON.stringify(images) : null,
  };
}

export function validateProductForm(formData) {
  const errors = {};
  if (!formData.title.trim() || formData.title.trim().length < 3) {
    errors.title = 'Название должно содержать минимум 3 символа';
  }
  if (!formData.description.trim() || formData.description.trim().length < 10) {
    errors.description = 'Описание должно содержать минимум 10 символов';
  }
  const price = parseInt(formData.price, 10);
  if (!price || price <= 0) errors.price = 'Укажите корректную цену';
  const stock = parseInt(formData.stock, 10);
  if (!stock || stock < 1) errors.stock = 'Количество должно быть минимум 1';
  return errors;
}

const CONDITIONS = [
  { id: 'new', label: 'Новое', icon: IconSparkles },
  { id: 'used', label: 'Б/У', icon: IconRecycle },
];

const DELIVERY = [
  { id: 'both', label: 'Доставка и самовывоз', icon: IconDelivery },
  { id: 'delivery', label: 'Только доставка', icon: IconDelivery },
  { id: 'pickup', label: 'Только самовывоз', icon: IconPin },
];

const STEPS = [
  'Покупатель оформляет заказ — деньги резервируются на эскроу',
  'Вы подтверждаете заказ и передаёте товар',
  'Покупатель подтверждает получение',
  'Деньги поступают на ваш баланс (комиссия сервиса — 5%)',
  'Если возник спор, решение принимает арбитр платформы',
];

function Field({ label, required, error, hint, children, htmlFor }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>
      )}
    </div>
  );
}

const sectionClass = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6';
const invalid = (err) => (err ? '!border-red-400 dark:!border-red-500' : '');

export default function ProductForm({
  formData,
  onChange,
  images,
  setImages,
  errors = {},
  submitting = false,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
}) {
  const set = (name, value) => onChange({ target: { name, value } });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] items-start">
      <div className="space-y-6 min-w-0">
        <section className={sectionClass}>
          <h2 className="section-title">Основная информация</h2>
          <div className="mt-5 space-y-5">
            <Field label="Название товара" required error={errors.title} htmlFor="pf-title">
              <input
                id="pf-title"
                type="text"
                name="title"
                value={formData.title}
                onChange={onChange}
                placeholder="Например: iPhone 14 Pro 256GB Space Black"
                maxLength="200"
                className={`input ${invalid(errors.title)}`}
              />
            </Field>

            <Field label="Описание" required error={errors.description} hint={`${formData.description.length} / 5000`} htmlFor="pf-description">
              <textarea
                id="pf-description"
                name="description"
                value={formData.description}
                onChange={onChange}
                placeholder="Подробное описание товара: состояние, комплектация, особенности..."
                rows="6"
                maxLength="5000"
                className={`textarea ${invalid(errors.description)}`}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Категория" required htmlFor="pf-category">
                <select id="pf-category" name="category" value={formData.category} onChange={onChange} className="select">
                  {PRODUCT_CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </Field>

              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Состояние <span className="text-red-500">*</span>
                </p>
                <div role="radiogroup" aria-label="Состояние" className="mt-1.5 grid grid-cols-2 gap-2">
                  {CONDITIONS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={formData.condition === id}
                      onClick={() => set('condition', id)}
                      className={`chip justify-center !py-2.5 !text-sm ${formData.condition === id ? 'chip-active' : ''}`}
                    >
                      <Icon size={15} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Цена, ₽" required error={errors.price} htmlFor="pf-price">
                <input
                  id="pf-price"
                  type="number"
                  name="price"
                  inputMode="numeric"
                  value={formData.price}
                  onChange={onChange}
                  placeholder="10000"
                  min="1"
                  className={`input ${invalid(errors.price)}`}
                />
              </Field>
              <Field label="Количество" required error={errors.stock} htmlFor="pf-stock">
                <input
                  id="pf-stock"
                  type="number"
                  name="stock"
                  inputMode="numeric"
                  value={formData.stock}
                  onChange={onChange}
                  placeholder="1"
                  min="1"
                  className={`input ${invalid(errors.stock)}`}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="section-title">Фотографии</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            До 10 фотографий. Первое фото будет главным на витрине.
          </p>
          <div className="mt-4">
            <ImageUploader images={images} setImages={setImages} maxImages={10} />
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="section-title">Получение и местоположение</h2>
          <div className="mt-5 space-y-5">
            <Field label="Город" htmlFor="pf-city">
              <input id="pf-city" type="text" name="city" value={formData.city} onChange={onChange} placeholder="Москва" className="input" />
            </Field>
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Варианты получения <span className="text-red-500">*</span>
              </p>
              <div role="radiogroup" aria-label="Варианты получения" className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {DELIVERY.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={formData.delivery_options === id}
                    onClick={() => set('delivery_options', id)}
                    className={`chip justify-center !py-2.5 !text-sm !whitespace-normal text-center ${formData.delivery_options === id ? 'chip-active' : ''}`}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary !px-6" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>

      <aside className="rounded-2xl border border-indigo-100 dark:border-indigo-500/25 bg-indigo-50/60 dark:bg-indigo-500/10 p-5 lg:sticky lg:top-24">
        <p className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <IconLock size={16} className="text-indigo-600 dark:text-indigo-300" /> Как работает продажа
        </p>
        <ol className="mt-4 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-slate-600 dark:text-slate-300">
              <span className="w-6 h-6 shrink-0 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </aside>
    </form>
  );
}
