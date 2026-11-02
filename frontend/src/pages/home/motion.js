import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * Общие помощники анимаций главной.
 *
 * Правила, на которых всё держится:
 * - «Уменьшить движение» в настройках системы выключает все анимации:
 *   CSS — через @media (prefers-reduced-motion), JS — через useReducedMotion.
 * - Циклы на JS (пример сделки, подсказка в поиске) крутятся, только пока
 *   блок на экране и вкладка открыта, — иначе это пустая работа и батарея.
 * - Без IntersectionObserver или matchMedia (старый браузер, jsdom в тестах)
 *   всё показывается сразу и без движения: контент важнее эффекта.
 */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

function media(query) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

export function prefersReducedMotion() {
  return Boolean(media(REDUCE_QUERY)?.matches);
}

/** Мышь или тачпад: эффекты «за курсором» на телефоне не нужны. */
export function hasFinePointer() {
  return Boolean(media(FINE_POINTER_QUERY)?.matches);
}

/** true, если пользователь просит меньше движения. Следит за сменой настройки на лету. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = media(REDUCE_QUERY);
    if (!query?.addEventListener) return undefined;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Вкладка на экране. В фоне циклы на JS ставятся на паузу. */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * Виден ли элемент сейчас. Возвращает [ref, inView, node].
 * initial — что считать до первого ответа наблюдателя (первый экран виден сразу).
 * Без IntersectionObserver считаем, что виден: лучше лишний раз показать.
 */
export function useInView({ rootMargin = '0px', threshold = 0, initial = false } = {}) {
  const [node, setNode] = useState(null);
  const [inView, setInView] = useState(initial);
  useEffect(() => {
    if (!node) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin, threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, rootMargin, threshold]);
  return [setNode, inView, node];
}

/**
 * Подсветка за курсором в первом экране. Пишет в style секции --mx/--my
 * (где курсор, px), --px/--py (от -1 до 1 — для наклона карточки) и --spot
 * (1 — курсор над секцией). Только мышь и не чаще одного раза за кадр.
 */
export function usePointerGlow(node, enabled) {
  useEffect(() => {
    if (!node || !enabled || !hasFinePointer() || typeof requestAnimationFrame !== 'function') return undefined;
    let frame = 0;
    let last = null;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = last.x - rect.left;
      const y = last.y - rect.top;
      node.style.setProperty('--mx', `${Math.round(x)}px`);
      node.style.setProperty('--my', `${Math.round(y)}px`);
      node.style.setProperty('--px', ((x / rect.width) * 2 - 1).toFixed(3));
      node.style.setProperty('--py', ((y / rect.height) * 2 - 1).toFixed(3));
      node.style.setProperty('--spot', '1');
    };
    const onMove = (event) => {
      if (event.pointerType !== 'mouse') return;
      last = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const reset = () => {
      last = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      node.style.setProperty('--px', '0');
      node.style.setProperty('--py', '0');
      node.style.setProperty('--spot', '0');
    };
    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', reset);
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', reset);
      reset();
    };
  }, [node, enabled]);
}

/*
 * Появление при прокрутке. Блок с data-reveal получает атрибут data-inview,
 * когда до него докрутили, а CSS (home.css) проигрывает анимацию его
 * элементов .home-rv. Атрибут ставится напрямую в DOM, без setState:
 * десятку блоков не нужен лишний рендер страницы, а React чужие атрибуты
 * не трогает. Один наблюдатель на все блоки страницы.
 */
let revealObserver = null;

function getRevealObserver() {
  if (revealObserver || typeof IntersectionObserver !== 'function') return revealObserver;
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-inview', '');
        revealObserver.unobserve(entry.target);
      }
    },
    // Срабатывает, когда верх блока поднялся выше 88% высоты экрана.
    { rootMargin: '0px 0px -12% 0px', threshold: 0 },
  );
  return revealObserver;
}

/** ref-колбэк для блока с data-reveal (React 19 вызывает возвращённую очистку). */
export function revealRef(node) {
  if (!node) return undefined;
  const observer = getRevealObserver();
  if (!observer) {
    node.setAttribute('data-inview', '');
    return undefined;
  }
  observer.observe(node);
  return () => observer.unobserve(node);
}

/** Задержка появления элемента: style={delay(i, 80)} → --d: 160ms для i = 2. */
export function delay(index, step = 80, base = 0) {
  return { '--d': `${base + index * step}ms` };
}

/*
 * Лёгкий 3D-наклон карточки за курсором. Пишет переменные --rx/--ry
 * (угол) и --gx/--gy (где блик) прямо в style карточки; что с ними делать,
 * решает CSS, и только для мыши и без «уменьшить движение».
 */
export function onTiltMove(event) {
  if (event.pointerType !== 'mouse') return;
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  el.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
  el.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
  el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
  el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
}

export function onTiltLeave(event) {
  const el = event.currentTarget;
  for (const name of ['--rx', '--ry', '--gx', '--gy']) el.style.removeProperty(name);
}

/**
 * Плавная перестановка списка (приём FLIP). Когда порядок карточек меняется
 * (пришло новое задание и сдвинуло остальные), каждая карточка с data-flip
 * «едет» со старого места на новое, а не прыгает. Позиции берём из
 * offsetLeft/offsetTop — прокрутка страницы между обновлениями не мешает.
 * Если сетка успела поменять ширину (повернули телефон), анимации нет:
 * старые координаты уже ничего не значат. order — строка с порядком id.
 */
export function useFlip(ref, order) {
  const last = useRef(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const items = new Map();
    for (const el of grid.children) {
      // offsetParent === null — карточка скрыта (display: none), её не трогаем.
      if (el.dataset.flip && el.offsetParent) items.set(el.dataset.flip, { el, x: el.offsetLeft, y: el.offsetTop });
    }
    const prev = last.current;
    last.current = { order, width: grid.clientWidth, items };
    if (!prev || prev.order === order || prev.width !== grid.clientWidth || prefersReducedMotion()) return;
    items.forEach(({ el, x, y }, id) => {
      const was = prev.items.get(id);
      if (!was || typeof el.animate !== 'function') return;
      const dx = was.x - x;
      const dy = was.y - y;
      if (!dx && !dy) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 600,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    });
  });
}
