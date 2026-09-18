import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';

// Относительный путь — запросы уходят через Vite-прокси на backend
//
// Компонент поддерживает два режима:
//   1. Список изображений (товары, задания): images + setImages/onChange —
//      загруженный файл добавляется в массив, рядом с кнопкой рисуется
//      превью с возможностью удалить.
//   2. Одиночный файл (аватар, портфолио): onUploadSuccess(url) — компонент
//      отдаёт ссылку наружу и ничего не хранит.
//
// Раньше был только второй режим, а страницы товаров и заданий вызывали его
// первым: файл загружался на сервер, но ссылка никуда не попадала — фото
// молча не прикреплялось к объявлению. В CreateProductPage это вдобавок
// ломало сборку (default-импорт при именованном экспорте).
export const ImageUploader = ({
    token,
    endpoint = '/upload/image',
    onUploadSuccess,
    buttonText = 'Загрузить фото',
    accept = 'image/*',
    images,
    setImages,
    onChange,
    maxImages = 10,
}) => {
    const storeToken = useAuthStore((s) => s.token);
    const authToken = token || storeToken;

    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    const list = Array.isArray(images) ? images : null;
    // Страницы передают сеттер и как setImages, и как onChange — принимаем оба.
    const update = setImages || onChange;
    const isListMode = list !== null && typeof update === 'function';
    const limitReached = isListMode && list.length >= maxImages;

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            setError('Файл слишком большой. Максимум 5 МБ.');
            return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            setError('Можно загружать только изображения.');
            return;
        }

        setError('');
        setUploading(true);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Ошибка загрузки файла');

            if (isListMode) {
                update([...list, data.url]);
            } else if (onUploadSuccess) {
                onUploadSuccess(data.url);
            }
        } catch (err) {
            setError(err.message || 'Ошибка загрузки файла');
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    const handleRemove = (index) => {
        if (!isListMode) return;
        update(list.filter((_, i) => i !== index));
    };

    const button = (
        <label className={`${uploading || limitReached ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 text-xs font-bold shadow-md shadow-indigo-600/20 transition-all`}>
            {uploading ? (
                <>
                    <span className="animate-spin">⏳</span>
                    <span>Загрузка...</span>
                </>
            ) : (
                <>
                    <span>📤</span>
                    <span>{buttonText}</span>
                </>
            )}
            <input
                type="file"
                accept={accept}
                onChange={handleFileSelect}
                disabled={uploading || limitReached}
                className="hidden"
            />
        </label>
    );

    if (!isListMode) {
        return (
            <div className="inline-block">
                {button}
                {error && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-semibold">{error}</p>}
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center gap-3 flex-wrap">
                {button}
                <span className="text-xs font-semibold text-slate-400">
                    {list.length} из {maxImages}
                </span>
            </div>

            {error && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-semibold">{error}</p>}

            {list.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4">
                    {list.map((url, idx) => (
                        <div key={`${url}-${idx}`} className="relative group">
                            <img
                                src={url}
                                alt={`Изображение ${idx + 1}`}
                                className="w-full h-24 object-cover rounded-xl border border-slate-200 dark:border-slate-700"
                            />
                            <button
                                type="button"
                                onClick={() => handleRemove(idx)}
                                title="Удалить изображение"
                                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-lg transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const AvatarUploader = ({ token, currentAvatar, onUploadSuccess }) => {
    return (
        <div className="flex flex-col items-start gap-3">
            {currentAvatar && (
                <img src={currentAvatar} alt="Avatar" className="w-32 h-32 object-cover rounded-xl border border-slate-200 dark:border-slate-700" />
            )}
            <ImageUploader
                token={token}
                endpoint="/upload/image"
                onUploadSuccess={onUploadSuccess}
                buttonText="Изменить аватар"
            />
        </div>
    );
};

export const PortfolioUploader = ({ token, portfolio = [], onUploadSuccess, onDelete }) => {
    return (
        <div>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Портфолио</h3>
                <ImageUploader
                    token={token}
                    endpoint="/upload/image"
                    onUploadSuccess={onUploadSuccess}
                    buttonText="Добавить работу"
                />
            </div>

            {portfolio.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {portfolio.map((item, idx) => {
                        const url = typeof item === 'string' ? item : item.image_url;
                        return (
                            <div key={idx} className="relative group">
                                <img
                                    src={url}
                                    alt={`Portfolio ${idx + 1}`}
                                    className="w-full h-32 object-cover rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
                                    onClick={() => window.open(url, '_blank')}
                                />
                                {onDelete && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(idx);
                                        }}
                                        title="Удалить из портфолио"
                                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-lg transition-colors md:opacity-0 md:group-hover:opacity-100"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="text-center py-8 rounded-xl bg-slate-50 dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-600">
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Портфолио пока пусто. Добавьте примеры своих работ!</p>
                </div>
            )}
        </div>
    );
};
