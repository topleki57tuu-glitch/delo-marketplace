import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { IconMap, IconMessages, IconTasks, IconUser } from '../components/icons.jsx';

/**
 * Нижняя мобильная навигация.
 *
 * Раньше компонент писал состояние в navStore (openFeed/openChats/openCreateTask),
 * которое не читал ни один компонент приложения, — все кнопки были «мёртвыми».
 * Теперь навигация идёт через react-router по реальным маршрутам,
 * а требующие авторизации действия вызывают onOpenAuth (проп из App).
 */
export const BottomNav = ({
    onOpenAuth,
    unreadMessagesCount = 0,
    unreadNotificationsCount = 0,
}) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuth } = useAuthStore();

    const isTasksPage = location.pathname.startsWith('/tasks');
    const isProfilePage = location.pathname === '/profile';
    const isChatsPage = location.pathname === '/chats';
    const isMapView = new URLSearchParams(location.search).get('view') === 'map';

    // Trigger Telegram Haptic Feedback if running inside Telegram WebApp
    const triggerHaptic = (type = 'light') => {
        try {
            if (window.Telegram?.WebApp?.HapticFeedback) {
                if (type === 'selection') {
                    window.Telegram.WebApp.HapticFeedback.selectionChanged();
                } else {
                    window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
                }
            }
        } catch {
            // ignore haptic error
        }
    };

    const openAuth = (mode) => {
        if (typeof onOpenAuth === 'function') {
            onOpenAuth(mode);
        }
    };

    // 1. «Заказы» — список заданий
    const handleFeedClick = () => {
        triggerHaptic('selection');
        navigate('/tasks');
    };

    // 2. «Карта» — тот же список, но с открытой картой
    const handleMapClick = () => {
        triggerHaptic('selection');
        navigate('/tasks?view=map');
    };

    // 3. «+» — создать задание (нужен вход)
    const handleCreateClick = () => {
        triggerHaptic('medium');
        if (!isAuth) {
            openAuth('register');
            return;
        }
        navigate('/create-task');
    };

    // 4. «Чаты» — страница переписки (нужен вход)
    const handleMessagesClick = () => {
        triggerHaptic('light');
        if (!isAuth) {
            openAuth('login');
            return;
        }
        navigate('/chats');
    };

    // 5. «Профиль» / «Войти»
    const handleProfileClick = () => {
        triggerHaptic('selection');
        if (!isAuth) {
            openAuth('login');
            return;
        }
        navigate('/profile');
    };

    const feedActive = isTasksPage && !isMapView;
    const mapActive = isTasksPage && isMapView;

    return (
        <nav
            aria-label="Мобильная навигация"
            className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-xl border-t border-border shadow-pop pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 pointer-events-auto"
        >
            <div className="flex items-center justify-around px-2 max-w-lg mx-auto">
                {/* 1. Feed / List */}
                <button
                    type="button"
                    onClick={handleFeedClick}
                    aria-current={feedActive ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all duration-200 active:scale-95 min-w-[56px] cursor-pointer ${
                        feedActive
                            ? 'text-accent-bright font-bold'
                            : 'text-muted hover:text-ink'
                    }`}
                >
                    <div className="relative">
                        <span className="text-xl"><IconTasks /></span>
                        {feedActive && (
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent glow-accent-sm"></span>
                        )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider mt-0.5">Заказы</span>
                </button>

                {/* 2. Map */}
                <button
                    type="button"
                    onClick={handleMapClick}
                    aria-current={mapActive ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all duration-200 active:scale-95 min-w-[56px] cursor-pointer ${
                        mapActive
                            ? 'text-accent-bright font-bold'
                            : 'text-muted hover:text-ink'
                    }`}
                >
                    <div className="relative">
                        <span className="text-xl"><IconMap /></span>
                        {mapActive && (
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent glow-accent-sm"></span>
                        )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider mt-0.5">Карта</span>
                </button>

                {/* 3. Center Action: Create task */}
                <div className="flex-1 flex justify-center items-center py-1 min-w-[56px]">
                    <button
                        type="button"
                        onClick={handleCreateClick}
                        title="Создать задание"
                        aria-label="Создать задание"
                        className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent to-[#38BDF8] text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-accent/40 active:scale-90 transition-transform -translate-y-2 border-2 border-surface cursor-pointer"
                    >
                        +
                    </button>
                </div>

                {/* 4. Messages / Chats */}
                <button
                    type="button"
                    onClick={handleMessagesClick}
                    aria-current={isChatsPage ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all duration-200 active:scale-95 min-w-[56px] cursor-pointer ${
                        isChatsPage ? 'text-accent-bright font-bold' : 'text-muted hover:text-ink'
                    }`}
                >
                    <div className="relative">
                        <span className="text-xl"><IconMessages /></span>
                        {unreadMessagesCount > 0 && (
                            <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 bg-danger text-white text-[10px] font-extrabold rounded-full flex items-center justify-center border-2 border-surface animate-pulse">
                                {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
                            </span>
                        )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider mt-0.5">Чаты</span>
                </button>

                {/* 5. Profile */}
                <button
                    type="button"
                    onClick={handleProfileClick}
                    aria-current={isProfilePage ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all duration-200 active:scale-95 min-w-[56px] cursor-pointer ${
                        isProfilePage
                            ? 'text-accent-bright font-bold'
                            : 'text-muted hover:text-ink'
                    }`}
                >
                    <div className="relative">
                        <span className="text-xl"><IconUser /></span>
                        {unreadNotificationsCount > 0 && !isProfilePage && (
                            <span className="absolute -top-1 -right-1.5 w-2 h-2 bg-accent rounded-full animate-ping"></span>
                        )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider mt-0.5">
                        {isAuth ? 'Профиль' : 'Войти'}
                    </span>
                </button>
            </div>
        </nav>
    );
};
