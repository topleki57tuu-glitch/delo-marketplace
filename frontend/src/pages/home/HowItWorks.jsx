import React, { useLayoutEffect, useRef, useState } from 'react';
import SectionTitle from './SectionTitle.jsx';
import { delay, revealRef } from './motion.js';

const STEPS = {
  customer: [
    { title: 'Опишите задачу', text: 'Что сделать, к какому сроку и за какой бюджет. AI-помощник поможет составить понятное ТЗ.' },
    { title: 'Выберите исполнителя', text: 'Специалисты откликаются со своей ценой. Сравните отзывы, рейтинг и портфолио.' },
    { title: 'Оплатите через эскроу', text: 'Бюджет резервируется на вашем балансе — исполнитель видит, что заказ оплачен.' },
    { title: 'Примите работу', text: 'Деньги переходят исполнителю только после вашего подтверждения.' },
  ],
  specialist: [
    { title: 'Заполните профиль', text: 'Навыки, портфолио, город. Пройдите верификацию — проверенным доверяют чаще.' },
    { title: 'Откликайтесь на задания', text: 'Предлагайте цену и сроки. Новые заказы — в ленте, на карте и в Telegram-боте.' },
    { title: 'Работайте спокойно', text: 'Оплата зарезервирована заранее: заказчик не сможет «пропасть» после сдачи работы.' },
    { title: 'Получайте деньги', text: 'После приёмки сумма зачисляется на баланс, вывод — по заявке из профиля.' },
  ],
};

const AUDIENCES = [
  ['customer', 'Заказчикам'],
  ['specialist', 'Исполнителям'],
];

/**
 * «Четыре шага до результата». Плашка переключателя скользит к выбранной
 * вкладке; карточки при каждом показе проходят «по цепочке»: полоска сверху
 * заполняется и номер шага загорается — 01, потом 02 и так далее.
 */
export default function HowItWorks() {
  const [audience, setAudience] = useState('customer');
  const tabs = useRef({});
  const tablist = useRef(null);
  const [pill, setPill] = useState(null);

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabs.current[audience];
      if (!tab?.offsetWidth) return;
      const x = tab.offsetLeft;
      const w = tab.offsetWidth;
      setPill((p) => (p && p.x === x && p.w === w ? p : { x, w }));
    };
    measure();
    // Ширина вкладок меняется, когда догружается шрифт или меняется размер окна.
    if (typeof ResizeObserver !== 'function' || !tablist.current) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(tablist.current);
    return () => observer.disconnect();
  }, [audience]);

  return (
    <section id="how" className="scroll-mt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div data-reveal ref={revealRef}>
        <SectionTitle center className="home-rv" eyebrow="Как это работает" title="Четыре шага до результата" />
        <div className="home-rv mt-8 flex justify-center" style={delay(1, 120)}>
          <div ref={tablist} role="tablist" className="relative inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {pill && <span className="home-tab-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} aria-hidden="true" />}
            {AUDIENCES.map(([id, label]) => {
              const active = audience === id;
              const tone = active ? 'text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200';
              // Пока плашка не измерена (первый кадр), фон рисует сама вкладка.
              const fallback = active && !pill ? 'bg-white dark:bg-slate-700 shadow-sm' : '';
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabs.current[id] = el;
                  }}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setAudience(id)}
                  className={`relative px-5 py-2 rounded-lg text-sm font-bold transition-colors ${tone} ${fallback}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* key: при смене вкладки список монтируется заново и цепочка проигрывается снова. */}
      <ol key={audience} data-reveal ref={revealRef} className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STEPS[audience].map((s, i) => (
          <li
            key={s.title}
            className="home-rv relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/70 p-6 bg-white dark:bg-slate-800/60"
            style={{ ...delay(i, 110), '--i': i }}
          >
            <span className="home-step-bar" aria-hidden="true" />
            <span className="home-step-num font-display text-4xl font-bold">0{i + 1}</span>
            <p className="mt-3 font-bold text-slate-900 dark:text-white">{s.title}</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
