/**
 * Юридические документы сервиса.
 *
 * LEGAL_VERSION — дата действующей редакции. Должна совпадать с
 * LEGAL_VERSION в backend/app/core/legal.py: сервер записывает её
 * пользователю, когда тот принимает документы, а по несовпадению фронтенд
 * просит принять новую редакцию. Расхождение ловит тест
 * src/constants/__tests__/legal.test.js.
 *
 * При существенной правке соглашения или согласия поднимите дату в обоих
 * местах — все пользователи при следующем входе увидят окно с документами.
 * Опечатку можно исправить без смены даты.
 */
export const LEGAL_VERSION = '2026-11-01';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** Дата редакции словами: «1 ноября 2026 г.». Считается из LEGAL_VERSION. */
export const LEGAL_EDITION = (() => {
  const [y, m, d] = LEGAL_VERSION.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y} г.`;
})();

export const LEGAL_DOCS = [
  { slug: 'terms', title: 'Пользовательское соглашение', short: 'Соглашение' },
  { slug: 'privacy', title: 'Политика обработки персональных данных', short: 'Политика' },
  { slug: 'consent', title: 'Согласие на обработку персональных данных', short: 'Согласие' },
];

export const legalHref = (slug) => `/legal/${slug}`;

export function legalDoc(slug) {
  return LEGAL_DOCS.find((d) => d.slug === slug) || null;
}
