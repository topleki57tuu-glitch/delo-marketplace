import React, { useState, useRef } from 'react';
import { useToast } from './Toast';

/**
 * Компонент для загрузки и отображения аватара пользователя
 *
 * Файл загружается на сервер через POST /upload/image, в профиль пишется
 * полученная короткая ссылка (/files/<id>).
 *
 * Раньше файл читался через FileReader.readAsDataURL и отправлялся в поле
 * `avatar` как base64. Бэкенд режет значение длиннее 500 символов
 * (_MAX_MEDIA_URL_LEN в app/api/users.py), а base64 картинки на 100 КБ —
 * это ~136 000 символов. Поэтому любое фото, кроме крошечного, отклонялось
 * с «Ссылка на изображение слишком длинная», и аватар не сохранялся.
 */
/**
 * Приводит любое выбранное изображение к JPEG через canvas.
 *
 * Зачем: iPhone по умолчанию снимает в HEIC, а этот формат бэкенд не принимает
 * (он допускает только то, что опознал по magic bytes: JPEG/PNG/GIF/WEBP).
 * Такие фото отклонялись, и на телефоне аватар не сохранялся.
 *
 * Safari умеет декодировать HEIC сам, поэтому drawImage + toBlob('image/jpeg')
 * даёт корректный JPEG без единой серверной зависимости и без библиотек.
 * Заодно это приводит к JPEG всё остальное: PNG с прозрачностью, WEBP,
 * фото с нестандартных камер.
 *
 * Ограничение Safari: слишком большой canvas становится «немым» — drawImage и
 * toBlob молча перестают работать. Поэтому вписываем в MAX_SIDE (с запасом:
 * у Safari JPG-лимит порядка 16 Мпикс, 1600 по длинной стороне даёт 2.5 Мпикс
 * даже на квадратном снимке). Для аватара 1600 px более чем достаточно.
 */
const JPEG_QUALITY = 0.9;
const MAX_SIDE = 1600;

async function toJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      el.src = url;
    });

    // Уже JPEG и в пределах лимита — отдаём как есть, не пережимая зря
    if (file.type === 'image/jpeg' && Math.max(img.width, img.height) <= MAX_SIDE) {
      return file;
    }

    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    // Белый фон: JPEG не умеет прозрачность, без заливки PNG с альфой
    // превратился бы в чёрный квадрат.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) {
      // Canvas молча не сработал — например, картинка слишком большая для Safari.
      throw new Error('Не удалось обработать изображение. Попробуйте другое фото.');
    }
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AvatarUploader({ currentAvatar, onAvatarUpdate, token }) {
  const { addToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // сброс до await, иначе повторный выбор того же файла не сработает
    if (!file) return;

    // Валидация типа файла
    if (!file.type.startsWith('image/')) {
      addToast('Пожалуйста, выберите изображение', 'error');
      return;
    }

    // Валидация размера (макс 10MB — до конвертации; в JPEG станет меньше)
    if (file.size > 10 * 1024 * 1024) {
      addToast('Изображение слишком большое. Максимум 10 МБ', 'error');
      return;
    }

    try {
      const prepared = await toJpeg(file);
      setPendingFile(prepared);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result);
      reader.readAsDataURL(prepared);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleUpload = async () => {
    if (!pendingFile) return;

    setUploading(true);
    try {
      // 1. Загружаем файл — получаем короткую ссылку /files/<id>
      const formData = new FormData();
      formData.append('file', pendingFile);

      const uploadRes = await fetch('/upload/image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Не удалось загрузить изображение');
      }

      const { url } = await uploadRes.json();
      if (!url) throw new Error('Сервер не вернул ссылку на файл');

      // 2. Пишем ссылку в профиль
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ avatar: url }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Не удалось обновить аватар');
      }

      addToast('Аватар обновлен!', 'success');
      setPreview(null);
      setPendingFile(null);
      await onAvatarUpdate();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!currentAvatar && !preview) return;

    setUploading(true);
    try {
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ avatar: '' }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Не удалось удалить аватар');
      }

      addToast('Аватар удален', 'success');
      setPreview(null);
      setPendingFile(null);
      onAvatarUpdate();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Preview или текущий аватар */}
      {preview ? (
        <div className="space-y-3">
          <div className="flex justify-center">
            <img
              src={preview}
              alt="Preview"
              className="w-32 h-32 rounded-full object-cover border-4 border-indigo-600 shadow-lg"
            />
          </div>
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
            >
              {uploading ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setPendingFile(null); }}
              disabled={uploading}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white text-sm font-bold rounded-xl transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-colors"
            >
              {currentAvatar ? 'Изменить аватар' : 'Загрузить аватар'}
            </button>
            {currentAvatar && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={uploading}
                className="px-4 py-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-sm font-bold rounded-xl transition-colors"
              >
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Компонент для отображения аватара пользователя
 * Fallback к инициалам если нет аватара
 */
export function Avatar({ user, size = 'md', className = '' }) {
  const sizes = {
    xs: 'w-6 h-6 text-xs',
    sm: 'w-8 h-8 text-xs',
    md: 'w-12 h-12 text-base',
    lg: 'w-16 h-16 text-xl',
    xl: 'w-24 h-24 text-3xl',
    '2xl': 'w-32 h-32 text-4xl'
  };

  const sizeClass = sizes[size] || sizes.md;

  // Получаем инициалы
  const getInitials = () => {
    if (!user) return '?';
    if (user.name) {
      const parts = user.name.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return user.name[0].toUpperCase();
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return '?';
  };

  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.name || user.email}
        className={`${sizeClass} rounded-full object-cover ${className}`}
      />
    );
  }

  // Fallback к инициалам
  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-white font-bold flex items-center justify-center ${className}`}
    >
      {getInitials()}
    </div>
  );
}

/**
 * Компонент аватара с online статусом
 */
export function AvatarWithStatus({ user, isOnline, size = 'md', className = '' }) {
  return (
    <div className="relative inline-block">
      <Avatar user={user} size={size} className={className} />
      {isOnline !== undefined && (
        <span
          className={`absolute bottom-0 right-0 block rounded-full ring-2 ring-white dark:ring-slate-800 ${
            size === 'xs' || size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
          } ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`}
        />
      )}
    </div>
  );
}
