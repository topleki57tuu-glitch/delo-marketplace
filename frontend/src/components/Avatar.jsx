import React, { useState, useRef } from 'react';
import { useToast } from './Toast';

/**
 * Компонент для загрузки и отображения аватара пользователя
 * Поддерживает: загрузку файла, preview, crop (базовый), base64 encoding
 */
export function AvatarUploader({ currentAvatar, onAvatarUpdate, token }) {
  const { addToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Валидация типа файла
    if (!file.type.startsWith('image/')) {
      addToast('Пожалуйста, выберите изображение', 'error');
      return;
    }

    // Валидация размера (макс 5MB)
    if (file.size > 5 * 1024 * 1024) {
      addToast('Изображение слишком большое. Максимум 5MB', 'error');
      return;
    }

    // Читаем файл и показываем preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!preview) return;

    console.log('[Avatar] handleUpload started');
    console.log('[Avatar] preview length:', preview.length);
    console.log('[Avatar] token exists:', !!token);

    setUploading(true);
    try {
      console.log('[Avatar] Sending PUT /users/me...');
      // Отправляем base64 изображение на сервер
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ avatar: preview })
      });

      console.log('[Avatar] Response status:', res.status);

      if (!res.ok) {
        const errorData = await res.json();
        console.error('[Avatar] Error response:', errorData);
        throw new Error(errorData.detail || 'Не удалось обновить аватар');
      }

      const responseData = await res.json();
      console.log('[Avatar] Success response:', responseData);

      addToast('Аватар обновлен!', 'success');
      setPreview(null);

      console.log('[Avatar] Calling onAvatarUpdate...');
      // Принудительно обновляем данные пользователя
      await onAvatarUpdate();

      // Дополнительная задержка и повторное обновление для надёжности
      setTimeout(() => {
        console.log('[Avatar] Calling onAvatarUpdate again (delayed)...');
        onAvatarUpdate();
      }, 1000);
    } catch (err) {
      console.error('[Avatar] Exception:', err);
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
      console.log('[Avatar] handleUpload finished');
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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ avatar: "" })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Не удалось удалить аватар');
      }

      addToast('Аватар удален', 'success');
      setPreview(null);
      onAvatarUpdate(); // Перезагружаем данные пользователя
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
              onClick={() => setPreview(null)}
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
