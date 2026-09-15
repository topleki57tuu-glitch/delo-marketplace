import { create } from 'zustand';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const useProductsStore = create((set, get) => ({
  products: [],
  currentProduct: null,
  myProducts: [],
  orders: { purchases: [], sales: [] },
  loading: false,
  error: null,
  filters: {
    category: null,
    condition: null,
    city: null,
    price_min: null,
    price_max: null,
    search: '',
  },

  setFilters: (filters) => set({ filters: { ...get().filters, ...filters } }),

  fetchProducts: async (customFilters = {}) => {
    set({ loading: true, error: null });
    try {
      const filters = { ...get().filters, ...customFilters };
      const params = new URLSearchParams();

      Object.entries(filters).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          params.append(key, value);
        }
      });

      const response = await fetch(`${API_URL}/products/?${params}`);
      if (!response.ok) throw new Error('Failed to fetch products');

      const data = await response.json();
      set({ products: data, loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  fetchProduct: async (id) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/${id}`);
      if (!response.ok) throw new Error('Product not found');

      const data = await response.json();
      set({ currentProduct: data, loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  createProduct: async (productData, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(productData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to create product');
      }

      const data = await response.json();
      set({ loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  updateProduct: async (id, productData, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(productData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to update product');
      }

      const data = await response.json();
      set({ loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  deleteProduct: async (id, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete product');
      }

      set({ loading: false });
      // Обновить список товаров
      get().fetchProducts();
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  createOrder: async (orderData, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(orderData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to create order');
      }

      const data = await response.json();
      set({ loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  fetchOrders: async (token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch orders');

      const data = await response.json();
      set({ orders: data, loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  confirmOrder: async (orderId, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders/${orderId}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to confirm order');
      }

      set({ loading: false });
      // Обновить заказы
      get().fetchOrders(token);
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  shipOrder: async (orderId, trackingNumber, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders/${orderId}/ship`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tracking_number: trackingNumber }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to ship order');
      }

      set({ loading: false });
      get().fetchOrders(token);
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  completeOrder: async (orderId, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders/${orderId}/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to complete order');
      }

      set({ loading: false });
      get().fetchOrders(token);
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  cancelOrder: async (orderId, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to cancel order');
      }

      set({ loading: false });
      get().fetchOrders(token);
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
