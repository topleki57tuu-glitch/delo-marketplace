import { describe, it, expect } from 'vitest';
import { titleForPath, pageTitle, SITE_TITLE } from '../RouteMeta';

describe('titleForPath', () => {
  it('у разделов свой заголовок вкладки', () => {
    expect(titleForPath('/tasks')).toBe('Задания — ДЕЛО');
    expect(titleForPath('/tasks/')).toBe('Задания — ДЕЛО');
    expect(titleForPath('/help')).toBe('Помощь — ДЕЛО');
    expect(titleForPath('/legal/privacy')).toBe('Политика обработки персональных данных — ДЕЛО');
  });

  it('страницы с идентификатором — по шаблону', () => {
    expect(titleForPath('/tasks/42')).toBe('Задание — ДЕЛО');
    expect(titleForPath('/products/7/edit')).toBe('Редактирование товара — ДЕЛО');
    expect(titleForPath('/specialist/3')).toBe('Специалист — ДЕЛО');
  });

  it('главная и неизвестные адреса — общий заголовок', () => {
    expect(titleForPath('/')).toBe(SITE_TITLE);
    expect(titleForPath('/что-то-странное')).toBe(SITE_TITLE);
    expect(pageTitle('')).toBe(SITE_TITLE);
  });
});
