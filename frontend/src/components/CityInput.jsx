import React, { useState, useRef, useEffect } from 'react';

// Популярные города России и СНГ для быстрых подсказок
export const POPULAR_CITIES = [
    "Москва",
    "Санкт-Петербург",
    "Новосибирск",
    "Екатеринбург",
    "Казань",
    "Нижний Новгород",
    "Красноярск",
    "Челябинск",
    "Самара",
    "Уфа",
    "Ростов-на-Дону",
    "Краснодар",
    "Омск",
    "Воронеж",
    "Пермь",
    "Волгоград",
    "Саратов",
    "Тюмень",
    "Тольятти",
    "Барнаул",
    "Ижевск",
    "Ульяновск",
    "Иркутск",
    "Владивосток",
    "Ярославль",
    "Севастополь",
    "Ставрополь",
    "Хабаровск",
    "Махачкала",
    "Оренбург",
    "Новокузнецк",
    "Кемерово",
    "Рязань",
    "Томск",
    "Астрахань",
    "Пенза",
    "Набережные Челны",
    "Липецк",
    "Тула",
    "Киров",
    "Чебоксары",
    "Калининград",
    "Брянск",
    "Курск",
    "Иваново",
    "Магнитогорск",
    "Улан-Удэ",
    "Тверь",
    "Сочи",
    "Сургут",
    "Нижний Тагил",
    "Белгород",
    "Архангельск",
    "Владимир",
    "Калуга",
    "Чита",
    "Смоленск",
    "Волжский",
    "Курган",
    "Орёл",
    "Череповец",
    "Владикавказ",
    "Саранск",
    "Мурманск",
    "Тамбов",
    "Грозный",
    "Стерлитамак",
    "Кострома",
    "Петрозаводск",
    "Нижневартовск",
    "Новороссийск",
    "Йошкар-Ола",
    "Таганрог",
    "Комсомольск-на-Амуре",
    "Сыктывкар",
    "Нальчик",
    "Шахты",
    "Дзержинск",
    "Орск",
    "Братск",
    "Ангарск",
    "Энгельс",
    "Благовещенск",
    "Старый Оскол",
    "Великий Новгород",
    "Королёв",
    "Псков",
    "Мытищи",
    "Бийск",
    "Люберцы",
    "Прокопьевск",
    "Южно-Сахалинск",
    "Армавир",
    "Балаково",
    "Рыбинск",
    "Абакан",
    "Северодвинск",
    "Петропавловск-Камчатский",
    "Норильск",
    "Уссурийск",
    "Волгодонск",
    "Сызрань",
    "Каменск-Уральский",
    "Новочеркасск",
    "Златоуст",
    "Красногорск",
    "Химки",
    "Балашиха",
    "Подольск",
    "Одинцово",
    "Домодедово",
    "Минск",
    "Алматы",
    "Астана",
    "Ташкент",
    "Ереван",
    "Баку",
    "Тбилиси",
    "Бишкек"
];

/**
 * Универсальный компонент выбора/ввода города:
 * 1. Можно ввести абсолютно любой город вручную
 * 2. При вводе появляются подходящие подсказки из базы городов
 * 3. Поддерживает быстрый выбор из выпадающего меню
 * 4. Кнопка быстрой очистки
 */
export default function CityInput({
    value = '',
    onChange,
    placeholder = 'Введите или выберите город...',
    className = '',
    allowClear = true,
    showPopularDropdown = true
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(value || '');
    const wrapperRef = useRef(null);

    // Синхронизация внешнего значения
    useEffect(() => {
        setSearchTerm(value || '');
    }, [value]);

    // Закрытие выпадающего списка при клике вне компонента
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleInputChange = (e) => {
        const val = e.target.value;
        setSearchTerm(val);
        onChange(val);
        setIsOpen(true);
    };

    const handleSelectCity = (city) => {
        setSearchTerm(city);
        onChange(city);
        setIsOpen(false);
    };

    const handleClear = (e) => {
        e.stopPropagation();
        setSearchTerm('');
        onChange('');
        setIsOpen(false);
    };

    // Фильтрация вариантов по введенному тексту
    const query = (searchTerm || '').trim().toLowerCase();
    const filteredCities = query
        ? POPULAR_CITIES.filter(c => c.toLowerCase().includes(query))
        : POPULAR_CITIES.slice(0, 15);

    const isCustomValue = query && !POPULAR_CITIES.some(c => c.toLowerCase() === query);

    return (
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative flex items-center">
                <input
                    type="text"
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    className={`${className} pr-14`}
                    autoComplete="off"
                />
                <div className="absolute right-2.5 flex items-center gap-1">
                    {allowClear && searchTerm && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-1 text-ink-muted hover:text-ink transition rounded-md text-xs"
                            title="Очистить"
                        >
                            ✕
                        </button>
                    )}
                    {showPopularDropdown && (
                        <button
                            type="button"
                            onClick={() => setIsOpen(!isOpen)}
                            className="p-1 text-ink-muted hover:text-accent transition rounded-md"
                            title="Показать варианты"
                        >
                            <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Выпадающий список вариантов */}
            {isOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 max-h-60 overflow-y-auto z-50 rounded-xl bg-surface-1 border border-border/80 shadow-2xl backdrop-blur-xl py-1.5 animate-in fade-in zoom-in-95 duration-150">
                    {isCustomValue && (
                        <button
                            type="button"
                            onClick={() => handleSelectCity(searchTerm.trim())}
                            className="w-full text-left px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent/10 border-b border-border/50 flex items-center justify-between transition"
                        >
                            <span>📍 Использовать: <b>«{searchTerm.trim()}»</b></span>
                            <span className="text-[10px] text-ink-muted font-normal">Свой город</span>
                        </button>
                    )}

                    {filteredCities.length > 0 ? (
                        <>
                            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                                {query ? 'Подходящие города' : 'Популярные города'}
                            </div>
                            {filteredCities.map((city) => (
                                <button
                                    key={city}
                                    type="button"
                                    onClick={() => handleSelectCity(city)}
                                    className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition hover:bg-surface-2 ${
                                        searchTerm === city ? 'bg-accent/15 text-accent font-bold' : 'text-ink'
                                    }`}
                                >
                                    <span>📍 {city}</span>
                                    {searchTerm === city && <span className="text-accent text-xs">✓</span>}
                                </button>
                            ))}
                        </>
                    ) : (
                        <div className="px-3.5 py-3 text-xs text-ink-muted text-center">
                            Город <b>«{searchTerm}»</b> не в списке, но вы можете использовать его — просто нажмите Enter или оставьте в поле.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
