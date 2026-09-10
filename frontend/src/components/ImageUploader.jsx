import React, { useState } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export const ImageUploader = ({ token, endpoint, onUploadSuccess, buttonText = "Загрузить фото", accept = "image/*" }) => {
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

            const res = await axios.post(`${API_URL}${endpoint}`, formData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data'
                }
            });

            if (onUploadSuccess) {
                onUploadSuccess(res.data.url);
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Ошибка загрузки файла');
        } finally {
            setUploading(false);
            e.target.value = ''; // Reset input
        }
    };

    return (
        <div className="inline-block">
            <label className={`${uploading ? 'opacity-50 cursor-wait' : 'cursor-pointer'} inline-flex items-center gap-2 rounded-xl bg-accent text-white px-4 py-2.5 font-display text-[11px] uppercase tracking-wider transition hover:bg-accent-bright hover:glow-accent-sm`}>
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
            {error && <p className="text-danger text-sm mt-2 font-bold">{error}</p>}
        </div>
    );
};

export const AvatarUploader = ({ token, currentAvatar, onUploadSuccess }) => {
    return (
        <div className="flex flex-col items-start gap-3">
            {currentAvatar && (
                <img src={currentAvatar} alt="Avatar" className="w-32 h-32 object-cover rounded-xl border border-border" />
            )}
            <ImageUploader
                token={token}
                endpoint="/upload/avatar"
                onUploadSuccess={onUploadSuccess}
                buttonText="Изменить аватар"
            />
        </div>
    );
};

export const PortfolioUploader = ({ token, portfolio = [], onUploadSuccess }) => {
    return (
        <div>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h3 className="font-display font-bold uppercase text-sm">Портфолио</h3>
                <ImageUploader
                    token={token}
                    endpoint="/upload/portfolio"
                    onUploadSuccess={onUploadSuccess}
                    buttonText="Добавить работу"
                />
            </div>

            {portfolio.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {portfolio.map((img, idx) => (
                        <div key={idx} className="relative group">
                            <img
                                src={img}
                                alt={`Portfolio ${idx + 1}`}
                                className="w-full h-32 object-cover rounded-xl border border-border transition hover:border-accent/60 hover:glow-accent-sm cursor-pointer"
                                onClick={() => window.open(img, '_blank')}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-8 rounded-xl bg-surface-2/60 border border-dashed border-border-bright/60">
                    <p className="text-muted font-semibold">Портфолио пока пусто. Добавьте примеры своих работ!</p>
                </div>
            )}
        </div>
    );
};
