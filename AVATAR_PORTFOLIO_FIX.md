# Исправление сохранения аватара и удаления фото

## Проблема
- Аватар не сохраняется в профиле
- Нужна возможность удаления фото профиля
- Нужна возможность удаления фото из портфолио

---

## ✅ Исправления (Завершено)

### 1. Backend - обновлён endpoint `/users/me` PUT

**Файл**: `backend/app/api/users.py` (строки 75-99)

Добавлена явная обработка `None` для удаления:

```python
# Явная проверка для avatar: None означает удаление, пустая строка игнорируется
if hasattr(profile, 'avatar'):
    if profile.avatar is None:
        user.avatar = None
    elif profile.avatar != "":
        user.avatar = profile.avatar

# Явная проверка для portfolio: None означает удаление
if hasattr(profile, 'portfolio'):
    if profile.portfolio is None:
        user.portfolio = None
    elif profile.portfolio != "":
        user.portfolio = profile.portfolio

db.commit()
db.refresh(user)  # Добавлено для обновления объекта
```

**Что изменилось**:
- `avatar: null` → удаляет аватар
- `avatar: "base64..."` → устанавливает новый аватар
- `avatar: ""` → игнорируется (не меняется)
- Добавлен `db.refresh(user)` для обновления объекта после commit

---

### 2. Frontend - улучшена обработка ошибок в Avatar.jsx

**Файл**: `frontend/src/components/Avatar.jsx`

#### handleUpload (строки 38-63):
```javascript
const res = await fetch('/users/me', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ avatar: preview })
});

if (!res.ok) {
  const errorData = await res.json();
  throw new Error(errorData.detail || 'Не удалось обновить аватар');
}

addToast('Аватар обновлен!', 'success');
setPreview(null);
onAvatarUpdate(); // Перезагружает данные пользователя из App.jsx
```

#### handleRemove (строки 65-95):
```javascript
const res = await fetch('/users/me', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ avatar: null })
});

if (!res.ok) {
  const errorData = await res.json();
  throw new Error(errorData.detail || 'Не удалось удалить аватар');
}

addToast('Аватар удален', 'success');
setPreview(null);
onAvatarUpdate(); // Перезагружает данные пользователя
```

**Что изменилось**:
- Добавлена детальная обработка ошибок (`errorData.detail`)
- `setPreview(null)` очищает preview после удаления
- Порядок вызовов оптимизирован для лучшего UX

---

### 3. UI компоненты (уже были реализованы)

#### Кнопки в AvatarUploader:
1. **"Загрузить аватар" / "Изменить аватар"** - открывает file picker
2. **"Удалить"** (красная кнопка) - удаляет текущий аватар
3. **"Сохранить"** (при preview) - загружает выбранное фото
4. **"Отмена"** (при preview) - отменяет выбор

#### PortfolioUploader уже поддерживает удаление:
- Hover на фото → появляется кнопка ✕ в правом верхнем углу
- Клик → удаляет фото из портфолио
- Реализовано через `onDelete={handlePortfolioDelete}` в ProfilePage.jsx

---

## Архитектура

### Поток данных для аватара:

```
User действие → AvatarUploader
                     ↓
                handleUpload/handleRemove
                     ↓
            PUT /users/me { avatar: ... }
                     ↓
              Backend обновляет БД
                     ↓
              onAvatarUpdate() → fetchUserProfile()
                     ↓
              GET /users/me
                     ↓
         updateUser(data) в authStore
                     ↓
            UI автоматически обновляется
```

### Поток данных для портфолио:

```
User действие → PortfolioUploader
                     ↓
          handlePortfolioAdd/handlePortfolioDelete
                     ↓
           parsePortfolio() → savePortfolio()
                     ↓
       PUT /users/me { portfolio: JSON.stringify(...) }
                     ↓
              Backend обновляет БД
                     ↓
              onUpdateUser() → fetchUserProfile()
                     ↓
            UI автоматически обновляется
```

---

## Тестирование

### Тест 1: Загрузка аватара
1. Войти в профиль
2. Кликнуть "Загрузить аватар"
3. Выбрать изображение (макс 5MB)
4. Preview должен показаться
5. Кликнуть "Сохранить"
6. Toast: "Аватар обновлен!"
7. Аватар должен отобразиться в профиле

### Тест 2: Удаление аватара
1. Имея аватар в профиле
2. Кликнуть красную кнопку "Удалить"
3. Toast: "Аватар удален"
4. Должны показаться инициалы вместо аватара

### Тест 3: Отмена загрузки
1. Выбрать файл → появляется preview
2. Кликнуть "Отмена"
3. Preview исчезает
4. Текущий аватар не изменяется

### Тест 4: Удаление фото из портфолио
1. Добавить фото в портфолио
2. Навести курсор на фото
3. Кликнуть кнопку ✕
4. Toast: "Работа удалена из портфолио"
5. Фото должно исчезнуть

---

## Возможные проблемы и решения

### Проблема: "Аватар не отображается после загрузки"
**Причина**: Base64 изображение слишком большое или невалидное  
**Решение**: Валидация на фронтенде (макс 5MB, только изображения)

### Проблема: "Кнопка удалить не появляется"
**Причина**: currentAvatar пустой или undefined  
**Решение**: Проверить что `user.avatar` не null после загрузки

### Проблема: "После удаления аватар все еще виден"
**Причина**: `onAvatarUpdate()` не вызывается или не обновляет store  
**Решение**: Проверить что `fetchUserProfile()` в App.jsx вызывает `updateUser(data)`

### Проблема: "База данных не обновляется"
**Причина**: Нет `db.refresh(user)` после commit  
**Решение**: ✅ Уже исправлено в users.py

---

## Итог

✅ Backend обрабатывает `avatar: null` для удаления  
✅ Frontend имеет кнопку удаления аватара  
✅ PortfolioUploader поддерживает удаление фото (hover → ✕)  
✅ Обработка ошибок с детальными сообщениями  
✅ `onAvatarUpdate()` перезагружает профиль пользователя  
✅ Toast уведомления для всех действий

**Всё готово к использованию!** 🎉
