/**
 * Подтверждение почты (backend/app/core/email_verification.py).
 *
 * После регистрации на почту уходит письмо со ссылкой /verify-email?token=…
 * Подтверждённая почта нужна для вывода денег, когда на сервере настроена
 * отправка писем.
 */
import { apiErrorMessage } from './apiError';

/** Показывать ли напоминание «Подтвердите почту». */
export function needsEmailVerification(user) {
  return Boolean(user && user.email_verified === false && user.email_verification_available);
}

/** Блокирует ли неподтверждённая почта вывод денег. */
export function withdrawalNeedsEmail(user) {
  return Boolean(user && user.email_verified === false && user.email_verification_required);
}

/**
 * Отправить письмо со ссылкой ещё раз.
 * Возвращает { ok, message, devLink?, alreadyVerified? } и не бросает исключений.
 */
export async function resendVerificationEmail(token) {
  try {
    const res = await fetch('/auth/resend-verification', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fallback = res.status === 429
        ? 'Письма уже отправлены — проверьте почту и папку «Спам» или попробуйте через час'
        : 'Не удалось отправить письмо';
      return { ok: false, message: res.status === 429 ? fallback : apiErrorMessage(data, fallback) };
    }
    return {
      ok: true,
      message: data.message || 'Письмо отправлено',
      devLink: data.dev_verify_link || null,
      alreadyVerified: Boolean(data.already_verified),
    };
  } catch {
    return { ok: false, message: 'Нет связи с сервером — попробуйте ещё раз' };
  }
}
