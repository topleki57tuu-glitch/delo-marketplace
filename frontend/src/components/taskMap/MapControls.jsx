// Панель поверх карты: «Рядом со мной», «Все метки», полноэкранный режим,
// фильтр по радиусу (когда известно местоположение) и по категориям.
import React from 'react';
import { IconPin, IconTarget } from '../icons.jsx';
import { CATEGORY_ICONS, CATEGORY_NAMES, RADIUS_OPTIONS } from './taskMapConfig.js';

export default function MapControls({
    locateUser,
    geoLocating,
    userLocation,
    fitAllMarkers,
    filteredTasks,
    tasksWithLocation,
    isFullscreen,
    setIsFullscreen,
    selectedRadius,
    setSelectedRadius,
    availableCategories,
    activeCategory,
    setActiveCategory,
}) {
    return (
        <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 pointer-events-none z-10">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                {/* Left Quick Actions */}
                <div className="flex items-center gap-1.5 glass rounded-xl p-1 pointer-events-auto shadow-card">
                    <button
                        type="button"
                        onClick={locateUser}
                        disabled={geoLocating}
                        title="Определить мое местоположение"
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${userLocation ? 'bg-accent text-white glow-accent-sm' : 'bg-surface-2 text-ink hover:bg-elevated'}`}
                    >
                        {geoLocating ? (
                            <span className="animate-spin text-sm">⏳</span>
                        ) : (
                            <span className="text-sm"><IconPin /></span>
                        )}
                        <span className="hidden sm:inline">Рядом со мной</span>
                    </button>

                    <button
                        type="button"
                        onClick={fitAllMarkers}
                        title="Показать все заказы на карте"
                        className="px-2.5 py-1.5 bg-surface-2 hover:bg-elevated text-ink rounded-lg text-xs font-bold transition flex items-center gap-1"
                    >
                        <span><IconTarget /></span>
                        <span className="hidden sm:inline">Все метки ({filteredTasks.length})</span>
                    </button>
                </div>

                {/* Right View Controls */}
                <div className="flex items-center gap-1.5 glass rounded-xl p-1 pointer-events-auto shadow-card">
                    <button
                        type="button"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        title={isFullscreen ? "Свернуть" : "На весь экран"}
                        className="p-1.5 px-2.5 bg-surface-2 hover:bg-elevated text-ink rounded-lg text-xs font-bold transition flex items-center gap-1"
                    >
                        <span>{isFullscreen ? '✕' : '⛶'}</span>
                        <span className="hidden md:inline">{isFullscreen ? 'Закрыть' : 'Во весь экран'}</span>
                    </button>
                </div>
            </div>

            {/* Radius filter pills (visible when location active) */}
            {userLocation && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pointer-events-auto no-scrollbar">
                    <span className="glass rounded-lg px-2.5 py-1 text-[11px] font-bold text-muted uppercase tracking-wider whitespace-nowrap shadow-sm">
                        Радиус:
                    </span>
                    {RADIUS_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSelectedRadius(opt.value)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition shadow-sm ${selectedRadius === opt.value ? 'bg-accent text-white glow-accent-sm' : 'glass text-ink hover:bg-surface-2'}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Categories quick bar */}
            {availableCategories.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pointer-events-auto no-scrollbar">
                    <button
                        type="button"
                        onClick={() => setActiveCategory('')}
                        className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition shadow-sm ${activeCategory === '' ? 'bg-accent text-white glow-accent-sm' : 'glass text-ink hover:bg-surface-2'}`}
                    >
                        Все ({tasksWithLocation.length})
                    </button>
                    {availableCategories.map(cat => (
                        <button
                            key={cat}
                            type="button"
                            onClick={() => setActiveCategory(cat === activeCategory ? '' : cat)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition shadow-sm flex items-center gap-1 ${activeCategory === cat ? 'bg-accent text-white glow-accent-sm' : 'glass text-ink hover:bg-surface-2'}`}
                        >
                            <span>{CATEGORY_ICONS[cat] || '📌'}</span>
                            <span>{CATEGORY_NAMES[cat] || cat}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
