import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, useRef } from 'react';
import { render } from '@testing-library/react';

/**
 * Помощники анимаций главной: один наблюдатель на все блоки «появления»,
 * наклон карточек только для мыши.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('revealRef', () => {
  it('ставит data-inview, когда блок показался, и больше за ним не следит', async () => {
    const observers = [];
    class FakeObserver {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.unobserve = vi.fn();
        this.disconnect = vi.fn();
        observers.push(this);
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { revealRef } = await import('../home/motion.js');

    const block = document.createElement('div');
    const cleanup = revealRef(block);
    const [observer] = observers;
    expect(observer.observe).toHaveBeenCalledWith(block);

    observer.callback([{ target: block, isIntersecting: false }]);
    expect(block.hasAttribute('data-inview')).toBe(false);
    observer.callback([{ target: block, isIntersecting: true }]);
    expect(block.hasAttribute('data-inview')).toBe(true);
    expect(observer.unobserve).toHaveBeenCalledWith(block);

    revealRef(document.createElement('div'));
    expect(observers).toHaveLength(1); // один наблюдатель на всю страницу

    cleanup();
    expect(observer.unobserve).toHaveBeenCalledTimes(2);
  });

  it('без IntersectionObserver показывает блок сразу', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { revealRef } = await import('../home/motion.js');
    const block = document.createElement('div');
    revealRef(block);
    expect(block.hasAttribute('data-inview')).toBe(true);
  });
});

describe('onTiltMove / onTiltLeave', () => {
  it('наклоняет карточку только за мышью и сбрасывает наклон, когда курсор ушёл', async () => {
    const { onTiltLeave, onTiltMove } = await import('../home/motion.js');
    const card = document.createElement('a');
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });

    onTiltMove({ pointerType: 'touch', currentTarget: card, clientX: 200, clientY: 0 });
    expect(card.style.getPropertyValue('--ry')).toBe('');

    onTiltMove({ pointerType: 'mouse', currentTarget: card, clientX: 200, clientY: 0 });
    expect(card.style.getPropertyValue('--ry')).toBe('4.50deg');
    expect(card.style.getPropertyValue('--rx')).toBe('3.50deg');
    expect(card.style.getPropertyValue('--gx')).toBe('100.0%');

    onTiltLeave({ currentTarget: card });
    expect(card.style.getPropertyValue('--ry')).toBe('');
    expect(card.style.getPropertyValue('--gx')).toBe('');
  });
});

describe('useFlip', () => {
  // В jsdom нет раскладки: подставляем координаты — карточки в ряд по 300px.
  const props = ['offsetParent', 'offsetLeft', 'offsetTop'];
  const saved = props.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
  const fakeLayout = () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { return [...this.parentNode.children].indexOf(this) * 300; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return 0; } });
  };
  afterEach(() => {
    saved.forEach(([name, descriptor]) => Object.defineProperty(HTMLElement.prototype, name, descriptor));
    delete Element.prototype.animate;
  });

  async function setup() {
    const { useFlip } = await import('../home/motion.js');
    function List({ ids }) {
      const ref = useRef(null);
      useFlip(ref, ids.join());
      return createElement('div', { ref }, ids.map((id) => createElement('div', { key: id, 'data-flip': id })));
    }
    return List;
  }

  it('сдвинутые карточки плавно едут на новое место, новая — нет', async () => {
    fakeLayout();
    const animate = vi.fn();
    Element.prototype.animate = animate;
    const List = await setup();

    const { rerender } = render(createElement(List, { ids: ['a', 'b'] }));
    expect(animate).not.toHaveBeenCalled();

    rerender(createElement(List, { ids: ['new', 'a', 'b'] }));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0][0][0]).toEqual({ transform: 'translate(-300px, 0px)' });
    expect(animate.mock.instances.map((el) => el.dataset.flip)).toEqual(['a', 'b']);

    rerender(createElement(List, { ids: ['new', 'a', 'b'] })); // порядок тот же — тишина
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('при «уменьшить движение» карточки просто встают на место', async () => {
    fakeLayout();
    const animate = vi.fn();
    Element.prototype.animate = animate;
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const List = await setup();

    const { rerender } = render(createElement(List, { ids: ['a', 'b'] }));
    rerender(createElement(List, { ids: ['new', 'a', 'b'] }));
    expect(animate).not.toHaveBeenCalled();
  });
});
