import React, { useState, useRef, useEffect, useMemo } from 'react';
import { IconCheck, IconClose, IconPin, IconPlus } from '../components/icons.jsx';

// Обширная база городов России по всем федеральным округам и ключевым регионам
export const POPULAR_CITIES = [
    // Города федерального значения и миллионники
    "Москва",
    "Санкт-Петербург",
    "Севастополь",
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
    // Крупные областные и краевые центры
    "Саратов",
    "Тюмень",
    "Тольятти",
    "Барнаул",
    "Ижевск",
    "Ульяновск",
    "Иркутск",
    "Владивосток",
    "Ярославль",
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
    "Ставрополь",
    "Сочи",
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
    "Нижний Тагил",
    "Шахты",
    "Дзержинск",
    "Орск",
    "Братск",
    "Ангарск",
    "Энгельс",
    "Благовещенск",
    "Старый Оскол",
    "Великий Новгород",
    "Псков",
    "Бийск",
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
    "Альметьевск",
    "Элиста",
    "Майкоп",
    "Черкесск",
    "Кызыл",
    "Горно-Алтайск",
    "Анапа",
    "Геленджик",
    "Ессентуки",
    "Кисловодск",
    "Пятигорск",
    "Минеральные Воды",
    "Дербент",
    "Каспийск",
    "Хасавюрт",
    "Муром",
    "Ковров",
    "Великие Луки",
    "Выборг",
    "Гатчина",
    "Всеволожск",
    "Кингисепп",
    "Тихвин",
    "Тосно",
    "Кронштадт",
    "Колпино",
    "Петергоф",
    "Пушкин",
    "Красногорск",
    "Химки",
    "Балашиха",
    "Подольск",
    "Одинцово",
    "Домодедово",
    "Люберцы",
    "Мытищи",
    "Королёв",
    "Коломна",
    "Сергиев Посад",
    "Электросталь",
    "Щёлково",
    "Орехово-Зуево",
    "Раменское",
    "Жуковский",
    "Пушкино",
    "Долгопрудный",
    "Реутов",
    "Лобня",
    "Видное",
    "Ступино",
    "Наро-Фоминск",
    "Дмитров",
    "Чехов",
    "Клин",
    "Дубна",
    "Егорьевск",
    "Павловский Посад",
    "Солнечногорск",
    "Истра",
    "Сургут",
    "Ханты-Мансийск",
    "Нефтеюганск",
    "Новый Уренгой",
    "Ноябрьск",
    "Салехард",
    "Якутск",
    "Мирный",
    "Нерюнгри",
    "Магадан",
    "Анадырь",
    // Города Крыма
    "Симферополь",
    "Ялта",
    "Евпатория",
    "Керчь",
    "Феодосия",
    "Алушта",
    "Бахчисарай"
];

/**
 * Универсальный компонент выбора/ввода города:
 * 1. Позволяет ввести АБСОЛЮТНО ЛЮБОЙ город или населенный пункт РФ вручную.
 * 2. Предлагает быстрые подсказки из обширной базы городов.
 * 3. Если введенного города нет в списке, позволяет сохранить его в 1 клик.
 * 4. Полностью поддерживает очистку и сброс.
 */
export default function CityInput({
    value = '',
    onChange,
    placeholder = 'Любой город России (Москва, Казань, Сочи...)',
    className = '',
    allowClear = true,
    showPopularDropdown = true
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(typeof value === 'object' && value ? value.name : (value || ''));
    const wrapperRef = useRef(null);

    useEffect(() => {
        const valStr = typeof value === 'object' && value ? value.name : (value || '');
        setSearchTerm(valStr);
    }, [value]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredCities = useMemo(() => {
        if (!searchTerm.trim()) {
            return POPULAR_CITIES.slice(0, 18);
        }
        const term = searchTerm.toLowerCase().trim();
        return POPULAR_CITIES.filter(city => city.toLowerCase().includes(term)).slice(0, 18);
    }, [searchTerm]);

    const isExactMatch = useMemo(() => {
        if (!searchTerm.trim()) return true;
        return POPULAR_CITIES.some(c => c.toLowerCase() === searchTerm.toLowerCase().trim());
    }, [searchTerm]);

    const handleInputChange = (e) => {
        const val = e.target.value;
        setSearchTerm(val);
        if (onChange) onChange(val);
        setIsOpen(true);
    };

    const handleSelectCity = (city) => {
        setSearchTerm(city);
        if (onChange) onChange(city);
        setIsOpen(false);
    };

    const handleClear = (e) => {
        e.stopPropagation();
        setSearchTerm('');
        if (onChange) onChange('');
        setIsOpen(false);
    };

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 text-sm select-none">
                    <IconPin />
                </span>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    className="w-full pl-9 pr-10 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-900 dark:text-white"
                />
                {allowClear && searchTerm && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-3 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-white flex items-center justify-center text-xs font-bold transition-colors"
                        title="Очистить"
                    >
                        <IconClose />
                    </button>
                )}
            </div>

            {/* Выпадающий список подсказок */}
            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-50 max-h-72 overflow-y-auto overflow-x-hidden p-1.5 animate-in fade-in zoom-in-95 duration-100">
                    {/* Кастомный ввод, если город не в стандартном списке */}
                    {searchTerm.trim() && !isExactMatch && (
                        <button
                            type="button"
                            onClick={() => handleSelectCity(searchTerm.trim())}
                            className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 transition-colors flex items-center justify-between mb-1"
                        >
                            <span><IconPlus /> Использовать: «{searchTerm.trim()}»</span>
                            <span className="text-[10px] opacity-75">Любой населенный пункт РФ</span>
                        </button>
                    )}

                    <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        {searchTerm.trim() ? 'Найденные города РФ:' : 'Популярные города России:'}
                    </div>

                    {filteredCities.length > 0 ? (
                        filteredCities.map((city) => {
                            const isSelected = city.toLowerCase() === searchTerm.toLowerCase().trim();
                            return (
                                <button
                                    key={city}
                                    type="button"
                                    onClick={() => handleSelectCity(city)}
                                    className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center justify-between ${
                                        isSelected
                                            ? 'bg-indigo-600 text-white font-semibold'
                                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                                    }`}
                                >
                                    <span>{city}</span>
                                    {isSelected && <span><IconCheck /></span>}
                                </button>
                            );
                        })
                    ) : (
                        <div className="p-3 text-center text-xs text-slate-400">
                            Город не найден в быстром списке, но вы можете использовать «{searchTerm.trim()}»
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
