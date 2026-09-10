import React, { useState } from 'react';

// Относительный путь — запросы уходят через Vite-прокси на backend
export const ImageUploader = ({ token, endpoint = '/upload/image', onUploadSuccess, buttonText = "Загрузить фото", accept = "image/*" }) => {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

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
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Ошибка загрузки файла');

            if (onUploadSuccess) {
                onUploadSuccess(data.url);
            }
        } catch (err) {
            setError(err.message || 'Ошибка загрузки файла');
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    return (
        <div className="inline-block">
            <label className={`${uploading ? 'opacity-50 cursor-wait' : 'cursor-pointer'} inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 text-xs font-bold shadow-md shadow-indigo-600/20 transition-all`}>
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
                    disabled={uploading}
                    className="hidden"
                />
            </label>
            {error && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-semibold">{error}</p>}
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
                                        onClick={() => onDelete(idx)}
                                        title="Удалить из портфолио"
                                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-slate-900/70 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
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
