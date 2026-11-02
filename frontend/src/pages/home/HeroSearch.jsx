import React, { useEffect, useRef, useState } from 'react';
import { IconSearch } from '../../components/icons.jsx';
import { useReducedMotion } from './motion.js';

const PREFIX = 'Например, ';

/* Короткие: на телефоне поле узкое, длинный пример обрезался бы. */
export const SEARCH_EXAMPLES = [
  'собрать шкаф',
  'нарисовать логотип',
  'убрать квартиру',
  'починить кран',
  'сделать сайт-визитку',
  'привезти документы',
  'подготовить к ЕГЭ',
];

const TYPE_MIN_MS = 55; // скорость набора — случайная в этих пределах, как у человека
const TYPE_MAX_MS = 95;
const ERASE_MS = 28;
const HOLD_MS = 2200;
const GAP_MS = 350;

/**
 * Подсказка в поле, которая сама «печатает» примеры задач.
 * Пока поле в фокусе, заполнено, не видно на экране или анимации
 * выключены — стоит целый пример, без движения.
 */
export function useTypingPlaceholder(active, examples = SEARCH_EXAMPLES) {
  const typing = useRef({ index: 0, length: examples[0].length, phase: 'hold' });
  const [text, setText] = useState(PREFIX + examples[0]);

  useEffect(() => {
    const s = typing.current;
    if (!active) {
      // Недопечатанное «Например, почи» в покое выглядит как сбой — показываем пример целиком.
      s.length = examples[s.index].length;
      s.phase = 'hold';
      setText(PREFIX + examples[s.index]);
      return undefined;
    }

    let timer;
    const tick = () => {
      let wait;
      if (s.phase === 'hold') {
        s.phase = 'erase';
        wait = ERASE_MS;
      } else if (s.phase === 'erase') {
        if (s.length > 0) {
          s.length -= 1;
          wait = ERASE_MS;
        } else {
          s.phase = 'type';
          s.index = (s.index + 1) % examples.length;
          wait = GAP_MS;
        }
      } else if (s.length < examples[s.index].length) {
        s.length += 1;
        wait = TYPE_MIN_MS + Math.random() * (TYPE_MAX_MS - TYPE_MIN_MS);
      } else {
        s.phase = 'hold';
        wait = HOLD_MS;
      }
      setText(PREFIX + examples[s.index].slice(0, s.length));
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, s.phase === 'hold' ? HOLD_MS : TYPE_MAX_MS);
    return () => clearTimeout(timer);
  }, [active, examples]);

  return text;
}

/**
 * Поиск в первом экране. Своё состояние — чтобы каждая буква подсказки
 * перерисовывала только форму, а не всю главную.
 */
export default function HeroSearch({ onSubmit, active = true, className = '', style }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const placeholder = useTypingPlaceholder(active && !reduced && !focused && query === '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(query);
      }}
      style={style}
      className={`flex flex-col sm:flex-row gap-2 rounded-2xl bg-white p-2 shadow-2xl shadow-indigo-950/40 max-w-xl mx-auto lg:mx-0 ring-amber-300/40 focus-within:ring-4 transition-shadow duration-300 ${className}`}
    >
      <label className="flex-1 flex items-center gap-2 px-3">
        <IconSearch size={18} className="text-slate-400" />
        <span className="sr-only">Что нужно сделать?</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="w-full py-3 bg-transparent text-slate-900 placeholder:text-slate-400 outline-none text-sm sm:text-base"
        />
      </label>
      <button
        type="submit"
        className="home-shine rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-6 py-3 transition motion-safe:active:scale-[0.97]"
      >
        Создать задание
      </button>
    </form>
  );
}
