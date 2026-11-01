/**
 * Текст ошибки из ответа API.
 *
 * FastAPI отдаёт detail в двух видах: строкой (HTTPException) и списком
 * объектов (ошибка валидации схемы, 422). Раньше форма регистрации делала
 * new Error(data.detail) и на слабом пароле показывала «[object Object]».
 */
export function apiErrorMessage(data, fallback = 'Что-то пошло не так') {
  const detail = data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const messages = detail
      .map((d) => (typeof d === 'string' ? d : d?.msg))
      .filter(Boolean)
      // Pydantic дописывает к тексту из валидатора служебное «Value error, ».
      .map((m) => String(m).replace(/^Value error,\s*/i, ''));
    if (messages.length) return messages.join('. ');
  }
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  return fallback;
}
