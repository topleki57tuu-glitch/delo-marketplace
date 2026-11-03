import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { IconCheck, IconMail, IconWarning } from '../components/icons.jsx';
import { ResendVerificationButton } from '../components/EmailVerificationBanner.jsx';
import { apiErrorMessage } from '../utils/apiError';
import { requestProfileRefresh } from '../utils/profileSync';

/**
 * Страница из письма: /verify-email?token=…
 *
 * Подтверждает почту сразу при открытии — нажимать ничего не нужно. Вход не
 * требуется: ссылку часто открывают на телефоне, где человек на сайт не
 * входил. Если вошёл — профиль перечитывается, и полоска «Подтвердите почту»
 * исчезает.
 */
export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const isLoggedIn = useAuthStore((s) => Boolean(s.token));
  const [state, setState] = useState(() => (token ? { status: 'loading' } : { status: 'error', message: 'В ссылке нет кода подтверждения. Откройте ссылку из письма целиком.' }));
  const sentFor = useRef(null);

  useEffect(() => {
    // В StrictMode эффект запускается дважды — второй запрос не нужен.
    if (!token || sentFor.current === token) return;
    sentFor.current = token;
    fetch('/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(apiErrorMessage(data, 'Не удалось подтвердить почту'));
        setState({ status: 'done', email: data.email, already: Boolean(data.already_verified) });
        requestProfileRefresh();
      })
      .catch((err) => {
        const offline = err instanceof TypeError;
        setState({ status: 'error', message: offline ? 'Нет связи с сервером — обновите страницу.' : err.message });
      });
  }, [token]);

  return (
    <section className="hero-band min-h-[75vh] flex items-center">
      <div className="relative w-full max-w-md mx-auto px-4 py-12 sm:py-16">
        <div className="text-center mb-6">
          <span className="hero-eyebrow mb-4">
            <IconMail size={14} className="text-amber-300" /> Почта
          </span>
          <h1 className="hero-title">Подтверждение почты</h1>
        </div>

        <div className="card p-6 sm:p-8 shadow-pop text-center space-y-5">
          {state.status === 'loading' && (
            <p className="text-sm text-slate-600 dark:text-slate-300" role="status">Проверяем ссылку…</p>
          )}

          {state.status === 'done' && (
            <>
              <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                <IconCheck size={22} />
              </span>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 font-semibold" role="status">
                {state.already ? 'Почта уже подтверждена' : 'Почта подтверждена'}
                {state.email ? `: ${state.email}` : ''}. Спасибо!
              </p>
              <Link to={isLoggedIn ? '/profile' : '/'} className="btn btn-primary w-full">
                {isLoggedIn ? 'В профиль' : 'На главную'}
              </Link>
            </>
          )}

          {state.status === 'error' && (
            <>
              <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
                <IconWarning size={22} />
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-200" role="alert">{state.message}</p>
              {isLoggedIn ? (
                <ResendVerificationButton className="justify-center" />
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Чтобы получить новое письмо, войдите на сайт — в полоске сверху будет кнопка «Отправить письмо ещё раз».
                </p>
              )}
              <Link to="/" className="btn btn-ghost w-full">На главную</Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
