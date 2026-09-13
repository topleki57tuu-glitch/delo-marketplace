# Исправление всех проблем профиля

## ❌ Проблемы из скриншотов:

1. "Неверный или просроченный токен авторизации"
2. Фото профиля не сохраняется
3. Фото не меняется в шапке
4. Фото не удаляется из портфолио
5. Не переключается на заказчика/специалиста

---

## ✅ Исправления:

### 1. Переключение роли (Backend)

**Файл**: `backend/app/api/users.py` (строки 109-127)

**Проблема**: После переключения роли старый токен содержал старую роль

**Решение**: Генерируем новый токен с обновлённой ролью

```python
@router.post("/users/me/switch-role")
def switch_role(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from app.core.security import create_access_token

    payload = decode_token_or_401(token)
    user = db.query(User).filter(User.id == int(payload.get("sub"))).first()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    new_role = UserRole.specialist if user.role == UserRole.customer else UserRole.customer
    user.role = new_role
    db.commit()

    # Создаём новый токен с обновлённой ролью
    new_token = create_access_token({"sub": str(user.id), "role": new_role.value})

    return {
        "message": "Роль изменена",
        "role": new_role.value,
        "token": new_token  # ← Новый токен!
    }
```

---

### 2. Обновление токена (Frontend)

**Файл**: `frontend/src/pages/ProfilePage.jsx`

**Добавлен импорт**:
```javascript
import { useAuthStore } from '../store/authStore';
```

**Обновлена функция** (строки 346-361):
```javascript
const handleSwitchRole = async () => {
  try {
    const res = await fetch('/users/me/switch-role', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Не удалось переключить роль');

    // Обновляем токен в store ← ИСПРАВЛЕНИЕ
    if (data.token) {
      const { login } = useAuthStore.getState();
      login(data.token, data.role);
    }

    addToast(`Роль изменена на: ${data.role === 'specialist' ? 'Специалист' : 'Заказчик'}`, 'success');
    onUpdateUser();
  } catch (err) {
    addToast(err.message, 'error');
  }
};
```

---

### 3. Сохранение аватара (Backend)

**Файл**: `backend/app/api/users.py` (строки 75-107)

**Было**: `if profile.avatar is not None: user.avatar = profile.avatar`

**Стало**:
```python
# Явная проверка для avatar: None означает удаление
if hasattr(profile, 'avatar'):
    if profile.avatar is None:
        user.avatar = None  # Удаление
    elif profile.avatar != "":
        user.avatar = profile.avatar  # Обновление

db.commit()
db.refresh(user)  # ← Обновляем объект после commit
```

---

### 4. Обновление аватара (Frontend)

**Файл**: `frontend/src/components/Avatar.jsx`

**Улучшена обработка ошибок** (строки 38-95):

```javascript
const handleUpload = async () => {
  if (!preview) return;
  setUploading(true);
  try {
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
    onAvatarUpdate(); // Перезагружаем профиль
  } catch (err) {
    addToast(err.message, 'error');
  } finally {
    setUploading(false);
  }
};
```

---

### 5. Удаление из портфолио (Frontend)

**Файл**: `frontend/src/components/ImageUploader.jsx`

**Кнопка удаления для мобильных** (строки 118-127):

```javascript
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();  // Предотвращаем открытие фото
    onDelete(idx);
  }}
  title="Удалить из портфолио"
  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-lg transition-colors md:opacity-0 md:group-hover:opacity-100"
>
  ✕
</button>
```

**Ключевой момент**: `md:opacity-0 md:group-hover:opacity-100`
- На мобильных (< 768px): кнопка всегда видна
- На десктопе (≥ 768px): появляется при hover

---

## 🔄 Как работает обновление профиля:

### Поток данных:

```
1. Пользователь загружает аватар
   ↓
2. AvatarUploader → PUT /users/me { avatar: "base64..." }
   ↓
3. Backend обновляет user.avatar и делает db.refresh(user)
   ↓
4. Frontend получает 200 OK
   ↓
5. Вызывается onAvatarUpdate() → fetchUserProfile()
   ↓
6. GET /users/me → возвращает обновлённые данные
   ↓
7. updateUser(data) в authStore
   ↓
8. UI автоматически обновляется (аватар в шапке, профиле)
```

---

## 🧪 Тестирование:

### Тест 1: Переключение роли
1. Войти в профиль
2. Нажать "Переключить на Специалиста" (или наоборот)
3. ✅ Toast: "Роль изменена"
4. ✅ Роль обновлена в профиле
5. ✅ Токен обновлён (больше нет ошибки "просроченный токен")

### Тест 2: Загрузка аватара
1. Редактировать профиль
2. Загрузить фото → "Сохранить"
3. ✅ Toast: "Аватар обновлен!"
4. ✅ Аватар отображается в шапке (справа вверху)
5. ✅ Аватар отображается в профиле

### Тест 3: Удаление аватара
1. Редактировать профиль
2. Нажать красную кнопку "Удалить"
3. ✅ Toast: "Аватар удален"
4. ✅ Вместо аватара показываются инициалы

### Тест 4: Удаление из портфолио (мобильная версия)
1. Открыть профиль на телефоне
2. Красная кнопка ✕ всегда видна на каждом фото
3. Нажать ✕
4. ✅ Toast: "Работа удалена из портфолио"
5. ✅ Фото исчезает

---

## 🚨 Важно после обновления:

### 1. Выйти и войти заново

После обновления кода пользователям нужно:
1. Нажать "Выйти"
2. Войти заново
3. Это обновит токен с правильной структурой

### 2. Очистить LocalStorage (если проблемы остались)

Если ошибка "просроченный токен" всё ещё появляется:
1. F12 → Application → Local Storage
2. Найти ключ "auth-storage" или "auth"
3. Удалить
4. Обновить страницу
5. Войти заново

---

## 📝 Дополнительные улучшения:

### Backend:
- ✅ `db.refresh(user)` после всех обновлений профиля
- ✅ Новый токен при переключении роли
- ✅ Явная обработка `None` для удаления полей

### Frontend:
- ✅ Детальная обработка ошибок с `errorData.detail`
- ✅ Обновление токена в store после переключения роли
- ✅ Кнопка удаления всегда видна на мобильных
- ✅ `e.stopPropagation()` предотвращает случайное открытие фото

---

## ✅ Итог

Все проблемы исправлены:

1. ✅ Переключение роли теперь выдаёт новый токен
2. ✅ Аватар сохраняется и обновляется в шапке
3. ✅ Аватар можно удалить
4. ✅ Фото из портфолио удаляются на всех устройствах
5. ✅ Больше нет ошибки "просроченный токен"

**Backend перезапущен с новыми изменениями!** 🚀

Протестируйте:
1. Выйдите и войдите заново
2. Попробуйте переключить роль
3. Загрузите/удалите аватар
4. Удалите фото из портфолио
