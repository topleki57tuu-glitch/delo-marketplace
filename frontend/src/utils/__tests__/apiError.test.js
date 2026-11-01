import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '../apiError';

describe('apiErrorMessage', () => {
  it('строковый detail отдаёт как есть', () => {
    expect(apiErrorMessage({ detail: 'Пользователь уже существует' })).toBe('Пользователь уже существует');
  });

  it('ошибка валидации 422 — текст, а не [object Object]', () => {
    const data = {
      detail: [
        { type: 'value_error', loc: ['body', 'password'], msg: 'Value error, Пароль должен содержать цифру' },
        { type: 'missing', loc: ['body', 'email'], msg: 'Field required' },
      ],
    };
    expect(apiErrorMessage(data)).toBe('Пароль должен содержать цифру. Field required');
  });

  it('без понятного текста — запасная фраза', () => {
    expect(apiErrorMessage(null, 'Ошибка регистрации')).toBe('Ошибка регистрации');
    expect(apiErrorMessage({ detail: [] })).toBe('Что-то пошло не так');
    expect(apiErrorMessage({ message: 'Сервис недоступен' })).toBe('Сервис недоступен');
  });
});
