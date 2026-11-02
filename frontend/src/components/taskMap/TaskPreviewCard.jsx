// Карточка задания внизу карты: открывается по нажатию на метку.
import React from 'react';
import { IconClose, IconPin } from '../icons.jsx';
import { CATEGORY_ICONS, CATEGORY_NAMES, calculateDistance } from './taskMapConfig.js';

export default function TaskPreviewCard({ activePreviewTask, userLocation, userRole, onTaskClick, onClose }) {
    return (
        <div className="absolute bottom-3 left-3 right-3 md:left-auto md:right-3 md:max-w-md z-20 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="glass rounded-2xl p-4 md:p-5 shadow-pop border border-accent/40 bg-surface/95 backdrop-blur-md">
                {/* Header & Close */}
                <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-full bg-surface-2 border border-border text-ink text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5">
                            {CATEGORY_ICONS[activePreviewTask.category] || '📌'} {CATEGORY_NAMES[activePreviewTask.category] || activePreviewTask.category}
                        </span>
                        {userLocation && (
                            <span className="rounded-full bg-accent/20 border border-accent/40 text-accent-bright text-[10px] font-bold px-2 py-0.5">
                                <IconPin /> ~{calculateDistance(userLocation[0], userLocation[1], activePreviewTask.latitude, activePreviewTask.longitude)} км от вас
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-7 h-7 rounded-full bg-surface-2 hover:bg-elevated text-muted hover:text-ink flex items-center justify-center text-sm font-bold transition"
                        title="Закрыть"
                    >
                        <IconClose />
                    </button>
                </div>

                {/* Title & Price */}
                <div className="flex justify-between items-baseline gap-2 mb-1.5">
                    <h4 className="font-extrabold text-base text-ink line-clamp-1">
                        {activePreviewTask.title}
                    </h4>
                    <span className="font-display font-bold text-accent-bright text-base whitespace-nowrap">
                        {activePreviewTask.budget ? `${Number(activePreviewTask.budget).toLocaleString('ru-RU')} ₽` : 'Договорная'}
                    </span>
                </div>

                {/* Address & Description */}
                <div className="text-xs text-muted mb-2 flex items-center gap-1.5 font-medium">
                    <span><IconPin /> {activePreviewTask.city}{activePreviewTask.address ? `, ${activePreviewTask.address}` : ''}</span>
                </div>
                <p className="text-xs text-ink/80 line-clamp-2 mb-3 leading-relaxed">
                    {activePreviewTask.description}
                </p>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                    <span className="text-[11px] font-bold text-muted">
                        Статус: <span className={activePreviewTask.status === 'open' ? 'text-success' : 'text-muted'}>{activePreviewTask.status === 'open' ? 'Открыт' : activePreviewTask.status}</span>
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (onTaskClick) {
                                    onTaskClick(activePreviewTask.id);
                                }
                            }}
                            className="px-4 py-2 bg-accent hover:bg-accent-bright text-white rounded-xl text-xs font-display uppercase tracking-wider transition glow-accent-sm"
                        >
                            {userRole === 'specialist' && activePreviewTask.status === 'open' ? 'Откликнуться' : 'Подробнее'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
