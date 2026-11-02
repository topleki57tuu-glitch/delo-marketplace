// Шапка сайта: логотип, разделы, колокольчик уведомлений, чаты и меню
// пользователя (на телефоне разделы переезжают в нижнюю панель BottomNav).
import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { Avatar } from './Avatar';
import { IconAdmin, IconBox, IconMessages, IconReceipt, IconTasks, IconUser, IconWallet } from './icons.jsx';
import Logo from './Logo.jsx';
import { ThemeSwitch, ThemeToggle } from './ThemeToggle.jsx';

export default function NavigationBar({ user, token, onOpenAuth, onLogout }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Закрываем меню по клику вне и по Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Раньше в шапке было восемь ссылок в одну строку — они не влезали и
  // переносились на вторую строку. Разделы остались в шапке, личное
  // (заказы, покупки, товары, сообщения) убрано в выпадающее меню.
  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const navLinkClass = (path) =>
    `px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
      isActive(path)
        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
    }`;

  const menuItemClass =
    'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors text-left';

  // Права модератора приходят с бэкенда полем is_admin (его считает
  // app/core/security.py по ADMIN_EMAILS). Раньше здесь был хардкод
  // admin@delo.ru: он расходился со списком на сервере, и админ с другим
  // адресом не видел панель, хотя API ему доступ даёт.
  const isAdmin = !!user?.is_admin;

  return (
    <header className="sticky top-0 z-40 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800">
      {/* Промежуток 24px ниже lg не оставлял запаса: на 768px контенту
          нужно ровно 720px при доступных 720, и ссылке «Все задания» не
          хватало 13px — она переносилась в две строки. 16px дают 11px
          запаса, а с lg возвращается прежние 24px. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-2 min-[360px]:gap-4 lg:gap-6">
        {/* Логотип */}
        <Link to="/" className="shrink-0" aria-label="ДЕЛО — на главную">
          <Logo size={34} />
        </Link>

        {/* Разделы */}
        <nav className="hidden md:flex items-center gap-0.5">
          <Link to="/tasks" className={navLinkClass('/tasks')}>
            Все задания
          </Link>
          <Link to="/specialists" className={navLinkClass('/specialists')}>
            Специалисты
          </Link>
          <Link to="/products" className={navLinkClass('/products')}>
            Товары
          </Link>
        </nav>

        <div className="flex-1" />

        {/* Действия */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Переключатель темы. Гостю на узких экранах (<400px) он не
              помещается рядом с «Вход» и «Регистрация» — там тема выбирается
              в подвале. Порог был 390px, но ровно на 390 (iPhone 12–15) шапке
              не хватало пикселя, и страница сдвигалась вбок. */}
          <ThemeToggle className={user ? '' : 'max-[399px]:hidden'} />
          {token && <NotificationBell token={token} />}

          {/* На 768–1023px шапка не вмещает всё сразу: логотип, три ссылки,
              уведомления, кнопку и чип профиля. Замер до правки: контенту
              нужно 827px при доступных 720 — страница прокручивалась вбок на
              55px, а «Все задания» переносилось в две строки. Саму ссылку
              убрать нельзя: в выпадающем меню её нет, а нижняя навигация
              скрыта до 768px, так что на этих ширинах кнопка в шапке —
              единственный вход в создание задания. Поэтому до lg оставляем
              от неё только знак «+» (он же используется в нижней навигации). */}
          <Link
            to="/create-task"
            aria-label="Создать задание"
            title="Создать задание"
            className="hidden sm:inline-flex btn btn-primary !px-4 !py-2 !text-xs sm:!text-sm"
          >
            <span className="hidden lg:inline">+ Создать задание</span>
            <span className="lg:hidden" aria-hidden="true">
              +
            </span>
          </Link>

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 p-1.5 pr-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
                <span className="text-slate-400 text-[10px]">▼</span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 p-1.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-pop"
                >
                  <Link to="/profile" className={menuItemClass} onClick={() => setMenuOpen(false)}>
                    <IconUser /> Мой профиль
                  </Link>
                  <Link to="/profile?tab=wallet" className={menuItemClass} onClick={() => setMenuOpen(false)}>
                    <IconWallet /> Кошелёк
                  </Link>
                  <Link to="/my-tasks" className={menuItemClass} onClick={() => setMenuOpen(false)}>
                    <IconTasks /> Мои заказы
                  </Link>
                  <Link to="/my-orders" className={menuItemClass} onClick={() => setMenuOpen(false)}>
                    <IconReceipt /> Мои покупки
                  </Link>
                  <Link to="/my-products" className={menuItemClass} onClick={() => setMenuOpen(false)}>
                    <IconBox /> Мои товары
                  </Link>
                  <Link to="/chats" className={menuItemClass} onClick={() => setMenuOpen(false)}>
                    <IconMessages /> Сообщения
                  </Link>
                  {isAdmin && (
                    <Link
                      to="/admin/dashboard"
                      className={`${menuItemClass} text-red-600 dark:text-red-400`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <IconAdmin /> Админ-панель
                    </Link>
                  )}
                  <div className="my-1.5 h-px bg-slate-200 dark:bg-slate-700" />
                  <div className="px-3 pt-1 pb-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Тема</p>
                    <ThemeSwitch className="w-full" />
                  </div>
                  <div className="my-1.5 h-px bg-slate-200 dark:bg-slate-700" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className={`${menuItemClass} text-slate-500 hover:text-red-600 dark:text-slate-400`}
                  >
                    Выйти
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* На 320px «Регистрация» обрезалась краем экрана: кнопкам
                  там уже узкие поля. */}
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="btn btn-secondary !px-4 max-[359px]:!px-2.5 !py-2 !text-xs sm:!text-sm"
              >
                Вход
              </button>
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="btn btn-primary !px-4 max-[359px]:!px-2.5 !py-2 !text-xs sm:!text-sm"
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
