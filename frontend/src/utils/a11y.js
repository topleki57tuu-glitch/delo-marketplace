import { useEffect } from 'react';

/**
 * Хук для создания focus trap в модальных окнах.
 * Удерживает фокус внутри контейнера при навигации Tab/Shift+Tab.
 *
 * @param {boolean} isOpen - Активен ли trap
 * @param {React.RefObject} containerRef - Ref на контейнер (опционально)
 */
export function useFocusTrap(isOpen, containerRef = null) {
  useEffect(() => {
    if (!isOpen) return;

    const container = containerRef?.current || document;
    const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusableElements = Array.from(
      container.querySelectorAll(focusableSelector)
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Устанавливаем фокус на первый элемент
    firstElement?.focus();

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab (назад)
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab (вперёд)
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen, containerRef]);
}

/**
 * Хук для закрытия модального окна по Escape.
 *
 * @param {function} callback - Функция закрытия
 * @param {boolean} enabled - Включён ли хук
 */
export function useEscapeKey(callback, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        callback();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [callback, enabled]);
}

/**
 * Хук для блокировки скролла body при открытом модальном окне.
 *
 * @param {boolean} isOpen - Открыто ли модальное окно
 */
export function useLockBodyScroll(isOpen) {
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);
}

/**
 * Хук для восстановления фокуса на элементе при закрытии модального окна.
 *
 * @param {boolean} isOpen - Открыто ли модальное окно
 */
export function useRestoreFocus(isOpen) {
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocusedElement = document.activeElement;

    return () => {
      // Восстанавливаем фокус при размонтировании
      if (previouslyFocusedElement instanceof HTMLElement) {
        previouslyFocusedElement.focus();
      }
    };
  }, [isOpen]);
}

/**
 * Комбинированный хук для модальных окон.
 * Включает focus trap, Escape handling, lock scroll и restore focus.
 *
 * @param {boolean} isOpen - Открыто ли модальное окно
 * @param {function} onClose - Функция закрытия
 * @param {object} options - Опции { escapeEnabled, lockScroll, restoreFocus }
 */
export function useModal(isOpen, onClose, options = {}) {
  const {
    escapeEnabled = true,
    lockScroll = true,
    restoreFocus = true,
    containerRef = null
  } = options;

  useFocusTrap(isOpen, containerRef);
  useEscapeKey(onClose, escapeEnabled && isOpen);

  if (lockScroll) {
    useLockBodyScroll(isOpen);
  }

  if (restoreFocus) {
    useRestoreFocus(isOpen);
  }
}

/**
 * Хук для объявления live region обновлений (для screen readers).
 *
 * @param {string} message - Сообщение для объявления
 * @param {string} politeness - 'polite' | 'assertive' | 'off'
 */
export function useAnnounce(message, politeness = 'polite') {
  useEffect(() => {
    if (!message) return;

    const announcer = document.createElement('div');
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', politeness);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.className = 'sr-only';
    announcer.textContent = message;

    document.body.appendChild(announcer);

    // Удаляем через 1 секунду (после объявления)
    const timer = setTimeout(() => {
      document.body.removeChild(announcer);
    }, 1000);

    return () => {
      clearTimeout(timer);
      if (document.body.contains(announcer)) {
        document.body.removeChild(announcer);
      }
    };
  }, [message, politeness]);
}

/**
 * Хук для управления ID элемента (для связывания label с input через htmlFor).
 *
 * @param {string} prefix - Префикс ID
 * @returns {string} Уникальный ID
 */
let idCounter = 0;
export function useId(prefix = 'id') {
  const { useState } = require('react');
  const [id] = useState(() => `${prefix}-${++idCounter}`);
  return id;
}
