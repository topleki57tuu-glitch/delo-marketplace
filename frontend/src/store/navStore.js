import { create } from 'zustand';

export const useNavStore = create((set, get) => ({
    viewMode: 'list', // 'list' | 'map'
    setViewMode: (mode) => set({ viewMode: mode }),

    isChatsOpen: false,
    setChatsOpen: (open) => set({ isChatsOpen: open }),

    isAuthOpen: false,
    setAuthOpen: (open) => set({ isAuthOpen: open }),

    isCreateTaskOpen: false,
    setCreateTaskOpen: (open) => set({ isCreateTaskOpen: open }),

    activeChatTask: null,
    setActiveChatTask: (task) => set({ activeChatTask: task }),

    // Closes all modals, side drawers, workspaces and alerts
    closeAllOverlays: () => {
        set({
            isChatsOpen: false,
            isAuthOpen: false,
            isCreateTaskOpen: false,
            activeChatTask: null,
        });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('delo:close-all-modals'));
        }
    },

    // Clean atomic openers (ensures no modal/drawer layering)
    openChats: () => {
        get().closeAllOverlays();
        set({ isChatsOpen: true });
    },

    openCreateTask: () => {
        get().closeAllOverlays();
        set({ isCreateTaskOpen: true });
    },

    openAuth: () => {
        get().closeAllOverlays();
        set({ isAuthOpen: true });
    },

    openTaskChat: (task) => {
        get().closeAllOverlays();
        set({ activeChatTask: task });
    },

    openFeed: (mode = 'list') => {
        get().closeAllOverlays();
        set({ viewMode: mode });
    }
}));
