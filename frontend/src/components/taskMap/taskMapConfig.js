// Настройки карты заданий: ключ и адрес API Яндекс Карт, центр по
// умолчанию, значки и короткие названия категорий, радиусы поиска.

export const YANDEX_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY || '';
// csp=true — режим для сайтов с Content-Security-Policy: стили API подключает
// через blob:, а не встроенными <style>. Политика — frontend/nginx-security-headers.conf.
export const YMAPS_URL = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU&csp=true`;
export const MOSCOW_CENTER = [55.751574, 37.573856];

// Haversine formula to calculate distance in km
export function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
}

export const CATEGORY_ICONS = {
    design: '🎨',
    development: '💻',
    writing: '✍',
    repairs: '🔧',
    cleaning: '🧹',
    delivery: '🚚',
    photo_video: '📷',
    tutoring: '📚',
    beauty: '💄',
    events: '🎉',
    business: '💼',
    other: '📦'
};

export const CATEGORY_NAMES = {
    design: 'Дизайн',
    development: 'Разработка',
    writing: 'Тексты',
    repairs: 'Ремонт',
    cleaning: 'Уборка',
    delivery: 'Доставка',
    photo_video: 'Фото/Видео',
    tutoring: 'Репетиторство',
    beauty: 'Красота',
    events: 'Мероприятия',
    business: 'Бизнес',
    other: 'Другое'
};

export const RADIUS_OPTIONS = [
    { label: 'Все', value: 0 },
    { label: '5 км', value: 5 },
    { label: '10 км', value: 10 },
    { label: '25 км', value: 25 },
    { label: '50 км', value: 50 },
];
