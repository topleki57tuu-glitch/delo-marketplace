import { create } from 'zustand';

export const useAdminStore = create((set) => ({
  stats: null,
  activity: null,
  users: [],
  loading: false,
  error: null,

  fetchStats: async (token) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/admin/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 403) {
        throw new Error('Access denied');
      }
      if (!res.ok) throw new Error('Failed to load stats');
      const data = await res.json();
      set({ stats: data, loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  fetchActivity: async (token) => {
    try {
      const res = await fetch('/admin/recent-activity', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load activity');
      const data = await res.json();
      set({ activity: data });
      return data;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  fetchUsers: async (token, filters = {}) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (filters.role) params.append('role', filters.role);
      if (filters.verified !== undefined) params.append('verified', filters.verified);
      if (filters.is_pro !== undefined) params.append('is_pro', filters.is_pro);
      if (filters.search) params.append('search', filters.search);
      if (filters.page) params.append('page', filters.page);
      if (filters.per_page) params.append('per_page', filters.per_page);

      const res = await fetch(`/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      set({ users: data, loading: false });
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  refreshAll: async (token) => {
    try {
      await Promise.all([
        set({ loading: true }),
        fetch('/admin/stats', { headers: { Authorization: `Bearer ${token}` }})
          .then(r => r.json())
          .then(data => set({ stats: data })),
        fetch('/admin/recent-activity', { headers: { Authorization: `Bearer ${token}` }})
          .then(r => r.json())
          .then(data => set({ activity: data }))
      ]);
      set({ loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  clear: () => set({ stats: null, activity: null, users: [], error: null }),
}));
