import React from 'react';
import { useTheme } from '../utils/theme.js';
import { IconMonitor, IconMoon, IconSun } from './icons.jsx';

/**
 * Кнопка в шапке: одним нажатием — светлая или тёмная тема.
 * Значок показывает, во что переключит кнопка (луна — «станет темно»).
 */
export function ThemeToggle({ className = '' }) {
  const { resolved, toggleTheme } = useTheme();
  const dark = resolved === 'dark';
  const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors ${className}`}
    >
      {dark ? <IconSun size={19} /> : <IconMoon size={19} />}
    </button>
  );
}

const OPTIONS = [
  { id: 'light', label: 'Светлая', icon: IconSun },
  { id: 'dark', label: 'Тёмная', icon: IconMoon },
  { id: 'system', label: 'Как в системе', short: 'Авто', icon: IconMonitor },
];

/**
 * Выбор из трёх вариантов — в меню профиля и в подвале. Только здесь можно
 * вернуться к режиму «как в системе» после ручного выбора.
 * tone="dark" — для тёмного фона (подвал).
 */
export function ThemeSwitch({ tone = 'default', className = '' }) {
  const { preference, setTheme } = useTheme();
  const onDark = tone === 'dark';
  const box = onDark
    ? 'bg-white/5 border-white/10'
    : 'bg-slate-100 border-slate-200 dark:bg-slate-900 dark:border-slate-700';
  const idle = onDark
    ? 'text-slate-400 hover:text-white'
    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white';
  const active = onDark
    ? 'bg-white/15 text-white'
    : 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white';

  return (
    <div role="radiogroup" aria-label="Тема оформления" className={`inline-flex gap-0.5 p-0.5 rounded-xl border ${box} ${className}`}>
      {OPTIONS.map(({ id, label, short, icon: Icon }) => {
        const checked = preference === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={checked}
            title={label}
            onClick={() => setTheme(id)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-[0.625rem] text-xs font-semibold whitespace-nowrap transition-colors ${checked ? active : idle}`}
          >
            <Icon size={14} />
            <span>{short || label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
