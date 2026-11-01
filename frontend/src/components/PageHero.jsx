import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft, IconCheck } from './icons.jsx';

/*
 * Шапка раздела — тёмная полоса с сеткой и свечением, как hero главной.
 * Ей начинаются все страницы приложения: так разделы выглядят частями
 * одного продукта, а не набором разных экранов.
 *
 *   <PageHero
 *     eyebrow="Биржа заданий" icon={IconBriefcase}
 *     title="Задания" subtitle="…"
 *     back={{ to: '/products', label: 'Все товары' }}
 *     actions={<button className="btn btn-cta">…</button>}
 *   >
 *     {вкладки, поиск, плашки — всё, что должно стоять на тёмном фоне}
 *   </PageHero>
 *
 * media — аватар или обложка слева от заголовка (профили).
 * width — ширина колонки; та же ширина у PageBody, чтобы заголовок и
 * содержимое начинались по одной линии.
 * Полоса всегда тёмная, поэтому на ней стоит класс dark: поля, карточки и
 * кнопки внутри берут тёмные стили и в светлой теме.
 */

export const PAGE_WIDTHS = {
  wide: 'max-w-7xl',
  medium: 'max-w-5xl',
  narrow: 'max-w-3xl',
};

const PADDING = {
  md: 'pt-7 pb-8 sm:pt-12 sm:pb-12',
  sm: 'pt-5 pb-6 sm:pt-8 sm:pb-9',
};

export default function PageHero({
  eyebrow,
  icon: Icon,
  title,
  subtitle,
  back,
  media,
  actions,
  aside,
  children,
  width = 'wide',
  size = 'md',
  titleClassName = '',
  className = '',
}) {
  return (
    <section className={`hero-band dark ${className}`}>
      <div className={`relative mx-auto px-4 sm:px-6 lg:px-8 ${PAGE_WIDTHS[width] || PAGE_WIDTHS.wide} ${PADDING[size] || PADDING.md}`}>
        {back && (
          <Link to={back.to} className="hero-back mb-4 sm:mb-5">
            <IconArrowLeft size={16} /> {back.label}
          </Link>
        )}
        <div className={`flex flex-col gap-5 ${aside ? 'lg:flex-row lg:items-center' : 'md:flex-row md:items-end'} justify-between`}>
          <div className={`min-w-0 max-w-3xl ${media ? 'flex items-start gap-4 sm:gap-5' : ''}`}>
            {media && <div className="shrink-0">{media}</div>}
            <div className="min-w-0">
              {eyebrow && (
                <span className="hero-eyebrow mb-3 sm:mb-4">
                  {Icon && <Icon size={14} className="text-amber-300" />}
                  {eyebrow}
                </span>
              )}
              {title && <h1 className={`hero-title ${titleClassName}`}>{title}</h1>}
              {subtitle && <div className="hero-subtitle">{subtitle}</div>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
          {aside && <div className="shrink-0 lg:max-w-md w-full lg:w-auto">{aside}</div>}
        </div>
        {children && <div className="mt-6 sm:mt-7">{children}</div>}
      </div>
    </section>
  );
}

/**
 * Аватар для шапки профиля: фото или первая буква имени.
 * online — зелёная точка «в сети», verified — отметка проверенной личности.
 */
export function HeroAvatar({ src, name, fallback = 'П', online = false, verified = false }) {
  const letter = ((name || '').trim() || fallback)[0].toUpperCase();
  return (
    <div className="relative">
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-extrabold text-2xl sm:text-3xl flex items-center justify-center overflow-hidden ring-1 ring-white/15 shadow-xl shadow-indigo-950/40">
        {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : letter}
      </div>
      {online ? (
        <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 border-[3px] border-slate-950 rounded-full" title="В сети" />
      ) : verified ? (
        <span
          className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-sky-500 text-white border-2 border-slate-950 flex items-center justify-center"
          title="Личность подтверждена"
        >
          <IconCheck size={12} />
        </span>
      ) : null}
    </div>
  );
}

/** Содержимое под шапкой — той же ширины, с общими отступами. */
export function PageBody({ width = 'wide', className = '', children }) {
  return (
    <div className={`mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-28 md:pb-14 ${PAGE_WIDTHS[width] || PAGE_WIDTHS.wide} ${className}`}>
      {children}
    </div>
  );
}

/** Вкладки на тёмной полосе. items: [{ id, label, icon?, count? }] */
export function HeroTabs({ items, value, onChange, label, className = '' }) {
  const listRef = useRef(null);

  // На узком экране вкладки прокручиваются вбок: выбранная (например,
  // открытая по ссылке ?tab=admin) не должна оставаться за краем.
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const active = list.querySelector('[aria-selected="true"]');
    if (!active) return;
    const box = list.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left >= box.left && tab.right <= box.right) return;
    list.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
  }, [value]);

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={`hero-tabs ${className}`}>
      {items.map(({ id, label: text, icon: Icon, count }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`hero-tab ${active ? 'hero-tab-active' : ''}`}
          >
            {Icon && <Icon size={16} />}
            {text}
            {/* Пробел — чтобы скринридер прочитал «Покупки 2», а не «Покупки2» */}
            {count !== undefined && count !== null && (
              <>
                {' '}
                <span className="hero-tab-count">{count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
