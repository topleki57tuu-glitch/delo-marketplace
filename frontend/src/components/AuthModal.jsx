// Окно входа и регистрации, включая восстановление пароля по email.
import React, { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { useModal } from '../utils/a11y';
import { apiErrorMessage } from '../utils/apiError';
import { LegalConsentFields } from './LegalConsentFields.jsx';
import { IconBriefcase, IconClose, IconTools } from './icons.jsx';

export default function AuthModal({ isOpen, mode, onClose, onLoginSuccess }) {
  const { addToast } = useToast();
  const [isLogin, setIsLogin] = useState(mode === 'login');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLink, setForgotLink] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('customer');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [pdConsent, setPdConsent] = useState(false);
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
    // Согласие даётся каждый раз заново: отметки, оставшиеся от прошлого
    // открытия окна, согласием не считаются.
    setAcceptTerms(false);
    setPdConsent(false);
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
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Не удалось отправить письмо'));
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
        if (!res.ok) throw new Error(apiErrorMessage(data, 'Неверный логин или пароль'));

        addToast('Успешный вход в систему!', 'success');
        onLoginSuccess(data.access_token, data.role, data.refresh_token);
        onClose();
      } else {
        // Роль сервер при регистрации не принимает: аккаунт создаётся
        // заказчиком, а исполнителем становится через switch-role ниже.
        const res = await fetch('/register/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            name: name.trim() || null,
            accept_terms: acceptTerms,
            pd_consent: pdConsent,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(apiErrorMessage(data, 'Ошибка регистрации'));

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
          let accessToken = loginData.access_token;
          let userRole = loginData.role;
          // Выбор «Я Исполнитель» раньше молча терялся: сервер создаёт
          // заказчика, а форма роль никуда не передавала. Переключаем сразу
          // после входа — тем же запросом, что и кнопка в профиле.
          if (role === 'specialist' && userRole !== 'specialist') {
            try {
              const sw = await fetch('/users/me/switch-role', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const swData = await sw.json().catch(() => ({}));
              if (sw.ok && swData.token) {
                accessToken = swData.token;
                userRole = swData.role;
              } else {
                addToast('Аккаунт создан как заказчик — роль исполнителя можно включить в профиле', 'info');
              }
            } catch {
              addToast('Аккаунт создан как заказчик — роль исполнителя можно включить в профиле', 'info');
            }
          }
          onLoginSuccess(accessToken, userRole, loginData.refresh_token);
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
            <IconClose />
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
                    aria-pressed={role === 'customer'}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                      role === 'customer'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <IconBriefcase /> Я Заказчик
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('specialist')}
                    aria-pressed={role === 'specialist'}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                      role === 'specialist'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <IconTools /> Я Исполнитель
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

          {!isLogin && (
            <LegalConsentFields
              terms={acceptTerms}
              pd={pdConsent}
              onTermsChange={setAcceptTerms}
              onPdChange={setPdConsent}
            />
          )}

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
