// Общие части страницы задания: иконки категорий, плашки статуса,
// форматирование сумм и дат, карточка раздела и строка сведений.
import React from 'react';
import {
  IconCatBeauty,
  IconCatBusiness,
  IconCatCleaning,
  IconCatDelivery,
  IconCatDesign,
  IconCatDevelopment,
  IconCatEvents,
  IconCatOther,
  IconCatPhotoVideo,
  IconCatRepairs,
  IconCatTutoring,
  IconCatWriting,
} from '../../components/icons.jsx';

export const CATEGORY_ICONS = {
  development: IconCatDevelopment,
  design: IconCatDesign,
  writing: IconCatWriting,
  repairs: IconCatRepairs,
  cleaning: IconCatCleaning,
  delivery: IconCatDelivery,
  photo_video: IconCatPhotoVideo,
  tutoring: IconCatTutoring,
  beauty: IconCatBeauty,
  events: IconCatEvents,
  business: IconCatBusiness,
  other: IconCatOther,
};

// Плашки статуса стоят на тёмной шапке, поэтому цвета — полупрозрачные светлые
export const STATUS_META = {
  open: { label: 'Принимает отклики', cls: 'bg-emerald-400/15 text-emerald-300', dot: 'bg-emerald-400' },
  in_progress: { label: 'В работе', cls: 'bg-amber-400/15 text-amber-200', dot: 'bg-amber-300' },
  disputed: { label: 'Арбитраж', cls: 'bg-red-400/15 text-red-300', dot: 'bg-red-400' },
  completed: { label: 'Завершено', cls: 'bg-sky-400/15 text-sky-200', dot: 'bg-sky-300' },
  cancelled: { label: 'Отменено', cls: 'bg-white/10 text-slate-300', dot: 'bg-slate-400' },
};

export const formatMoney = (value) => `${Number(value).toLocaleString('ru-RU')} ₽`;
// Бэкенд отдаёт «2026-11-08 15:40:26» — Safari не разбирает дату с пробелом
export const parseDate = (value) => new Date(String(value).replace(' ', 'T'));
export const formatDate = (value) => parseDate(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function Card({ eyebrow, title, action, children, className = '', id }) {
  return (
    <section id={id} className={`card p-5 sm:p-6 ${className}`}>
      {(eyebrow || title) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
            {title && <h2 className="section-title mt-1">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 flex items-center justify-center">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{children}</div>
      </div>
    </div>
  );
}
