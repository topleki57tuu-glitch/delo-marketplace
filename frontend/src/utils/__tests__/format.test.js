import { describe, it, expect } from 'vitest';
import { countLabel, lastSeenLabel, parseList, parseServerDate, plural, postedAgoLabel } from '../format.js';

/**
 * Помощники для текста интерфейса. Ошибки в них видны сразу всем:
 * «1 отзывов», навыки одной строкой «["React","Node"]» или время сообщений,
 * отстающее на три часа, — поэтому проверяем крайние случаи.
 */

describe('plural / countLabel', () => {
  it('склоняет по правилам русского языка, включая 11–14', () => {
    const forms = ['отзыв', 'отзыва', 'отзывов'];
    const cases = { 0: 'отзывов', 1: 'отзыв', 2: 'отзыва', 4: 'отзыва', 5: 'отзывов', 11: 'отзывов', 12: 'отзывов', 14: 'отзывов', 21: 'отзыв', 22: 'отзыва', 25: 'отзывов', 101: 'отзыв', 111: 'отзывов' };
    for (const [n, expected] of Object.entries(cases)) {
      expect(plural(Number(n), ...forms)).toBe(expected);
    }
  });

  it('countLabel ставит число перед словом и не падает на пустом значении', () => {
    expect(countLabel(3, 'сделка', 'сделки', 'сделок')).toBe('3 сделки');
    expect(countLabel(undefined, 'сделка', 'сделки', 'сделок')).toBe('0 сделок');
    expect(countLabel('21', 'сделка', 'сделки', 'сделок')).toBe('21 сделка');
  });
});

describe('parseList', () => {
  it('читает JSON-массив — так навыки сохраняет профиль', () => {
    expect(parseList('["React","Node.js"]')).toEqual(['React', 'Node.js']);
  });

  it('читает старый формат через запятую', () => {
    expect(parseList('сантехника, электрика ,')).toEqual(['сантехника', 'электрика']);
  });

  it('пустое значение даёт пустой список, а массив — без пустых элементов', () => {
    expect(parseList(null)).toEqual([]);
    expect(parseList('')).toEqual([]);
    expect(parseList(['a', '', null, 'b'])).toEqual(['a', 'b']);
  });
});

describe('parseServerDate', () => {
  it('время без зоны считает UTC — так его отдаёт бэкенд', () => {
    expect(parseServerDate('2026-11-01T12:00:00').toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(parseServerDate('2026-11-01 12:00:00').toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('явно указанную зону не трогает', () => {
    expect(parseServerDate('2026-11-01T12:00:00+03:00').toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(parseServerDate('2026-11-01T12:00:00Z').toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('пустое и нечитаемое значение превращает в null', () => {
    expect(parseServerDate('')).toBeNull();
    expect(parseServerDate(null)).toBeNull();
    expect(parseServerDate('вчера')).toBeNull();
  });
});

describe('lastSeenLabel', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');

  it('считает от UTC-времени бэкенда', () => {
    expect(lastSeenLabel('2026-11-01T11:55:00', now)).toBe('был(а) в сети 5 минут назад');
    expect(lastSeenLabel('2026-11-01T09:00:00', now)).toBe('был(а) в сети 3 часа назад');
    expect(lastSeenLabel('2026-10-31T12:00:00', now)).toBe('был(а) в сети вчера');
    expect(lastSeenLabel('2026-10-29T12:00:00', now)).toBe('был(а) в сети 3 дня назад');
  });

  it('совсем свежий и очень старый визит описывает словами', () => {
    expect(lastSeenLabel('2026-11-01T12:00:00', now)).toBe('был(а) в сети только что');
    expect(lastSeenLabel('2026-08-01T12:00:00', now)).toBe('давно не заходил(а)');
    expect(lastSeenLabel(null, now)).toBeNull();
  });
});

describe('postedAgoLabel', () => {
  // Сервер отдаёт UTC без зоны — подпись не должна «отставать» на часовой пояс.
  const now = Date.parse('2026-11-02T12:00:00Z');

  it('считает от UTC-времени сервера', () => {
    expect(postedAgoLabel('2026-11-02T11:59:30', now)).toBe('только что');
    expect(postedAgoLabel('2026-11-02T11:55:00', now)).toBe('5 минут назад');
    expect(postedAgoLabel('2026-11-02T11:39:00', now)).toBe('21 минуту назад');
    expect(postedAgoLabel('2026-11-02T09:30:00', now)).toBe('2 часа назад');
    expect(postedAgoLabel('2026-11-01T10:00:00', now)).toBe('вчера');
    expect(postedAgoLabel('2026-10-28T12:00:00', now)).toBe('5 дней назад');
  });

  it('не показывает старое, пустое и время «из будущего» как отрицательное', () => {
    expect(postedAgoLabel('2026-09-01T12:00:00', now)).toBeNull();
    expect(postedAgoLabel(null, now)).toBeNull();
    expect(postedAgoLabel('не дата', now)).toBeNull();
    expect(postedAgoLabel('2026-11-02T12:03:00', now)).toBe('только что');
  });
});
