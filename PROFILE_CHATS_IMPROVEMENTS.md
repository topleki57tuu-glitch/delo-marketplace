# План усовершенствования Профиля и Чатов

## 🎯 Цель
Улучшить UX/UI и функциональность страниц Профиля и Чатов для более удобной работы пользователей.

## 📋 Текущие проблемы

### Профиль (ProfilePage.jsx):
1. ❌ **39 useState** - слишком много локального состояния
2. ❌ **Огромный компонент** - сложно поддерживать и тестировать
3. ❌ Нет аватара пользователя (только инициалы)
4. ❌ Нет drag & drop для portfolio images
5. ❌ Нет предпросмотра загруженных файлов
6. ❌ Статистика не визуализирована (просто цифры)
7. ❌ Нет поиска/фильтрации в транзакциях
8. ❌ Нет группировки транзакций по датам

### Чаты (ChatsPage.jsx):
1. ❌ Нет поиска по чатам/сообщениям
2. ❌ Нет фильтрации чатов (активные/завершенные)
3. ❌ Нет непрочитанных сообщений (badges)
4. ❌ Нет typing indicator ("печатает...")
5. ❌ Нет отправки файлов/изображений
6. ❌ Нет эмодзи picker
7. ❌ Нет reply to message функции
8. ❌ Нет времени отправки сообщения
9. ❌ Quick templates хардкоднуты
10. ❌ Нет звуковых уведомлений

## ✨ Предложенные улучшения

### 🔥 Профиль - Приоритет 1 (Критично)

#### 1. Аватар пользователя
```javascript
// Компонент AvatarUploader
- Upload/crop аватара
- Хранение в base64 или upload на сервер
- Fallback к инициалам если нет аватара
- Preview перед сохранением
```

#### 2. Рефакторинг компонента
```javascript
// Разбить ProfilePage на подкомпоненты:
- ProfileHeader.jsx (аватар, имя, баланс, верификация)
- ProfileStats.jsx (статистика в виде карточек)
- ProfileEdit.jsx (форма редактирования)
- ProfileTransactions.jsx (история операций)
- ProfilePortfolio.jsx (портфолио специалиста)
- ProfileWithdraw.jsx (вывод средств)
- AdminPanel.jsx (админская панель)
```

#### 3. Визуализация статистики
```javascript
// Использовать мини-графики:
- Линейный график баланса за последние 30 дней
- Круговая диаграмма типов транзакций
- Bar chart заработка по месяцам
- Библиотека: recharts (легковесная, React-friendly)
```

#### 4. Улучшенная таблица транзакций
```javascript
// Фичи:
- Поиск по описанию/сумме
- Фильтры по типу операции
- Сортировка по дате/сумме
- Группировка по датам (Сегодня, Вчера, Этот месяц)
- Пагинация (по 20 записей)
- Export в PDF (не только CSV)
```

#### 5. Portfolio drag & drop
```javascript
// react-dropzone для загрузки
- Drag & drop зона
- Multiple file upload
- Preview перед сохранением
- Reorder portfolio items (drag to reorder)
- Добавление описания к каждой работе
```

---

### 💬 Чаты - Приоритет 1 (Критично)

#### 1. Поиск по чатам и сообщениям
```javascript
// SearchBar в sidebar
<input 
  placeholder="Поиск по чатам..."
  onChange={(e) => setSearchQuery(e.target.value)}
/>

// Фильтрация:
const filteredTasks = tasks.filter(t => 
  t.title.toLowerCase().includes(searchQuery.toLowerCase())
);

// Поиск внутри сообщений (highlight результатов)
```

#### 2. Badges непрочитанных
```javascript
// Добавить в Task model:
- unread_count (количество непрочитанных)
- last_message (последнее сообщение для preview)
- last_message_time (для сортировки)

// UI:
{unreadCount > 0 && (
  <span className="badge">{unreadCount}</span>
)}
```

#### 3. Typing indicator
```javascript
// WebSocket события:
ws.send(JSON.stringify({ type: 'typing', task_id }));

// Backend broadcast:
// "Иван печатает..."

// UI:
{isTyping && (
  <div className="typing-indicator">
    <span></span><span></span><span></span>
  </div>
)}
```

#### 4. Timestamp для сообщений
```javascript
// Показывать время рядом с каждым сообщением:
<span className="text-xs opacity-60">
  {formatTime(m.created_at)} {/* 14:25 */}
</span>

// Группировать по датам:
{isNewDay && (
  <div className="date-separator">15 сентября 2026</div>
)}
```

#### 5. Отправка файлов
```javascript
// FileUploader в chat input
- Images (preview inline)
- Documents (PDF, DOCX) с иконкой
- Max size: 10MB
- Upload to backend /tasks/{id}/upload

// Backend endpoint:
@router.post("/tasks/{task_id}/upload")
async def upload_file(...)
```

#### 6. Emoji picker
```javascript
// Библиотека: emoji-picker-react
import EmojiPicker from 'emoji-picker-react';

<button onClick={() => setShowEmoji(!showEmoji)}>
  😊
</button>
{showEmoji && (
  <EmojiPicker onEmojiClick={onEmojiClick} />
)}
```

#### 7. Reply to message
```javascript
// State:
const [replyingTo, setReplyingTo] = useState(null);

// UI:
{replyingTo && (
  <div className="reply-preview">
    Ответ на: {replyingTo.text}
    <button onClick={() => setReplyingTo(null)}>✕</button>
  </div>
)}

// Отправка с reply_to_id
```

#### 8. Звуковые уведомления
```javascript
// Audio notification при новом сообщении
const notificationSound = new Audio('/notification.mp3');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.sender_id !== user.id) {
    notificationSound.play();
  }
  setMessages(prev => [...prev, msg]);
};
```

#### 9. Фильтры чатов
```javascript
// Tabs в sidebar:
- Все чаты
- Активные (in_progress)
- Завершенные (completed)
- Архив

const [filter, setFilter] = useState('all');
const filteredTasks = tasks.filter(t => {
  if (filter === 'active') return t.status === 'in_progress';
  if (filter === 'completed') return t.status === 'completed';
  return true;
});
```

#### 10. Quick replies улучшение
```javascript
// Сохранять пользовательские шаблоны
- Кнопка "Сохранить как шаблон"
- localStorage для хранения
- Управление шаблонами в настройках профиля

const [customTemplates, setCustomTemplates] = useState(
  JSON.parse(localStorage.getItem('chatTemplates') || '[]')
);
```

---

## 🎨 UI/UX улучшения

### Профиль:
1. **Skeleton loading** вместо "Загрузка..."
2. **Smooth transitions** при переключении табов
3. **Tooltips** для иконок и действий
4. **Confirmation dialogs** перед удалением
5. **Progress bars** для верификации/загрузки
6. **Empty states** с призывами к действию

### Чаты:
1. **Auto-scroll** к последнему сообщению
2. **Scroll to bottom button** если scrolled up
3. **Message delivery status** (отправлено/доставлено/прочитано)
4. **Context menu** (правый клик на сообщении: ответить/копировать/удалить)
5. **Link preview** для URLs в сообщениях
6. **Markdown support** для форматирования (bold, italic, code)

---

## 📦 Необходимые библиотеки

```json
{
  "dependencies": {
    "emoji-picker-react": "^4.5.0",
    "react-dropzone": "^14.2.3",
    "recharts": "^2.10.0",
    "date-fns": "^3.0.0",
    "react-image-crop": "^11.0.0"
  }
}
```

---

## 🚀 План реализации (по приоритетам)

### Фаза 1 - Критичные улучшения (2-3 дня):
1. ✅ Аватар пользователя
2. ✅ Рефакторинг ProfilePage на компоненты
3. ✅ Badges непрочитанных в чатах
4. ✅ Timestamp для сообщений
5. ✅ Поиск по чатам

### Фаза 2 - Важные улучшения (2-3 дня):
6. ✅ Typing indicator
7. ✅ Улучшенная таблица транзакций (фильтры, поиск)
8. ✅ Emoji picker
9. ✅ Отправка файлов в чатах
10. ✅ Визуализация статистики (графики)

### Фаза 3 - Nice-to-have (1-2 дня):
11. ✅ Reply to message
12. ✅ Portfolio drag & drop
13. ✅ Звуковые уведомления
14. ✅ Custom quick templates
15. ✅ Markdown support в сообщениях

---

## 💡 Начать с чего?

Рекомендую начать с **Фазы 1** в таком порядке:

1. **Badges непрочитанных** (быстро, большой impact)
2. **Timestamp для сообщений** (быстро, улучшает UX)
3. **Поиск по чатам** (средне, очень полезно)
4. **Аватар пользователя** (средне, визуально улучшает профиль)
5. **Рефакторинг ProfilePage** (долго, но критично для maintainability)

Хочешь начать с какого-то конкретного улучшения? Или реализуем всё по порядку?
