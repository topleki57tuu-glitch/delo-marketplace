import React from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import { IconAdmin, IconCheck, IconLock } from './icons.jsx';

// Только существующие разделы: мёртвые ссылки («Блог», «Вакансии») делают
// продукт похожим на шаблон сильнее, чем их отсутствие.
const COLUMNS = [
  {
    title: 'Заказчикам',
    links: [
      { to: '/create-task', label: 'Создать задание' },
      { to: '/specialists', label: 'Найти специалиста' },
      { to: '/my-tasks', label: 'Мои заказы' },
      { to: '/#safe-deal', label: 'Безопасная сделка' },
    ],
  },
  {
    title: 'Исполнителям',
    links: [
      { to: '/tasks', label: 'Найти заказы' },
      { to: '/profile', label: 'Профиль и верификация' },
      { to: '/chats', label: 'Сообщения' },
      { to: '/disputes', label: 'Споры' },
    ],
  },
  {
    title: 'Товары',
    links: [
      { to: '/products', label: 'Каталог' },
      { to: '/create-product', label: 'Продать товар' },
      { to: '/my-orders', label: 'Мои покупки' },
      { to: '/my-products', label: 'Мои товары' },
    ],
  },
  {
    title: 'Помощь',
    links: [
      { to: '/#how', label: 'Как это работает' },
      { to: '/#faq', label: 'Вопросы и ответы' },
    ],
  },
];

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-slate-950 text-slate-400 pb-24 md:pb-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-10">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2fr]">
          <div className="max-w-sm">
            <Link to="/" aria-label="ДЕЛО — на главную">
              <Logo size={36} tone="light" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed">
              Сервис безопасных сделок: заказывайте услуги у проверенных специалистов и
              покупайте товары, а деньги остаются на эскроу-счёте до подтверждения результата.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              <li className="flex items-center gap-2"><IconLock className="text-emerald-400" /> Оплата через эскроу</li>
              <li className="flex items-center gap-2"><IconAdmin className="text-emerald-400" /> Арбитраж споров</li>
              <li className="flex items-center gap-2"><IconCheck className="text-emerald-400" /> Верификация исполнителей</li>
            </ul>
          </div>

          <nav aria-label="Разделы сайта" className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">{col.title}</h3>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.to}>
                      <Link to={l.to} className="hover:text-white transition-colors">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <span>© {year} ДЕЛО. Все права защищены.</span>
          <span className="text-slate-500">Платежи принимаются через ЮMoney</span>
        </div>
      </div>
    </footer>
  );
}
