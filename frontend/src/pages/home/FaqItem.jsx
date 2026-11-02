import React, { useRef } from 'react';
import { prefersReducedMotion } from './motion.js';

const DURATION = 320;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Вопрос FAQ на <details>. Без анимаций (старый браузер, «уменьшить
 * движение») это обычное раскрытие; поиск по странице (Ctrl+F) тоже
 * находит текст ответа. С анимациями высота меняется плавно (Web Animations
 * API), а не рывком, — и повторный клик посреди анимации её разворачивает.
 */
export default function FaqItem({ q, a, className = '', style }) {
  const detailsRef = useRef(null);
  const answerRef = useRef(null);
  const animation = useRef(null);

  const onSummaryClick = (event) => {
    const details = detailsRef.current;
    if (!details || typeof details.animate !== 'function' || prefersReducedMotion()) return;
    event.preventDefault();

    const summary = event.currentTarget;
    const from = details.offsetHeight;
    const opening = !details.open || details.classList.contains('is-closing');
    animation.current?.cancel();
    details.style.overflow = 'hidden';

    let to;
    if (opening) {
      details.classList.remove('is-closing');
      details.open = true;
      details.style.height = 'auto';
      to = details.offsetHeight;
      answerRef.current?.animate(
        { opacity: [0, 1], transform: ['translateY(-6px)', 'none'] },
        { duration: DURATION + 80, easing: EASING },
      );
    } else {
      // Плюсик поворачивается обратно сразу, а не после того, как ответ свернётся.
      details.classList.add('is-closing');
      to = summary.offsetHeight;
    }
    details.style.height = `${from}px`;

    const current = details.animate({ height: [`${from}px`, `${to}px`] }, { duration: DURATION, easing: EASING });
    animation.current = current;
    current.onfinish = () => {
      if (!opening) details.open = false;
      details.classList.remove('is-closing');
      details.style.height = '';
      details.style.overflow = '';
      animation.current = null;
    };
  };

  return (
    <details ref={detailsRef} className={`home-faq px-5 sm:px-6 ${className}`} style={style}>
      <summary
        onClick={onSummaryClick}
        className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-bold text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden"
      >
        {q}
        <span
          className="home-faq-plus w-7 h-7 shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 transition-transform duration-300 text-lg leading-none"
          aria-hidden="true"
        >
          +
        </span>
      </summary>
      <p ref={answerRef} className="pb-5 -mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {a}
      </p>
    </details>
  );
}
