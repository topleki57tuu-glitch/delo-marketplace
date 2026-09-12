import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTasksStore } from '../tasksStore';

describe('tasksStore', () => {
  beforeEach(() => {
    // Сброс store перед каждым тестом
    useTasksStore.setState({
      tasks: {},
      allTaskIds: [],
      myTaskIds: [],
      loading: false,
      error: null
    });

    // Сброс моков
    vi.clearAllMocks();
  });

  it('should initialize with empty state', () => {
    const state = useTasksStore.getState();

    expect(state.tasks).toEqual({});
    expect(state.allTaskIds).toEqual([]);
    expect(state.myTaskIds).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should fetch tasks and normalize them', async () => {
    const mockTasks = [
      { id: 1, title: 'Task 1', budget: 10000, status: 'open' },
      { id: 2, title: 'Task 2', budget: 20000, status: 'open' }
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
    expect(state.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500
      })
    );

    await useTasksStore.getState().fetchTasks();

    const state = useTasksStore.getState();
    expect(state.error).toBeTruthy();
    expect(state.loading).toBe(false);
  });

  it('should use cached task if available', async () => {
    const existingTask = { id: 1, title: 'Cached Task', budget: 5000 };
    useTasksStore.setState({
      tasks: { 1: existingTask }
    });

    global.fetch = vi.fn();

    const task = await useTasksStore.getState().fetchTask(1, false);

    expect(task).toEqual(existingTask);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch task if not in cache', async () => {
    const mockTask = { id: 3, title: 'New Task', budget: 15000 };

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTask)
      })
    );

    const task = await useTasksStore.getState().fetchTask(3);

    expect(task).toEqual(mockTask);
    expect(useTasksStore.getState().tasks[3]).toEqual(mockTask);
    expect(global.fetch).toHaveBeenCalledWith('/tasks/3');
  });

  it('should add task to store', () => {
    const newTask = { id: 5, title: 'Added Task', budget: 8000 };

    useTasksStore.getState().addTask(newTask);

    const state = useTasksStore.getState();
    expect(state.tasks[5]).toEqual(newTask);
    expect(state.allTaskIds).toContain(5);
  });

  it('should update task optimistically', () => {
    const originalTask = { id: 1, status: 'in_progress', budget: 10000 };
    useTasksStore.setState({
      tasks: { 1: originalTask }
    });

    useTasksStore.getState().updateTaskOptimistic(1, { status: 'completed' });

    const task = useTasksStore.getState().tasks[1];
    expect(task.status).toBe('completed');
    expect(task.budget).toBe(10000); // Другие поля остались
  });

  it('should revert task on error', () => {
    const originalTask = { id: 1, status: 'in_progress', budget: 10000 };

    useTasksStore.setState({
      tasks: { 1: { id: 1, status: 'completed', budget: 10000 } }
    });

    useTasksStore.getState().revertTask(1, originalTask);

    const task = useTasksStore.getState().tasks[1];
    expect(task).toEqual(originalTask);
  });

  it('should remove task from store', () => {
    useTasksStore.setState({
      tasks: { 1: { id: 1 }, 2: { id: 2 } },
      allTaskIds: [1, 2],
      myTaskIds: [1]
    });

    useTasksStore.getState().removeTask(1);

    const state = useTasksStore.getState();
    expect(state.tasks[1]).toBeUndefined();
    expect(state.tasks[2]).toBeDefined();
    expect(state.allTaskIds).toEqual([2]);
    expect(state.myTaskIds).toEqual([]);
  });

  it('should get all tasks as array', () => {
    useTasksStore.setState({
      tasks: {
        1: { id: 1, title: 'Task 1' },
        2: { id: 2, title: 'Task 2' }
      },
      allTaskIds: [1, 2]
    });

    const tasks = useTasksStore.getState().getAllTasks();

    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe(1);
    expect(tasks[1].id).toBe(2);
  });

  it('should clear error', () => {
    useTasksStore.setState({ error: 'Some error' });

    useTasksStore.getState().clearError();

    expect(useTasksStore.getState().error).toBeNull();
  });
});
