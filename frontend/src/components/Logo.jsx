import React, { useId } from 'react';

/**
 * Фирменный знак «ДЕЛО»: буква «Д» на индиго-плашке и янтарная точка —
 * та же точка, что стоит после слова в логотипе. Нарисован путями, а не
 * текстом, чтобы выглядел одинаково везде, где нет наших шрифтов
 * (favicon, иконки PWA, превью ссылок). Исходник для иконок — public/favicon.svg,
 * при изменении формы правьте оба места.
 */
export function LogoMark({ size = 36, className = '' }) {
  const gid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`delo-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#delo-${gid})`} />
      <path
        d="M26 17H42V41 M26 17C26 28 24 35 20 41 M15 41H49 M15 41V48 M49 41V48"
        stroke="#fff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="51" cy="15" r="4" fill="#fbbf24" />
    </svg>
  );
}

/** Знак + надпись. tone="light" — для тёмного фона. */
export default function Logo({ size = 36, tone = 'dark', className = '' }) {
  const text = tone === 'light' ? 'text-white' : 'text-slate-900 dark:text-white';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className={`font-display font-bold tracking-tight leading-none ${text}`} style={{ fontSize: size * 0.5 }}>
        ДЕЛО<span className="text-amber-400">.</span>
      </span>
    </span>
  );
}
