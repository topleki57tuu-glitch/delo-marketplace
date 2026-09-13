import { create } from 'zustand';

export const useTasksStore = create((set, get) => ({
  // Нормализованное хранилище: id -> task
  tasks: {},
  // Списки ID для разных представлений
  allTaskIds: [],
  myTaskIds: [],

  loading: false,
  error: null,

  // Получить все задачи
  fetchTasks: async (token = null) => {
    set({ loading: true, error: null });
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/tasks/', { headers });
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();

      const normalized = {};
      const ids = [];
      data.forEach(task => {
        normalized[task.id] = task;
        ids.push(task.id);
      });

      set({
        tasks: { ...get().tasks, ...normalized },
        allTaskIds: ids,
        loading: false
      });
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  // Получить одну задачу
  fetchTask: async (taskId, token = null) => {
    set({ loading: true, error: null });
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/tasks/${taskId}`, { headers });
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

  // Получить мои задачи
  fetchMyTasks: async (token, role) => {
    set({ loading: true, error: null });
    try {
      const endpoint = role === 'specialist'
        ? '/api/tasks/my-tasks'
        : '/api/tasks/my-tasks';

      const res = await fetch(endpoint, {
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
      throw error;
    }
  },

  // Оптимистичное обновление
  updateTaskOptimistic: (taskId, updates) => {
    const state = get();
    const originalTask = state.tasks[taskId];

    set({
      tasks: {
        ...state.tasks,
        [taskId]: { ...originalTask, ...updates }
      }
    });

    return originalTask; // Возвращаем оригинал для возможного отката
  },

  // Откат при ошибке
  revertTask: (taskId, originalTask) => {
    set(state => ({
      tasks: { ...state.tasks, [taskId]: originalTask }
    }));
  },

  // Добавить новую задачу (оптимистично)
  addTask: (task) => {
    set(state => ({
      tasks: { ...state.tasks, [task.id]: task },
      allTaskIds: [task.id, ...state.allTaskIds]
    }));
  },

  // Удалить задачу
  removeTask: (taskId) => {
    set(state => {
      const { [taskId]: removed, ...remainingTasks } = state.tasks;
      return {
        tasks: remainingTasks,
        allTaskIds: state.allTaskIds.filter(id => id !== taskId),
        myTaskIds: state.myTaskIds.filter(id => id !== taskId)
      };
    });
  },

  // Селекторы
  getTask: (taskId) => get().tasks[taskId],
  getAllTasks: () => get().allTaskIds.map(id => get().tasks[id]).filter(Boolean),
  getMyTasks: () => get().myTaskIds.map(id => get().tasks[id]).filter(Boolean),

  // Очистить store (при logout)
  clear: () => {
    set({
      tasks: {},
      allTaskIds: [],
      myTaskIds: [],
      loading: false,
      error: null
    });
  }
}));
