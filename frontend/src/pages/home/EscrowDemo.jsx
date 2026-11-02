import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconCheck, IconLock, IconPause, IconPlay, IconWallet } from '../../components/icons.jsx';
import { useDocumentVisible, useInView, useReducedMotion } from './motion.js';

/*
 * Иллюстрация в первом экране: как проходит безопасная сделка.
 * Это пример, а не живые данные — на нём нечему устаревать. Карточка сама
 * проигрывает сделку шаг за шагом и переходит к следующему примеру.
 * При «уменьшить движение» — прежняя статичная схема: три шага из пяти.
 */

export const DEALS = [
  { title: 'Ремонт ванной комнаты', amount: 45000 },
  { title: 'Логотип для кофейни', amount: 12000 },
  { title: 'Переезд: грузчики и машина', amount: 8500 },
];

const ROWS = ['Задание опубликовано', 'Исполнитель выбран', 'Бюджет на эскроу', 'Работа принята', 'Выплата исполнителю'];
const LOCK_ROW = 2;

/* Кадры одной сделки: сколько шагов отмечено и сколько держим кадр. */
export const STAGES = [
  { done: 0, ms: 1200 }, // карточка появилась, сумма досчитывается
  { done: 1, ms: 1000 },
  { done: 2, ms: 1000 },
  { done: 3, ms: 2000 }, // деньги на эскроу — главный момент, держим дольше
  { done: 4, ms: 1000 },
  { done: 5, ms: 2600 }, // выплачено
  { done: 5, ms: 450, leaving: true },
];

const STILL = { deal: 0, stage: 3 };

function money(value) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

/** Сумма «досчитывается» от нуля. Пишет прямо в DOM: полсотни кадров не должны перерисовывать карточку. */
function CountUp({ value, animate }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!animate || typeof requestAnimationFrame !== 'function') {
      el.textContent = money(value);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 900);
      el.textContent = money(value * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    el.textContent = money(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, animate]);
  return <span ref={ref} className="tabular-nums" />;
}

export default function EscrowDemo() {
  const reduced = useReducedMotion();
  const pageVisible = useDocumentVisible();
  const [ref, inView] = useInView({ threshold: 0.3 });
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState({ deal: 0, stage: 0 });
  const running = !reduced && !paused && inView && pageVisible;

  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(() => {
      setFrame(({ deal, stage }) =>
        stage + 1 < STAGES.length ? { deal, stage: stage + 1 } : { deal: (deal + 1) % DEALS.length, stage: 0 },
      );
    }, STAGES[frame.stage].ms);
    return () => clearTimeout(timer);
  }, [running, frame]);

  const shown = reduced ? STILL : frame;
  const { done, leaving } = STAGES[shown.stage];
  const deal = DEALS[shown.deal];
  const frozen = done >= 3;
  const paid = done >= 5;

  return (
    <figure ref={ref} aria-label="Пример: как проходит безопасная сделка" className="home-card-tilt relative w-full max-w-sm mx-auto">
      <div className="home-breathe absolute -inset-6 bg-indigo-500/30 blur-3xl rounded-full" aria-hidden="true" />
      <div className="home-float relative rounded-3xl bg-white text-slate-800 shadow-2xl shadow-indigo-950/40 p-6">
        <div key={shown.deal} className={`home-deal ${leaving ? 'is-leaving' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-semibold">Безопасная сделка</p>
              <p className="font-bold text-slate-900 truncate">{deal.title}</p>
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 rounded-full text-xs font-bold px-2.5 py-1 transition-colors duration-500 ${
                paid ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'
              } ${frozen && !paid ? 'home-badge-pulse' : ''}`}
            >
              {paid ? <IconCheck size={12} strokeWidth={3} /> : <IconLock size={12} />}
              {paid ? 'Завершено' : 'Защищено'}
            </span>
          </div>

          <div
            className={`mt-5 rounded-2xl p-4 flex items-end justify-between transition-colors duration-500 ${
              paid ? 'bg-emerald-50' : 'bg-slate-50'
            } ${frozen && !paid ? 'home-amount-frozen' : ''}`}
          >
            <div>
              <p className="text-xs text-slate-400">{paid ? 'Выплачено исполнителю' : frozen ? 'Заморожено' : 'Бюджет задания'}</p>
              <p className={`font-display text-2xl font-bold transition-colors duration-500 ${paid ? 'text-emerald-600' : 'text-slate-900'}`}>
                <CountUp value={deal.amount} animate={!reduced} />
              </p>
            </div>
            {paid ? (
              <span className="home-pop-in w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                <IconCheck size={16} strokeWidth={3} />
              </span>
            ) : frozen ? (
              <IconLock size={26} className="home-lock-in text-emerald-500" />
            ) : (
              <IconWallet size={28} className="text-indigo-500" />
            )}
          </div>

          <ol className="mt-5 space-y-3">
            {ROWS.map((label, i) => {
              const isDone = i < done;
              const isNext = i === done && !reduced;
              return (
                <li key={label} className="flex items-center gap-3 text-sm">
                  <span
                    className={`home-step-dot w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors duration-300 ${
                      isDone ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                    } ${isNext ? 'is-next' : ''}`}
                  >
                    {isDone ? <IconCheck size={13} strokeWidth={3} className="home-check-pop" /> : i + 1}
                  </span>
                  <span className={`transition-colors duration-300 ${isDone ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>{label}</span>
                  {i === LOCK_ROW && isDone && <IconLock size={13} className="home-pop-in ml-auto text-emerald-500" />}
                </li>
              );
            })}
          </ol>
        </div>

        {!reduced && (
          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {DEALS.map((d, i) => (
                <span
                  key={d.title}
                  className={`h-1.5 rounded-full transition-all duration-500 ${i === shown.deal ? 'w-5 bg-indigo-500' : 'w-1.5 bg-slate-200'}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? 'Продолжить пример' : 'Остановить пример'}
              title={paused ? 'Продолжить' : 'Пауза'}
              className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 flex items-center justify-center transition-colors"
            >
              {paused ? <IconPlay size={12} /> : <IconPause size={12} />}
            </button>
          </div>
        )}
      </div>
    </figure>
  );
}
