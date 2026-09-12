# 🎨 Frontend Improvements - Implementation Guide

## ✅ Реализовано (Фаза 1)

### 1. Zustand Stores (нормализация состояния)
- ✅ **tasksStore.js** - централизованное хранилище задач с кешированием
- ✅ **userStore.js** - кеш профилей пользователей
- ✅ **ErrorBoundary.jsx** - защита от белого экрана при ошибках
- ✅ **a11y.js** - хуки для accessibility (focus trap, escape, modal management)

**Преимущества**:
- Отсутствие дублирования данных (одна задача = один fetch)
- Быстрый доступ к данным из любого компонента
- Оптимистичные обновления с возможностью отката

---

## 📋 Осталось реализовать

### Фаза 1 (критично)

#### 4. Добавить Lazy Loading в App.jsx

**Файл**: `frontend/src/App.jsx`

**Изменения**:
```javascript
import React, { Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';

// Eager load только критичные
import HomePage from './pages/HomePage';

// Lazy load остальные
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const CreateTaskPage = lazy(() => import('./pages/CreateTaskPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SpecialistProfilePage = lazy(() => import('./pages/SpecialistProfilePage'));
const SpecialistsPage = lazy(() => import('./pages/SpecialistsPage'));
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'));
const DisputesPage = lazy(() => import('./pages/DisputesPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const ChatsPage = lazy(() => import('./pages/ChatsPage'));

// Fallback компонент
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-sm text-slate-600 dark:text-slate-400">Загрузка...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col">
          {/* Skip link для keyboard users */}
          <a 
            href="#main-content" 
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg"
          >
            Перейти к содержимому
          </a>

          <NavigationBar {...} />
          
          <main id="main-content" className="flex-1">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<HomePage {...} />} />
                <Route path="/tasks" element={<TasksPage {...} />} />
                {/* остальные routes */}
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
```

**Добавить CSS для sr-only**:
```css
/* В globals.css или index.css */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.focus\:not-sr-only:focus {
  position: static;
  width: auto;
  height: auto;
  padding: 0.5rem 1rem;
  margin: 0;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

---

### Фаза 2 (важно)

#### 5. Настройка тестирования

**Обновить `frontend/package.json`**:
```json
{
  "devDependencies": {
    "@testing-library/react": "^14.1.2",
    "@testing-library/jest-dom": "^6.1.5",
    "@testing-library/user-event": "^14.5.1",
    "@vitest/ui": "^1.0.4",
    "jsdom": "^23.0.1",
    "vitest": "^1.0.4"
  },
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  }
}
```

**Создать `frontend/vitest.config.js`**:
```javascript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
});
```

**Создать `frontend/src/test/setup.js`**:
```javascript
import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';

// Mock fetch
global.fetch = vi.fn();

beforeAll(() => {
  // Setup
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  // Cleanup
});
```

**Установить зависимости**:
```bash
cd frontend
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/ui jsdom vitest
```

---

#### 6. Оптимистичные обновления

**Обновить TaskDetailPage** для использования tasksStore:

```javascript
import { useTasksStore } from '../store/tasksStore';

export default function TaskDetailPage({ user, token, onOpenAuth }) {
  const { taskId } = useParams();
  const { addToast } = useToast();
  
  // Используем store вместо локального state
  const task = useTasksStore(state => state.getTask(taskId));
  const fetchTask = useTasksStore(state => state.fetchTask);
  const updateTaskOptimistic = useTasksStore(state => state.updateTaskOptimistic);
  const revertTask = useTasksStore(state => state.revertTask);
  
  const [completing, setCompleting] = useState(false);
  
  useEffect(() => {
    if (!task) {
      fetchTask(taskId);
    }
  }, [taskId, task]);
  
  const handleComplete = async () => {
    if (!token) {
      onOpenAuth('login');
      return;
    }
    
    // Сохраняем оригинал для отката
    const originalTask = { ...task };
    
    // 1. Оптимистичное обновление UI (мгновенно)
    updateTaskOptimistic(taskId, { status: 'completed' });
    setCompleting(true);
    
    try {
      // 2. Запрос к серверу
      const res = await fetch(`/tasks/${taskId}/complete`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('Не удалось завершить заказ');
      
      // 3. Обновить с реальными данными от сервера
      const updated = await res.json();
      updateTaskOptimistic(taskId, updated);
      
      addToast('Заказ завершён! Выплата отправлена исполнителю', 'success');
    } catch (error) {
      // 4. Откат при ошибке
      revertTask(taskId, originalTask);
      addToast(error.message, 'error');
    } finally {
      setCompleting(false);
    }
  };
  
  // ... остальной код
}
```

**Аналогично обновить**:
- `CreateTaskPage.jsx` - оптимистичное создание задачи
- `TasksPage.jsx` - использовать tasksStore
- `MyTasksPage.jsx` - использовать tasksStore

---

#### 7. Accessibility улучшения

**Обновить AuthModal в App.jsx**:

```javascript
import { useModal } from './utils/a11y';

function AuthModal({ isOpen, mode, onClose, onLoginSuccess }) {
  const { addToast } = useToast();
  
  // Используем accessibility хуки
  useModal(isOpen, onClose, {
    escapeEnabled: true,
    lockScroll: true,
    restoreFocus: true
  });
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div 
        role="dialog" 
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="bg-white dark:bg-slate-800 max-w-md w-full p-6 rounded-3xl"
      >
        <h2 id="auth-modal-title" className="text-2xl font-extrabold">
          {isLogin ? 'Вход в аккаунт' : 'Регистрация'}
        </h2>
        
        <form onSubmit={handleSubmit}>
          <label htmlFor="email-input" className="block text-xs font-semibold text-slate-500 mb-1">
            Email
          </label>
          <input
            id="email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-required="true"
            className="..."
            required
          />
          
          {/* остальные поля */}
        </form>
        
        <button
          onClick={onClose}
          aria-label="Закрыть модальное окно"
          className="..."
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

---

### Фаза 3 (тесты)

#### 8. Примеры тестов

**`frontend/src/store/__tests__/tasksStore.test.js`**:
```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTasksStore } from '../tasksStore';

describe('tasksStore', () => {
  beforeEach(() => {
    // Сброс store перед каждым тестом
    useTasksStore.setState({
      tasks: {},
      allTaskIds: [],
      loading: false,
      error: null
    });
    
    // Сброс моков
    vi.clearAllMocks();
  });

  it('should fetch tasks and normalize', async () => {
    const mockTasks = [
      { id: 1, title: 'Task 1', budget: 10000 },
      { id: 2, title: 'Task 2', budget: 20000 }
    ];
    
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTasks)
      })
    );
    
    await useTasksStore.getState().fetchTasks();
    
    const state = useTasksStore.getState();
    expect(state.tasks[1]).toEqual(mockTasks[0]);
    expect(state.tasks[2]).toEqual(mockTasks[1]);
    expect(state.allTaskIds).toEqual([1, 2]);
    expect(state.loading).toBe(false);
  });

  it('should handle optimistic update', () => {
    useTasksStore.setState({
      tasks: { 1: { id: 1, status: 'in_progress' } }
    });
    
    useTasksStore.getState().updateTaskOptimistic(1, { status: 'completed' });
    
    const task = useTasksStore.getState().tasks[1];
    expect(task.status).toBe('completed');
  });

  it('should revert task on error', () => {
    const original = { id: 1, status: 'in_progress' };
    useTasksStore.setState({
      tasks: { 1: { id: 1, status: 'completed' } }
    });
    
    useTasksStore.getState().revertTask(1, original);
    
    const task = useTasksStore.getState().tasks[1];
    expect(task.status).toBe('in_progress');
  });
});
```

**Запуск тестов**:
```bash
npm test
```

---

## 🎯 Приоритеты

1. **Сейчас** - добавить lazy loading и ErrorBoundary в App.jsx
2. **Следующее** - установить тесты и написать базовые
3. **Затем** - рефакторить страницы на использование stores
4. **Последнее** - полное accessibility покрытие

---

## 📚 Документация

Все созданные файлы документированы с JSDoc комментариями:
- `tasksStore.js` - методы и селекторы
- `userStore.js` - кеширование пользователей
- `ErrorBoundary.jsx` - использование
- `a11y.js` - все хуки с примерами

**Полный план**: `C:\Users\armen\.claude\plans\shiny-cuddling-pearl.md`
