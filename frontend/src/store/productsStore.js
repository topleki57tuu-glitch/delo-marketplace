import { create } from 'zustand';
import { apiErrorMessage } from '../utils/apiError';

// Относительные пути, как в остальном приложении: запросы идут через прокси
// (vite в разработке, nginx в проде). Раньше здесь был абсолютный адрес с
// портом 8000, из-за которого в прод-сборке браузер стучался в localhost
// самого пользователя.
const API_URL = import.meta.env.VITE_API_URL || '';

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
      if (!response.ok) throw new Error('Не удалось загрузить товары');

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
      if (!response.ok) throw new Error('Товар не найден');

      const data = await response.json();
      set({ currentProduct: data, loading: false });
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  // Товары продавца целиком: включая распроданные и снятые с продажи.
  // Общий список отдаёт только активные позиции, поэтому страница
  // «Мои товары» раньше теряла половину ассортимента.
  fetchMyProducts: async (token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/my`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Не удалось загрузить ваши товары');

      const data = await response.json();
      set({ myProducts: data, loading: false });
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось создать товар'));
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось сохранить товар'));
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось удалить товар'));
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось оформить заказ'));
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

      if (!response.ok) throw new Error('Не удалось загрузить заказы');

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
        throw new Error(apiErrorMessage(errorData, 'Не удалось подтвердить заказ'));
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось отметить отправку'));
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось завершить заказ'));
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
        throw new Error(apiErrorMessage(errorData, 'Не удалось отменить заказ'));
      }

      set({ loading: false });
      get().fetchOrders(token);
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  // Спор по заказу товара: деньги заморожены до решения арбитра.
  // Без этого пути покупатель, получивший брак, не мог ничего сделать
  // после отправки товара — ни завершить, ни отменить, ни оспорить.
  openOrderDispute: async (orderId, reason, token) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/products/orders/${orderId}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(apiErrorMessage(errorData, 'Не удалось открыть спор'));
      }

      const data = await response.json();
      set({ loading: false });
      get().fetchOrders(token);
      return data;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
