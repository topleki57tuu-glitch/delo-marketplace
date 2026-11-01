import React from 'react';
import { IconLock, IconSearch, IconWarning } from './icons.jsx';

/*
 * Общие состояния страниц: «нужно войти», «нет доступа», «пусто»,
 * «не найдено», загрузка. Раньше каждая страница рисовала свою карточку —
 * с разными радиусами, отступами и кнопками.
 */

const TONES = {
  default: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
};

export function StateCard({ icon: Icon = IconSearch, tone = 'default', title, text, children, dashed = false, className = '' }) {
  return (
    <div
      className={`rounded-2xl border ${dashed ? 'border-dashed border-slate-300 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700/70'} bg-white dark:bg-slate-800/60 px-6 py-12 sm:py-14 text-center ${className}`}
    >
      <span className={`mx-auto w-12 h-12 rounded-2xl flex items-center justify-center ${TONES[tone] || TONES.default}`}>
        <Icon size={22} />
      </span>
      {title && <h2 className="mt-4 text-lg font-extrabold text-slate-900 dark:text-white">{title}</h2>}
      {text && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">{text}</p>}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Карточка «нужно войти» с кнопкой, открывающей окно входа. */
export function AuthRequired({ onOpenAuth, title = 'Требуется авторизация', text, className = '' }) {
  return (
    <StateCard icon={IconLock} title={title} text={text} className={`max-w-xl mx-auto ${className}`}>
      <button type="button" className="btn btn-primary" onClick={() => onOpenAuth?.('login')}>
        Войти в аккаунт
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => onOpenAuth?.('register')}>
        Создать аккаунт
      </button>
    </StateCard>
  );
}

export function ErrorState({ title = 'Что-то пошло не так', text, onRetry, className = '' }) {
  return (
    <StateCard icon={IconWarning} tone="danger" title={title} text={text} className={className}>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Повторить
        </button>
      )}
    </StateCard>
  );
}

export function Spinner({ label = 'Загрузка…', className = '' }) {
  return (
    <div className={`py-16 text-center ${className}`} role="status">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
