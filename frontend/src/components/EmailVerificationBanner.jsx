import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { IconClose, IconMail } from './icons.jsx';
import { needsEmailVerification, resendVerificationEmail } from '../utils/emailVerification';
import { requestProfileRefresh } from '../utils/profileSync';

/**
 * Кнопка «Отправить письмо ещё раз» с результатом рядом.
 * Используется в полоске под шапкой и в окне вывода денег.
 */
export function ResendVerificationButton({ className = '' }) {
  const token = useAuthStore((s) => s.token);
  const [state, setState] = useState({ status: 'idle', message: '', devLink: null });

  const onClick = async () => {
    setState({ status: 'sending', message: '', devLink: null });
    const result = await resendVerificationEmail(token);
    // Почту успели подтвердить в другой вкладке — профиль перечитается,
    // и напоминание исчезнет само.
    if (result.alreadyVerified) requestProfileRefresh();
    setState({ status: result.ok ? 'sent' : 'error', message: result.message, devLink: result.devLink || null });
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={state.status === 'sending'}
        className="btn btn-secondary !px-3 !py-1.5 !text-xs"
      >
        {state.status === 'sending' ? 'Отправляем…' : 'Отправить письмо ещё раз'}
      </button>
      <span role="status" aria-live="polite" className={`text-xs ${state.status === 'error' ? 'text-rose-700 dark:text-rose-300' : ''}`}>
        {state.message}
        {state.status === 'sent' && !state.devLink && ' — если его нет, загляните в «Спам»'}
      </span>
      {state.devLink && (
        <a href={state.devLink} className="text-xs font-semibold underline">
          Открыть ссылку из письма (режим разработки)
        </a>
      )}
    </span>
  );
}

const dismissKey = (userId) => `delo:email-banner-hidden:${userId}`;

function isHidden(userId) {
  try {
    return window.sessionStorage.getItem(dismissKey(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Полоска «Подтвердите почту» под шапкой — для тех, кто не перешёл по ссылке
 * из письма. Крестик прячет её до конца сеанса (до закрытия вкладки), чтобы
 * не мешала, но и не забылась навсегда.
 */
export default function EmailVerificationBanner() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  const [hiddenFor, setHiddenFor] = useState(null);

  if (!token || !needsEmailVerification(user) || pathname.startsWith('/verify-email')) return null;
  if (hiddenFor === user.id || isHidden(user.id)) return null;

  const hide = () => {
    try {
      window.sessionStorage.setItem(dismissKey(user.id), '1');
    } catch {
      // Хранилище недоступно (приватный режим) — прячем до перезагрузки.
    }
    setHiddenFor(user.id);
  };

  return (
    <div
      role="region"
      aria-label="Подтверждение почты"
      className="border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <IconMail size={18} className="shrink-0" aria-hidden="true" />
        <p className="flex-1 min-w-[12rem]">
          Подтвердите почту <b className="break-all">{user.email}</b> — ссылка в письме от ДЕЛО.
          {user.email_verification_required && ' Без этого не получится вывести деньги.'}
        </p>
        <ResendVerificationButton />
        <button
          type="button"
          onClick={hide}
          aria-label="Скрыть напоминание"
          className="p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-800/40"
        >
          <IconClose size={16} />
        </button>
      </div>
    </div>
  );
}
