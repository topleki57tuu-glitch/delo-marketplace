import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useTasksStore } from './store/tasksStore';
import { useToast } from './components/Toast';
import { NotificationBell } from './components/NotificationBell';
import { BottomNav } from './components/BottomNav';
import { ChatsDrawer } from './components/ChatsDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useModal } from './utils/a11y';
import { Avatar } from './components/Avatar';

// Eager load только критичные страницы
import HomePage from './pages/HomePage';

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
const ChatsPage = lazy(() => import('./pages/ChatsPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));

const API_URL = import.meta.env.VITE_API_URL || '';

function NavigationBar({ user, token, onOpenAuth, onOpenChatsDrawer, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-amber-500 flex items-center justify-center text-white font-black text-lg shadow-md shadow-indigo-500/20">
            Д
          </div>
          <span className="font-extrabold text-xl tracking-tight text-slate-900 dark:text-white">
            ДЕЛО<span className="text-amber-500 font-bold">.</span>
          </span>
        </Link>

        {/* Desktop Links */}
        <nav className="hidden md:flex items-center gap-1 text-sm font-semibold">
          <Link
            to="/tasks"
            className={`px-3.5 py-2 rounded-xl transition-colors ${
              location.pathname === '/tasks'
                ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Все задания
          </Link>
          <Link
            to="/specialists"
            className={`px-3.5 py-2 rounded-xl transition-colors ${
              location.pathname === '/specialists'
                ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Специалисты
          </Link>
          <Link
            to="/create-task"
            className={`px-3.5 py-2 rounded-xl transition-colors ${
              location.pathname === '/create-task'
                ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Создать задание
          </Link>
          {user && (
            <Link
              to="/my-tasks"
              className={`px-3.5 py-2 rounded-xl transition-colors ${
                location.pathname === '/my-tasks'
                  ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Мои заказы
            </Link>
          )}
          {user && (
            <Link
              to="/chats"
              className={`px-3.5 py-2 rounded-xl transition-colors ${
                location.pathname === '/chats'
                  ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Сообщения
            </Link>
          )}
          {user && user.email && ['admin@delo.ru'].includes(user.email) && (
            <Link
              to="/admin/dashboard"
              className={`px-3.5 py-2 rounded-xl transition-colors ${
                location.pathname === '/admin/dashboard'
                  ? 'bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              🛡️ Admin
            </Link>
          )}
        </nav>

        {/* User / Actions */}
        <div className="flex items-center gap-3">
          {token && <NotificationBell token={token} />}

          {user ? (
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                className="flex items-center gap-2 p-1.5 pr-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Avatar user={user} size="sm" />
                <div className="hidden sm:block text-left">
                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200 leading-none">
                    {user.name || user.email.split('@')[0]}
                  </span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    {(user.balance || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </Link>
              <button
                onClick={onLogout}
                className="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors hidden sm:block"
              >
                Выйти
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenAuth('login')}
                className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Вход
              </button>
              <button
                onClick={() => onOpenAuth('register')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all"
              >
                Регистрация
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function AuthModal({ isOpen, mode, onClose, onLoginSuccess }) {
  const { addToast } = useToast();
  const [isLogin, setIsLogin] = useState(mode === 'login');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLink, setForgotLink] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('customer');
  const [loading, setLoading] = useState(false);

  // Accessibility: modal management
  useModal(isOpen, onClose, {
    escapeEnabled: true,
    lockScroll: true,
    restoreFocus: true
  });

  useEffect(() => {
    setIsLogin(mode === 'login');
    setForgotMode(false);
    setForgotLink(null);
  }, [mode, isOpen]);

  if (!isOpen) return null;

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setForgotLink(null);
    try {
      const res = await fetch('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось отправить письмо');
      addToast(data.message || 'Письмо со ссылкой отправлено', 'success');
      // В dev-режиме без SMTP бэкенд возвращает ссылку прямо в ответе
      if (data.dev_reset_link) setForgotLink(data.dev_reset_link);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const formData = new URLSearchParams();
        formData.append('username', email);
        formData.append('password', password);

        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString(),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Неверный логин или пароль');

        addToast('Успешный вход в систему!', 'success');
        onLoginSuccess(data.access_token, data.role);
        onClose();
      } else {
        const res = await fetch('/register/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, role, name: name.trim() || null }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Ошибка регистрации');

        addToast('Регистрация успешна! Выполняется вход...', 'success');
        // Auto-login
        const loginForm = new URLSearchParams();
        loginForm.append('username', email);
        loginForm.append('password', password);
        const loginRes = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: loginForm.toString(),
        });
        const loginData = await loginRes.json();
        if (loginRes.ok) {
          onLoginSuccess(loginData.access_token, loginData.role);
        }
        onClose();
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="bg-white dark:bg-slate-800 max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl space-y-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="auth-modal-title" className="text-2xl font-extrabold text-slate-900 dark:text-white">
            {forgotMode ? 'Сброс пароля' : isLogin ? 'Вход в аккаунт' : 'Регистрация в ДЕЛО'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Закрыть модальное окно"
            className="text-slate-400 hover:text-slate-600 text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {forgotMode ? (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Укажите email аккаунта — отправим ссылку для установки нового пароля (действует 1 час).
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
              <input
                type="email"
                placeholder="name@example.com"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all"
            >
              {loading ? 'Отправка...' : 'Отправить ссылку'}
            </button>
            {forgotLink && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-300">
                <p className="font-bold mb-1">Режим разработки: почта не настроена, ссылка на сброс:</p>
                <a href={forgotLink} className="underline break-all font-semibold">{forgotLink}</a>
              </div>
            )}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => { setForgotMode(false); setForgotLink(null); }}
                className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
              >
                ← Назад ко входу
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Ваше имя</label>
                <input
                  type="text"
                  placeholder="Иван Иванов"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Ваша роль</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('customer')}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                      role === 'customer'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    💼 Я Заказчик
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('specialist')}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                      role === 'specialist'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    🛠️ Я Исполнитель
                  </button>
                </div>
              </div>
            </>
          )}

          <div>
            <label htmlFor="email-input" className="block text-xs font-semibold text-slate-500 mb-1">
              Email
            </label>
            <input
              id="email-input"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              aria-required="true"
              required
            />
          </div>

          <div>
            <label htmlFor="password-input" className="block text-xs font-semibold text-slate-500 mb-1">
              Пароль (от 8 символов)
            </label>
            <input
              id="password-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              aria-required="true"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all"
          >
            {loading ? 'Загрузка...' : isLogin ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
        )}

        {!forgotMode && (
        <div className="text-center pt-2 space-y-1">
          {isLogin && (
            <button
              type="button"
              onClick={() => { setForgotMode(true); setForgotEmail(email); }}
              className="block w-full text-xs text-slate-400 hover:text-indigo-500 font-semibold hover:underline"
            >
              Забыли пароль?
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
          >
            {isLogin ? 'Нет аккаунта? Зарегистрируйтесь' : 'Уже есть аккаунт? Войти'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const { token, user, role, login, logout, updateUser } = useAuthStore();
  const { addToast } = useToast();

  // Используем tasksStore вместо локального state
  const fetchTasks = useTasksStore(state => state.fetchTasks);
  const tasks = useTasksStore(state => state.getAllTasks());
  const loading = useTasksStore(state => state.loading);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login');

  // Drawer chat state
  const [drawerChatTaskId, setDrawerChatTaskId] = useState(null);

  const fetchUserProfile = async () => {
    if (!token) return;
    try {
      console.log('[fetchUserProfile] Загружаем профиль...');
      const res = await fetch('/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[fetchUserProfile] Профиль получен:', data);
        console.log('[fetchUserProfile] Avatar URL:', data.avatar);
        updateUser(data);
      } else {
        console.error('[fetchUserProfile] Ошибка:', res.status);
      }
    } catch (err) {
      console.error('[fetchUserProfile] Exception:', err);
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

  // Добавляем setInterval для периодического обновления профиля
  useEffect(() => {
    if (!token) return;

    const interval = setInterval(() => {
      fetchUserProfile();
    }, 5000); // Обновляем каждые 5 секунд

    return () => clearInterval(interval);
  }, [token]);

  const handleOpenAuth = (mode = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleLoginSuccess = (newToken, newRole) => {
    login(newToken, newRole);
    fetchUserProfile();
  };

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
                      onOpenChat={(tId) => setDrawerChatTaskId(tId)}
                      onOpenPublicProfile={(sId) => window.location.assign(`/specialist/${sId}`)}
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
                    />
                  }
                />
              </Routes>
            </Suspense>
          </main>

        {/* Footer */}
        <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 pt-8 pb-24 md:pb-8 px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-400">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">
                Д
              </div>
              <span className="font-bold text-slate-700 dark:text-slate-300">Платформа «ДЕЛО»</span>
              <span>© 2026. Все права защищены.</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/tasks" className="hover:underline">Задания</Link>
              <Link to="/create-task" className="hover:underline">Создать заказ</Link>
            </div>
          </div>
        </footer>

        {/* Bottom Nav for Mobile */}
        <BottomNav onOpenAuth={handleOpenAuth} />

        {/* Auth Modal */}
        <AuthModal
          isOpen={authModalOpen}
          mode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />

        {/* Chats Drawer */}
        {drawerChatTaskId && (
          <ChatsDrawer
            isOpen={!!drawerChatTaskId}
            onClose={() => setDrawerChatTaskId(null)}
            onOpenAuth={handleOpenAuth}
          />
        )}
      </div>
    </BrowserRouter>
  </ErrorBoundary>
  );
}
