import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { LEGAL_DOCS, legalHref } from '../constants/legal.js';

/**
 * Заголовок вкладки по адресу страницы.
 *
 * Раньше у всех страниц был один заголовок из index.html — десять вкладок
 * сервиса не различались, а в истории браузера и в закладках было десять
 * одинаковых строк. Страницы с данными (задание, товар, специалист) уточняют
 * заголовок сами через useDocumentTitle, когда данные загрузятся.
 */
export const SITE_TITLE = 'ДЕЛО — найдите специалиста для любой задачи';

const STATIC_TITLES = {
  '/tasks': 'Задания',
  '/specialists': 'Специалисты',
  '/products': 'Товары',
  '/create-task': 'Новое задание',
  '/create-product': 'Новый товар',
  '/profile': 'Мой профиль',
  '/my-tasks': 'Мои заказы',
  '/my-orders': 'Мои покупки',
  '/my-products': 'Мои товары',
  '/chats': 'Сообщения',
  '/disputes': 'Споры',
  '/admin/dashboard': 'Панель модератора',
  '/help': 'Помощь',
  '/reset': 'Новый пароль',
  '/verify-email': 'Подтверждение почты',
  ...Object.fromEntries(LEGAL_DOCS.map((d) => [legalHref(d.slug), d.title])),
};

const PATTERN_TITLES = [
  [/^\/tasks\/[^/]+$/, 'Задание'],
  [/^\/products\/[^/]+\/edit$/, 'Редактирование товара'],
  [/^\/products\/[^/]+$/, 'Товар'],
  [/^\/specialist\/[^/]+$/, 'Специалист'],
];

export function pageTitle(name) {
  return name ? `${name} — ДЕЛО` : SITE_TITLE;
}

export function titleForPath(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (STATIC_TITLES[path]) return pageTitle(STATIC_TITLES[path]);
  const hit = PATTERN_TITLES.find(([re]) => re.test(path));
  return pageTitle(hit ? hit[1] : null);
}

export default function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
  return null;
}

/**
 * Уточнить заголовок вкладки из страницы: название задания, товара, имя
 * специалиста. Зависит и от адреса — RouteMeta на каждом переходе ставит
 * общий заголовок, а страница, оставшаяся смонтированной, должна вернуть свой.
 */
export function useDocumentTitle(name) {
  const { pathname } = useLocation();
  useEffect(() => {
    if (name) document.title = pageTitle(name);
  }, [name, pathname]);
}
