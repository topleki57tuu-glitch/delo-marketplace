/*
 * Мелкие помощники для текста интерфейса.
 */

/** Русское склонение по числу: plural(5, 'отзыв', 'отзыва', 'отзывов') → 'отзывов' */
export function plural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «5 отзывов», «1 отзыв», «22 отзыва» */
export function countLabel(n, one, few, many) {
  const value = Number(n) || 0;
  return `${value} ${plural(value, one, few, many)}`;
}

/** Навыки в профиле хранятся JSON-массивом, у старых записей — строкой через запятую. */
export function parseList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch (e) {
    // не JSON — разбираем ниже
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Время с бэкенда — UTC без указания зоны («2026-11-01T12:00:00»).
 * Без суффикса Z браузер считает такую строку местным временем, и в Москве
 * время сообщений и уведомлений отставало на 3 часа.
 */
export function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim().replace(' ', 'T');
  let iso = s;
  if (/^\d{4}-\d\d-\d\d$/.test(s)) iso = s; // дата без времени и так читается как UTC
  else if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(s)) iso = `${s}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «в сети 5 минут назад», «в сети вчера» — для статуса специалиста. */
export function lastSeenLabel(value, now = Date.now()) {
  const date = parseServerDate(value);
  if (!date) return null;
  const time = date.getTime();
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return 'был(а) в сети только что';
  if (minutes < 60) return `был(а) в сети ${countLabel(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `был(а) в сети ${countLabel(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'был(а) в сети вчера';
  if (days < 30) return `был(а) в сети ${countLabel(days, 'день', 'дня', 'дней')} назад`;
  return 'давно не заходил(а)';
}

/**
 * «только что», «5 минут назад», «вчера» — когда опубликовано задание.
 * Старше месяца — null: такая подпись карточке уже ничего не добавляет.
 */
export function postedAgoLabel(value, now = Date.now()) {
  const date = parseServerDate(value);
  if (!date) return null;
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
  if (minutes < 2) return 'только что';
  if (minutes < 60) return `${countLabel(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${countLabel(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 30) return `${countLabel(days, 'день', 'дня', 'дней')} назад`;
  return null;
}
