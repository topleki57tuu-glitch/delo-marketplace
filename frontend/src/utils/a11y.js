import { useEffect, useState } from 'react';

/**
 * Хук для управления focus trap в модальных окнах
 * Ограничивает фокус внутри модального окна для keyboard navigation
 */
export function useFocusTrap(isOpen, containerRef) {
  useEffect(() => {
    if (!isOpen || !containerRef?.current) return;

    const container = containerRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Список элементов собираем заново при каждом нажатии Tab: содержимое
    // окна меняется (окно оплаты после создания платежа показывает другие
    // кнопки), и запомненные при открытии элементы уже не в документе.
    const focusables = () => container.querySelectorAll(focusableSelector);

    // Установить фокус на первый элемент
    focusables()[0]?.focus();

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;
      const focusableElements = focusables();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement) return;

      if (!container.contains(document.activeElement)) {
        e.preventDefault();
        firstElement.focus();
        return;
      }

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleTab);
    return () => container.removeEventListener('keydown', handleTab);
  }, [isOpen, containerRef]);
}

/**
 * Комбинированный хук для модальных окон
 * Объединяет escape key, lock scroll и focus management
 */
export function useModal(isOpen, onClose, options = {}) {
  const {
    escapeEnabled = true,
    lockScroll = true,
    restoreFocus = true
  } = options;

  // Escape key
  useEscapeKey(onClose, isOpen && escapeEnabled);

  // Lock body scroll
  useLockBodyScroll(isOpen && lockScroll);

  // Restore focus on close
  useEffect(() => {
    if (!restoreFocus || !isOpen) return;

    const previousActiveElement = document.activeElement;

    return () => {
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    };
  }, [isOpen, restoreFocus]);
}

/**
 * Хук для обработки клавиши Escape
 * Используется для закрытия модальных окон и выпадающих меню
 */
export function useEscapeKey(callback, isActive = true) {
  useEffect(() => {
    if (!isActive) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape' && typeof callback === 'function') {
        callback();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [callback, isActive]);
}

/**
 * Хук для блокировки скролла body при открытии модального окна
 */
export function useLockBodyScroll(isLocked) {
  useEffect(() => {
    if (!isLocked) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // Вычисляем ширину scrollbar для компенсации сдвига
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isLocked]);
}

/**
 * Хук для объявления изменений для screen readers
 * Используется для live regions (уведомления, статусы)
 */
export function useAnnounce() {
  useEffect(() => {
    // Создаём live region если его ещё нет
    if (!document.getElementById('a11y-announcer')) {
      const announcer = document.createElement('div');
      announcer.id = 'a11y-announcer';
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      announcer.className = 'sr-only';
      document.body.appendChild(announcer);
    }
  }, []);

  return (message) => {
    const announcer = document.getElementById('a11y-announcer');
    if (announcer) {
      announcer.textContent = message;
      // Очистить через 1 секунду
      setTimeout(() => {
        announcer.textContent = '';
      }, 1000);
    }
  };
}

/**
 * Генерирует уникальный ID для связывания label и input
 */
let idCounter = 0;
export function useUniqueId(prefix = 'id') {
  const [id] = useState(() => `${prefix}-${++idCounter}`);
  return id;
}
