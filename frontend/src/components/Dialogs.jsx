import React, { useCallback, useEffect, useRef } from 'react';

// Esc closes the modal; focus moves into the panel on open
export const useModalBehavior = (onClose) => {
    const ref = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') closeRef.current();
        };
        document.addEventListener('keydown', onKey);
        if (ref.current) ref.current.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    return ref;
};

export const ConfirmDialog = ({ title, message, confirmText = 'Подтвердить', onConfirm, onClose }) => {
    const panelRef = useModalBehavior(onClose);
    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[90]">
            <div ref={panelRef} tabIndex={-1} className="glass rounded-2xl shadow-pop w-full max-w-sm p-6 outline-none focus:ring-2 focus:ring-accent/50">
                <h3 className="font-display font-bold uppercase text-lg">{title}</h3>
                <p className="mt-3 text-muted font-semibold text-sm">{message}</p>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="inline-flex items-center rounded-xl bg-surface-2 text-ink border border-border px-5 py-2.5 font-display text-xs uppercase tracking-wider transition hover:border-border-bright hover:bg-elevated">Отмена</button>
                    <button onClick={() => { onConfirm(); onClose(); }} className="inline-flex items-center rounded-xl bg-accent text-white px-5 py-2.5 font-display text-xs uppercase tracking-wider transition hover:bg-accent-bright hover:glow-accent-sm">{confirmText}</button>
                </div>
            </div>
        </div>
    );
};

export const Lightbox = ({ images, index, onClose, onNavigate }) => {
    const handleKey = useCallback((e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
        if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1);
    }, [index, images.length, onClose, onNavigate]);

    useEffect(() => {
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [handleKey]);

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[95] p-4" onClick={onClose}>
            <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="absolute top-4 right-4 w-11 h-11 glass rounded-xl font-extrabold text-xl flex items-center justify-center transition hover:border-accent/60"
                aria-label="Закрыть просмотр"
            >
                ×
            </button>

            {images.length > 1 && (
                <>
                    <button
                        onClick={(e) => { e.stopPropagation(); if (index > 0) onNavigate(index - 1); }}
                        disabled={index === 0}
                        className="absolute left-4 w-11 h-11 glass rounded-xl font-extrabold text-xl flex items-center justify-center transition hover:border-accent/60 disabled:opacity-30"
                        aria-label="Предыдущее фото"
                    >
                        ‹
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); if (index < images.length - 1) onNavigate(index + 1); }}
                        disabled={index === images.length - 1}
                        className="absolute right-4 w-11 h-11 glass rounded-xl font-extrabold text-xl flex items-center justify-center transition hover:border-accent/60 disabled:opacity-30"
                        aria-label="Следующее фото"
                    >
                        ›
                    </button>
                </>
            )}

            <img
                src={images[index]}
                alt={`Фото ${index + 1} из ${images.length}`}
                className="max-w-full max-h-[85vh] object-contain rounded-2xl border border-border shadow-pop"
                onClick={(e) => e.stopPropagation()}
            />

            {images.length > 1 && (
                <div className="absolute bottom-5 glass rounded-full px-3.5 py-1 font-display text-xs">
                    {index + 1} / {images.length}
                </div>
            )}
        </div>
    );
};
