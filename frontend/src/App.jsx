import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useTasksStore } from './store/tasksStore';
import { useToast } from './components/Toast';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import NavigationBar from './components/NavigationBar.jsx';
import AuthModal from './components/AuthModal.jsx';
import { SESSION_EXPIRED_EVENT } from './utils/session';
import ConsentGate from './components/ConsentGate.jsx';
import EmailVerificationBanner from './components/EmailVerificationBanner.jsx';
import RouteMeta from './components/RouteMeta.jsx';
import { useVisiblePolling } from './utils/useVisiblePolling';
import { PROFILE_STALE_EVENT } from './utils/profileSync';

// Eager load только критичные страницы
import HomePage from './pages/HomePage';
import SiteFooter from './components/SiteFooter.jsx';
import ScrollManager from './components/ScrollManager.jsx';

// Lazy load остальные страницы (загружаются по требованию)
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const CreateTaskPage = lazy(() => import('./pages/CreateTaskPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SpecialistProfilePage = lazy(() => import('./pages/SpecialistProfilePage'));
const SpecialistsPage = lazy(() => import('./pages/SpecialistsPage'));
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'));
const DisputesPage = lazy(() => import('./pages/DisputesPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const ChatsPage = lazy(() => import('./pages/ChatsPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const CreateProductPage = lazy(() => import('./pages/CreateProductPage'));
const MyOrdersPage = lazy(() => import('./pages/MyOrdersPage'));
const MyProductsPage = lazy(() => import('./pages/MyProductsPage'));
const EditProductPage = lazy(() => import('./pages/EditProductPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

const PROFILE_POLL_MS = 30000;

export default function App() {
  const { token, user, login, logout, updateUser } = useAuthStore();
  const { addToast } = useToast();

  // Используем tasksStore вместо локального state
  const fetchTasks = useTasksStore(state => state.fetchTasks);
  // getAllTasks() каждый раз собирает новый массив. Zustand 5 сравнивает
  // результат селектора по ссылке, и без useShallow это бесконечный цикл
  // перерисовок (Maximum update depth exceeded).
  const tasks = useTasksStore(useShallow(state => state.getAllTasks()));
  const loading = useTasksStore(state => state.loading);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login');

  // Профиль опрашивается регулярно, поэтому без логов в консоль:
  // раньше здесь печатался весь профиль — email, телефон, баланс — по три
  // строки на каждый опрос. 401 сюда не доходит: просроченный токен
  // продлевает обёртка над fetch (utils/session.js).
  const fetchUserProfile = async () => {
    const current = useAuthStore.getState().token;
    if (!current) return;
    try {
      const res = await fetch('/users/me', {
        headers: { Authorization: `Bearer ${current}` },
      });
      if (res.ok) {
        const data = await res.json();
        // Пока шёл запрос, пользователь мог выйти — не возвращаем профиль.
        if (useAuthStore.getState().token) updateUser(data);
      }
    } catch {
      // Сеть пропала — следующий опрос попробует снова.
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    if (token) {
      fetchUserProfile();
    }
  }, [token]);

  // Профиль (баланс, роль, PRO, подтверждение почты) освежаем раз в 30
  // секунд и только пока вкладка на экране. Раньше опрос шёл каждые 5 секунд
  // даже из забытых фоновых вкладок — 12 запросов в минуту на человека.
  // Вернулись на вкладку — профиль перечитывается сразу: оплатили в соседней
  // вкладке — баланс уже свежий.
  useVisiblePolling(fetchUserProfile, PROFILE_POLL_MS, { enabled: Boolean(token) });

  // Оплатили задание, купили товар, вывели деньги — баланс в шапке
  // обновляется сразу, не дожидаясь опроса (см. utils/profileSync.js).
  useEffect(() => {
    const onStale = () => fetchUserProfile();
    window.addEventListener(PROFILE_STALE_EVENT, onStale);
    return () => window.removeEventListener(PROFILE_STALE_EVENT, onStale);
  }, []);

  const handleOpenAuth = (mode = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleLoginSuccess = (newToken, newRole, refreshToken) => {
    login(newToken, newRole, refreshToken);
    fetchUserProfile();
  };

  // Сессия закончилась (refresh-токен истёк или отозван) — store уже очищен
  // в utils/session.js, здесь только объясняем и предлагаем войти.
  useEffect(() => {
    const onExpired = () => {
      addToast('Сессия закончилась — войдите снова', 'info');
      setAuthModalMode('login');
      setAuthModalOpen(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Loading fallback для lazy loaded страниц
  const PageLoader = () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-sm text-slate-600 dark:text-slate-400">Загрузка...</p>
      </div>
    </div>
  );

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ScrollManager />
        <RouteMeta />
        <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 font-sans antialiased text-slate-800 dark:text-slate-100">
          {/* Skip link для keyboard navigation */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:shadow-lg"
          >
            Перейти к содержимому
          </a>

          <NavigationBar
            user={user}
            token={token}
            onOpenAuth={handleOpenAuth}
            onLogout={logout}
          />

          <EmailVerificationBanner />

          <main id="main-content" className="flex-1">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <HomePage
                      user={user}
                      onOpenAuth={handleOpenAuth}
                      onOpenCreateTask={() => {}}
                    />
                  }
                />
                <Route
                  path="/tasks"
                  element={
                    <TasksPage
                      tasks={tasks}
                      loading={loading}
                      user={user}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/tasks/:taskId"
                  element={
                    <TaskDetailPage
                      user={user}
                      token={token}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/create-task"
                  element={
                    <CreateTaskPage
                      user={user}
                      token={token}
                      onOpenAuth={handleOpenAuth}
                      onTaskCreated={fetchTasks}
                    />
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProfilePage
                      user={user}
                      token={token}
                      onUpdateUser={fetchUserProfile}
                      onLogout={logout}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/specialist/:specialistId"
                  element={
                    <SpecialistProfilePage
                      user={user}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/specialists"
                  element={
                    <SpecialistsPage
                      user={user}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/products"
                  element={<ProductsPage />}
                />
                <Route
                  path="/products/:id"
                  element={<ProductDetailPage onOpenAuth={handleOpenAuth} />}
                />
                <Route
                  path="/create-product"
                  element={<CreateProductPage onOpenAuth={handleOpenAuth} />}
                />
                <Route
                  path="/my-orders"
                  element={<MyOrdersPage onOpenAuth={handleOpenAuth} />}
                />
                <Route
                  path="/my-products"
                  element={<MyProductsPage onOpenAuth={handleOpenAuth} />}
                />
                <Route
                  path="/products/:id/edit"
                  element={<EditProductPage onOpenAuth={handleOpenAuth} />}
                />
                <Route
                  path="/disputes"
                  element={
                    <DisputesPage
                      user={user}
                      token={token}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/my-tasks"
                  element={<MyTasksPage onOpenAuth={handleOpenAuth} />}
                />
                <Route path="/reset" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/legal/:doc" element={<LegalPage />} />
                <Route
                  path="/chats"
                  element={
                    <ChatsPage
                      user={user}
                      token={token}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route
                  path="/admin/dashboard"
                  element={
                    <AdminDashboardPage
                      user={user}
                      token={token}
                      onOpenAuth={handleOpenAuth}
                    />
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </main>

        <SiteFooter />

        {/* Bottom Nav for Mobile */}
        <BottomNav onOpenAuth={handleOpenAuth} />

        {/* Auth Modal */}
        <AuthModal
          isOpen={authModalOpen}
          mode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />

        {/* Документы для тех, кто ещё не принял действующую редакцию */}
        <ConsentGate />
      </div>
    </BrowserRouter>
  </ErrorBoundary>
  );
}
