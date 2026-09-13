import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTasksStore } from '../tasksStore';

describe('tasksStore', () => {
  beforeEach(() => {
    // Сброс состояния
    useTasksStore.setState({
      tasks: {},
      allTaskIds: [],
      myTaskIds: [],
      loading: false,
      error: null
    });
    vi.clearAllMocks();
  });

  describe('fetchTasks', () => {
    it('should fetch and normalize tasks', async () => {
      const mockTasks = [
        { id: 1, title: 'Task 1', budget: 5000 },
        { id: 2, title: 'Task 2', budget: 10000 }
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTasks
      });

      const { fetchTasks } = useTasksStore.getState();
      await fetchTasks();

      const state = useTasksStore.getState();
      expect(state.tasks[1]).toEqual(mockTasks[0]);
      expect(state.tasks[2]).toEqual(mockTasks[1]);
      expect(state.allTaskIds).toEqual([1, 2]);
      expect(state.loading).toBe(false);
    });

    it('should handle fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false
      });

      const { fetchTasks } = useTasksStore.getState();

      await expect(fetchTasks()).rejects.toThrow('Failed to fetch tasks');

      const state = useTasksStore.getState();
      expect(state.error).toBe('Failed to fetch tasks');
      expect(state.loading).toBe(false);
    });
  });

  describe('updateTaskOptimistic', () => {
    it('should update task optimistically', () => {
      useTasksStore.setState({
        tasks: {
          1: { id: 1, title: 'Task 1', status: 'pending' }
        }
      });

      const { updateTaskOptimistic } = useTasksStore.getState();
      const original = updateTaskOptimistic(1, { status: 'completed' });

      const state = useTasksStore.getState();
      expect(state.tasks[1].status).toBe('completed');
      expect(original.status).toBe('pending');
    });
  });

  describe('revertTask', () => {
    it('should revert task to original state', () => {
      useTasksStore.setState({
        tasks: {
          1: { id: 1, title: 'Task 1', status: 'completed' }
        }
      });

      const { revertTask } = useTasksStore.getState();
      const original = { id: 1, title: 'Task 1', status: 'pending' };

      revertTask(1, original);

      const state = useTasksStore.getState();
      expect(state.tasks[1].status).toBe('pending');
    });
  });

  describe('addTask', () => {
    it('should add new task to store', () => {
      const newTask = { id: 10, title: 'New Task', budget: 15000 };

      const { addTask } = useTasksStore.getState();
      addTask(newTask);

      const state = useTasksStore.getState();
      expect(state.tasks[10]).toEqual(newTask);
      expect(state.allTaskIds).toContain(10);
    });

    it('should prepend task to list', () => {
      useTasksStore.setState({
        tasks: { 1: { id: 1, title: 'Existing' } },
        allTaskIds: [1]
      });

      const { addTask } = useTasksStore.getState();
      addTask({ id: 2, title: 'New' });

      const state = useTasksStore.getState();
      expect(state.allTaskIds).toEqual([2, 1]);
    });
  });

  describe('removeTask', () => {
    it('should remove task from store', () => {
      useTasksStore.setState({
        tasks: {
          1: { id: 1, title: 'Task 1' },
          2: { id: 2, title: 'Task 2' }
        },
        allTaskIds: [1, 2]
      });

      const { removeTask } = useTasksStore.getState();
      removeTask(1);

      const state = useTasksStore.getState();
      expect(state.tasks[1]).toBeUndefined();
      expect(state.allTaskIds).toEqual([2]);
    });
  });

  describe('selectors', () => {
    beforeEach(() => {
      useTasksStore.setState({
        tasks: {
          1: { id: 1, title: 'Task 1' },
          2: { id: 2, title: 'Task 2' },
          3: { id: 3, title: 'Task 3' }
        },
        allTaskIds: [1, 2, 3],
        myTaskIds: [1, 3]
      });
    });

    it('getTask should return task by id', () => {
      const { getTask } = useTasksStore.getState();
      const task = getTask(1);

      expect(task).toEqual({ id: 1, title: 'Task 1' });
    });

    it('getAllTasks should return all tasks', () => {
      const { getAllTasks } = useTasksStore.getState();
      const tasks = getAllTasks();

      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe(1);
    });

    it('getMyTasks should return only my tasks', () => {
      const { getMyTasks } = useTasksStore.getState();
      const tasks = getMyTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.id)).toEqual([1, 3]);
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      useTasksStore.setState({
        tasks: { 1: { id: 1 } },
        allTaskIds: [1],
        myTaskIds: [1],
        loading: true,
        error: 'error'
      });

      const { clear } = useTasksStore.getState();
      clear();

      const state = useTasksStore.getState();
      expect(state.tasks).toEqual({});
      expect(state.allTaskIds).toEqual([]);
      expect(state.myTaskIds).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
