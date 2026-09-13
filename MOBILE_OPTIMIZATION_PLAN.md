# План оптимизации загрузки на мобильных

## Текущее состояние (анализ bundle):

```
159KB - react-vendor (React + ReactDOM + React Router)
53KB  - index.js (main app)
47KB  - ProfilePage
32KB  - ChatsPage
24KB  - date-fns vendor
21KB  - TasksPage
21KB  - TaskDetailPage
```

**Total initial load: ~235KB JS** (без gzip)
**С gzip: ~75KB**

## Проблемы:

1. **date-fns vendor (24KB)**: Импортирует весь locale, хотя используется только formatDistanceToNow, format, isToday, isYesterday
2. **Нет compression в dev**: В production нужен Brotli/Gzip на nginx
3. **Нет preload для критичных chunk'ов**
4. **axios (используется только в 1-2 местах)**: можно заменить на fetch

## Решения:

### 1. Tree-shake date-fns (экономия ~15KB)

Заменить:
```javascript
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
```

На:
```javascript
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import ru from 'date-fns/locale/ru';
```

### 2. Удалить axios, использовать fetch

axios используется редко, fetch нативный и бесплатный.

### 3. Code splitting для тяжелых страниц

ProfilePage (47KB) и ChatsPage (32KB) грузить lazy.

### 4. Compression на production

Настроить nginx с Brotli + Gzip.

### 5. Preload критичных chunk'ов

Добавить `<link rel="preload">` для react-vendor.

### 6. Минимизировать initial render

Убрать лишние useEffect в App.jsx, которые делают fetch при каждом рендере.

---

## Реализация (приоритет по эффекту):

### ✅ Фаза 1: Quick wins (10 мин, -20KB)

1. Tree-shake date-fns imports
2. Удалить axios, заменить на fetch

### ✅ Фаза 2: Bundle optimization (15 мин, -15KB initial)

1. Lazy load ProfilePage и ChatsPage
2. Добавить preload hints

### ✅ Фаза 3: Runtime optimization (10 мин)

1. Убрать лишние повторные fetch в App.jsx
2. Добавить React.memo для тяжелых компонентов

### ✅ Фаза 4: Production setup (5 мин)

1. Nginx Brotli/Gzip configuration

---

## Ожидаемый результат:

| Метрика | До | После |
|---------|-----|-------|
| Initial bundle (gzip) | 75KB | 45KB |
| Time to Interactive (3G) | 6-8s | 3-4s |
| First Contentful Paint | 2s | 1s |

---

## Начинаем с Фазы 1
