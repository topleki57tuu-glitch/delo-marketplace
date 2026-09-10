import React, { useEffect, useRef } from 'react';
import CityInput from './CityInput';

export const MobileFilterDrawer = ({
    isOpen,
    onClose,
    categoryFilter,
    setCategoryFilter,
    cityFilter,
    setCityFilter,
    remoteOnly,
    setRemoteOnly,
    sortBy,
    setSortBy,
    categories = [],
    cities = [],
    totalCount = 0,
    activeFiltersCount = 0,
    onReset
}) => {
    const drawerRef = useRef(null);

    // Close on Escape or click outside
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            window.addEventListener('keydown', handleKeyDown);
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Bottom Sheet Drawer */}
            <div
                ref={drawerRef}
                className="relative w-full max-h-[88vh] bg-surface border-t border-border rounded-t-3xl shadow-pop flex flex-col z-10 animate-in slide-in-from-bottom duration-300 pb-[max(env(safe-area-inset-bottom),1rem)]"
            >
                {/* Drag Handle & Header */}
                <div className="pt-3 pb-2 px-6 flex flex-col items-center border-b border-border">
                    <div className="w-12 h-1.5 bg-border-bright rounded-full mb-3" />
                    <div className="w-full flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="font-display font-bold uppercase text-lg text-ink">
                                Фильтры
                            </h3>
                            {activeFiltersCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-extrabold">
                                    {activeFiltersCount}
                                </span>
                            )}
                        </div>
                        {activeFiltersCount > 0 && (
                            <button
                                type="button"
                                onClick={onReset}
                                className="text-xs font-bold text-danger hover:underline"
                            >
                                Сбросить всё
                            </button>
                        )}
                    </div>
                </div>

                {/* Scrollable Filter Content */}
                <div className="overflow-y-auto px-6 py-4 flex flex-col gap-5 flex-1">
                    {/* 1. Categories */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-2">
                            Категория
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setCategoryFilter('')}
                                className={`p-2.5 rounded-xl text-xs font-bold text-left transition border ${
                                    categoryFilter === ''
                                        ? 'bg-accent text-white border-accent glow-accent-sm'
                                        : 'bg-surface-2 text-ink border-border'
                                }`}
                            >
                                🌟 Все категории
                            </button>
                            {categories.map((cat) => (
                                <button
                                    key={cat.value}
                                    type="button"
                                    onClick={() => setCategoryFilter(categoryFilter === cat.value ? '' : cat.value)}
                                    className={`p-2.5 rounded-xl text-xs font-bold text-left truncate transition border ${
                                        categoryFilter === cat.value
                                            ? 'bg-accent text-white border-accent glow-accent-sm'
                                            : 'bg-surface-2 text-ink border-border'
                                    }`}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 2. City: ручной ввод + выбор из списка */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-2">
                            Город
                        </label>
                        <CityInput
                            value={cityFilter}
                            onChange={setCityFilter}
                            placeholder="Все города (или введите любой)..."
                            className="w-full h-12 rounded-xl border border-border bg-surface-2 text-ink px-3 font-semibold outline-none focus:border-accent"
                        />
                    </div>

                    {/* 3. Remote Only */}
                    <div>
                        <label className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-surface-2 cursor-pointer select-none">
                            <span className="font-bold text-sm text-ink">🌐 Только удалённая работа</span>
                            <input
                                type="checkbox"
                                checked={remoteOnly}
                                onChange={(e) => setRemoteOnly(e.target.checked)}
                                className="w-5 h-5 accent-accent"
                            />
                        </label>
                    </div>

                    {/* 4. Sorting */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-2">
                            Сортировка
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { value: 'default', label: 'По умолчанию' },
                                { value: 'newest', label: 'Сначала новые' },
                                { value: 'budget_desc', label: 'Бюджет ↓' },
                                { value: 'budget_asc', label: 'Бюджет ↑' }
                            ].map((s) => (
                                <button
                                    key={s.value}
                                    type="button"
                                    onClick={() => setSortBy(s.value)}
                                    className={`p-2.5 rounded-xl text-xs font-bold text-center transition border ${
                                        sortBy === s.value
                                            ? 'bg-accent text-white border-accent glow-accent-sm'
                                            : 'bg-surface-2 text-ink border-border'
                                    }`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer Apply CTA */}
                <div className="p-4 border-t border-border flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full py-3.5 bg-accent hover:bg-accent-bright text-white rounded-xl font-display text-xs uppercase tracking-wider transition glow-accent-sm"
                    >
                        Показать результаты {totalCount > 0 ? `(${totalCount})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};
