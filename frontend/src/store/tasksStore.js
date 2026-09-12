import { create } from 'zustand';

/**
 * Централизованное хранилище задач (tasks).
 *
 * Нормализованная структура:
 * - tasks: { [id]: task } - хранилище задач по ID
 * - allTaskIds: number[] - список ID всех загруженных задач
 * - myTaskIds: number[] - список ID задач пользователя
 *
 * Преимущества:
 * - Отсутствие дублирования (одна задача в одном месте)
 * - Быстрый доступ по ID
 * - Оптимистичные обновления с откатом
 */
export const useTasksStore = create((set, get) => ({
  // Нормализованное хранилище: id -> task
  tasks: {},

  // Списки ID для разных представлений
  allTaskIds: [],
  myTaskIds: [],

  // UI состояния
  loading: false,
  error: null,

  /**
   * Получить все задачи (публичный список).
   */
  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/tasks/');
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();

      // Нормализация: массив -> объект { id: task }
      const normalized = {};
      const ids = [];
      data.forEach(task => {
        normalized[task.id] = task;
        ids.push(task.id);
      });

      set(state => ({
        tasks: { ...state.tasks, ...normalized },
        allTaskIds: ids,
        loading: false
      }));
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },

  /**
   * Получить задачи пользователя (мои заказы).
   */
  fetchMyTasks: async (token) => {
    if (!token) return;

    set({ loading: true, error: null });
    try {
      const res = await fetch('/tasks/my', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch my tasks');
      const data = await res.json();

      const normalized = {};
      const ids = [];
      data.forEach(task => {
        normalized[task.id] = task;
        ids.push(task.id);
      });

      set(state => ({
        tasks: { ...state.tasks, ...normalized },
        myTaskIds: ids,
        loading: false
      }));
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },

  /**
   * Получить одну задачу по ID.
   * Если задача уже в store, пропускаем fetch (используем кеш).
   */
  fetchTask: async (taskId, force = false) => {
    const existing = get().tasks[taskId];
    if (existing && !force) {
      return existing; // Используем закешированную
    }

    set({ loading: true, error: null });
    try {
      const res = await fetch(`/tasks/${taskId}`);
      if (!res.ok) throw new Error('Task not found');
      const task = await res.json();

      set(state => ({
        tasks: { ...state.tasks, [taskId]: task },
        loading: false
      }));

      return task;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  /**
   * Добавить новую задачу в store (после создания).
   */
  addTask: (task) => {
    set(state => ({
      tasks: { ...state.tasks, [task.id]: task },
      allTaskIds: [task.id, ...state.allTaskIds]
    }));
  },

  /**
   * Оптимистичное обновление задачи.
   * Изменяет UI мгновенно, до ответа сервера.
   */
  updateTaskOptimistic: (taskId, updates) => {
    set(state => {
      const task = state.tasks[taskId];
      if (!task) return state;

      return {
        tasks: {
          ...state.tasks,
          [taskId]: { ...task, ...updates }
        }
      };
    });
  },

  /**
   * Откат изменений при ошибке.
   * Восстанавливает оригинальную задачу.
   */
  revertTask: (taskId, originalTask) => {
    set(state => ({
      tasks: { ...state.tasks, [taskId]: originalTask }
    }));
  },

  /**
   * Удалить задачу из store (после удаления на сервере).
   */
  removeTask: (taskId) => {
    set(state => {
      const { [taskId]: removed, ...rest } = state.tasks;
      return {
        tasks: rest,
        allTaskIds: state.allTaskIds.filter(id => id !== taskId),
        myTaskIds: state.myTaskIds.filter(id => id !== taskId)
      };
    });
  },

  /**
   * Сбросить ошибку.
   */
  clearError: () => set({ error: null }),

  // Селекторы (для удобного доступа)

  /**
   * Получить задачу по ID из store.
   */
  getTask: (taskId) => get().tasks[taskId],

  /**
   * Получить все задачи как массив.
   */
  getAllTasks: () => get().allTaskIds.map(id => get().tasks[id]).filter(Boolean),

  /**
   * Получить мои задачи как массив.
   */
  getMyTasks: () => get().myTaskIds.map(id => get().tasks[id]).filter(Boolean),
}));
