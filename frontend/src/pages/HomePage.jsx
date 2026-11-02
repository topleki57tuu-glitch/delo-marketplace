import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconArrowRight, IconCatBeauty, IconCatCleaning, IconCatDelivery, IconCatDesign, IconCatDevelopment,
  IconCatPhotoVideo, IconCatRepairs, IconCatTutoring, IconCheck, IconJustice, IconLock, IconMessages,
  IconShieldCheck, IconSparkles, IconStar, IconUsers, IconWallet,
} from '../components/icons.jsx';
import EscrowDemo from './home/EscrowDemo.jsx';
import FaqItem from './home/FaqItem.jsx';
import FreshTasks from './home/FreshTasks.jsx';
import HeroSearch from './home/HeroSearch.jsx';
import HowItWorks from './home/HowItWorks.jsx';
import SectionTitle from './home/SectionTitle.jsx';
import {
  delay, onTiltLeave, onTiltMove, revealRef, useDocumentVisible, useInView, usePointerGlow, useReducedMotion,
} from './home/motion.js';
import './home/home.css';

/*
 * Главная. Тексты — только про то, что сервис действительно делает:
 * никаких «тысяч исполнителей» и «№1» — непроверяемые заявления в рекламе
 * запрещены (38-ФЗ «О рекламе», ст. 5) и подрывают доверие сильнее, чем
 * их отсутствие. Живые данные — блок «Свежие задания» из API.
 *
 * Анимации — в home/: CSS в home.css, помощники в motion.js. Блоки с
 * data-reveal проявляются при прокрутке (элементы .home-rv внутри),
 * задержку задаёт delay(). При «уменьшить движение» страница статична.
 */

const CATEGORIES = [
  { id: 'repairs', label: 'Ремонт и строительство', hint: 'Мастер на час, отделка, сантехника', icon: IconCatRepairs },
  { id: 'cleaning', label: 'Уборка и клининг', hint: 'Квартиры, офисы, после ремонта', icon: IconCatCleaning },
  { id: 'development', label: 'Разработка и IT', hint: 'Сайты, боты, приложения', icon: IconCatDevelopment },
  { id: 'design', label: 'Дизайн и графика', hint: 'Логотипы, баннеры, презентации', icon: IconCatDesign },
  { id: 'delivery', label: 'Курьеры и доставка', hint: 'Документы, посылки, покупки', icon: IconCatDelivery },
  { id: 'photo_video', label: 'Фото и видео', hint: 'Съёмка, монтаж, обработка', icon: IconCatPhotoVideo },
  { id: 'tutoring', label: 'Репетиторы и обучение', hint: 'Школа, языки, подготовка к экзаменам', icon: IconCatTutoring },
  { id: 'beauty', label: 'Красота и здоровье', hint: 'Маникюр, макияж, массаж', icon: IconCatBeauty },
];

const QUICK = ['Собрать шкаф', 'Уборка квартиры', 'Сайт-визитка', 'Логотип', 'Курьер на день'];

/* motion — своя микроанимация иконки при наведении (home.css). */
const TRUST = [
  { icon: IconLock, motion: 'home-trust-lock', title: 'Эскроу на каждом заказе', text: 'Деньги заморожены до приёмки' },
  { icon: IconShieldCheck, motion: 'home-trust-shield', title: 'Проверка исполнителей', text: 'Паспорт или статус самозанятого' },
  { icon: IconJustice, motion: 'home-trust-scale', title: 'Арбитраж споров', text: 'Решение по переписке и файлам' },
  { icon: IconMessages, motion: 'home-trust-chat', title: 'Чат внутри сделки', text: 'Файлы, фото, история договорённостей' },
];

const SAFE_DEAL = [
  ['Оплата при выборе исполнителя', 'Бюджет замораживается на эскроу — исполнитель видит, что заказ оплачен.'],
  ['Выплата после приёмки', 'Исполнитель получает деньги только после вашего подтверждения.'],
  ['Спор вместо отмены', 'Если что-то пошло не так, арбитр решит, кому достанутся средства.'],
  ['Автоматический возврат', 'Если исполнитель откажется от заказа, деньги сразу вернутся заказчику.'],
];

const FOR_SPECIALISTS = [
  [IconWallet, 'Оплата зарезервирована до начала работы'],
  [IconStar, 'Рейтинг и отзывы от реальных заказчиков'],
  [IconSparkles, 'Новые заказы в ленте, на карте и в Telegram'],
];

const FAQ = [
  {
    q: 'Как работает безопасная сделка?',
    a: 'Когда вы выбираете исполнителя, бюджет задания резервируется на вашем балансе. Исполнитель получает деньги только после того, как вы подтвердите выполнение или арбитр решит спор в его пользу. До этого потратить их нельзя, но они остаются вашими.',
  },
  {
    q: 'Можно ли отменить заказ?',
    a: 'Пока исполнитель не выбран — в любой момент. После выбора заказ в одностороннем порядке не отменяется: если что-то идёт не так, откройте спор. Если исполнитель сам откажется от заказа, замороженные деньги вернутся вам автоматически.',
  },
  {
    q: 'Что делать, если работа выполнена плохо?',
    a: 'Откройте спор на странице заказа. Арбитр изучит переписку, файлы и условия задания и решит, кому достанутся замороженные средства — исполнителю или вам.',
  },
  {
    q: 'Как пополнить баланс?',
    a: 'В профиле нажмите «Пополнить» и оплатите через ЮMoney. Деньги зачисляются после подтверждения платежа платёжной системой.',
  },
  {
    q: 'Как исполнителю вывести деньги?',
    a: 'Заработанное поступает на баланс. Вывод оформляется заявкой из профиля, заявки проверяет модератор.',
  },
  {
    q: 'Как проверяются исполнители?',
    a: 'Исполнитель может пройти верификацию: загрузить паспорт или подтвердить статус самозанятого. Проверенные получают зелёный значок в профиле и в откликах.',
  },
];

export default function HomePage({ user, onOpenAuth }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const pageVisible = useDocumentVisible();
  const [heroRef, heroInView, heroNode] = useInView({ initial: true });
  usePointerGlow(heroNode, !reduced);
  // Первый экран ушёл за край или вкладка в фоне — его анимации на паузе.
  const heroLive = heroInView && pageVisible;

  const startTask = (title = '') => {
    const t = title.trim();
    const target = t ? `/create-task?title=${encodeURIComponent(t)}` : '/create-task';
    if (user) navigate(target);
    else onOpenAuth('register');
  };

  return (
    <div className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
      {/* ---------- Hero ---------- */}
      <section ref={heroRef} data-paused={heroLive ? undefined : ''} className="home-hero relative overflow-hidden bg-slate-950 text-white">
        <div
          className="home-drift absolute -inset-[10%] opacity-90"
          style={{
            background:
              'radial-gradient(60% 60% at 15% 10%, rgba(99,102,241,.45), transparent 70%), radial-gradient(50% 50% at 90% 30%, rgba(14,165,233,.22), transparent 70%), radial-gradient(60% 50% at 60% 110%, rgba(245,158,11,.16), transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px' }}
          aria-hidden="true"
        />
        {/* Сетка «загорается» вокруг курсора — только мышь, см. usePointerGlow. */}
        <div className="home-spot-glow" aria-hidden="true" />
        <div className="home-spotlight" aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-16 sm:pt-20 sm:pb-24 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center">
          <div className="text-center lg:text-left">
            <span
              className="home-in inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs sm:text-sm font-semibold text-indigo-100"
              style={delay(0)}
            >
              <IconLock size={14} className="text-emerald-400" /> Безопасная сделка на каждом заказе
            </span>
            <h1 className="home-in mt-6 font-display text-[2.1rem] sm:text-5xl lg:text-[3.25rem] font-bold leading-[1.1] tracking-tight" style={delay(1, 90)}>
              Найдите специалиста для{' '}
              {/* Блоком — чтобы маркер лёг ровно под словами. Уже 360px фраза
                  не влезает в строку: там обычный перенос и без маркера. */}
              <span className="relative min-[360px]:inline-block">
                <span className="home-shimmer-text bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">любой задачи</span>
                <svg className="home-hl-mark hidden min-[360px]:block" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  <path d="M3 9 C 70 3, 170 2, 297 7" pathLength="1" />
                </svg>
              </span>
            </h1>
            <p className="home-in mt-5 text-base sm:text-lg text-slate-300 max-w-xl mx-auto lg:mx-0" style={delay(2, 90)}>
              Опишите, что нужно сделать, — исполнители сами предложат цену и сроки. Оплата
              резервируется и переходит исполнителю только после вашего подтверждения.
            </p>

            <HeroSearch onSubmit={startTask} active={heroLive} className="home-in mt-8" style={delay(3, 90)} />

            <div className="mt-4 flex flex-wrap justify-center lg:justify-start gap-2">
              {QUICK.map((q, i) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => startTask(q)}
                  style={delay(i, 45, 380)}
                  className="home-in rounded-full border border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/30 motion-safe:hover:-translate-y-0.5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition"
                >
                  {q}
                </button>
              ))}
            </div>

            <p className="home-in mt-8 text-sm text-slate-400" style={delay(0, 0, 620)}>
              Вы исполнитель?{' '}
              <Link to="/tasks" className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                Смотреть заказы
              </Link>
            </p>
          </div>
          <div className="home-in home-in-card hidden md:block" style={delay(0, 0, 250)}>
            <EscrowDemo />
          </div>
        </div>
      </section>

      {/* ---------- Ценности ---------- */}
      <section className="border-b border-slate-100 dark:border-slate-800">
        {/* До 360px — в одну колонку: в две слово «исполнителей» не помещалось
            в ширину колонки и сдвигало страницу вбок. */}
        <div
          data-reveal
          ref={revealRef}
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {TRUST.map(({ icon: I, motion, title, text }, i) => (
            <div key={title} className={`home-rv ${motion} flex items-start gap-3`} style={delay(i, 90)}>
              <span className="home-trust-ic w-10 h-10 shrink-0 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                <I size={20} />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-sm text-slate-900 dark:text-white">{title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Категории ---------- */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
        <div data-reveal ref={revealRef} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <SectionTitle className="home-rv" eyebrow="Категории" title="Чем можем помочь" text="От бытовых дел до digital-проектов — выберите направление." />
          <Link
            to="/tasks"
            style={delay(1, 100)}
            className="home-rv inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:gap-2.5 transition-all"
          >
            Все категории <IconArrowRight size={16} />
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {CATEGORIES.map(({ id, label, hint, icon: I }, i) => (
            <Link
              key={id}
              ref={revealRef}
              data-reveal
              to={`/tasks?category=${id}`}
              style={delay(i % 4, 70)}
              onPointerMove={onTiltMove}
              onPointerLeave={onTiltLeave}
              className="home-rv home-cat group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-800/60 p-4 sm:p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover"
            >
              <span className="home-cat-ic w-11 h-11 rounded-xl bg-slate-50 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center transition-colors">
                <I size={22} />
              </span>
              <p className="mt-4 font-bold text-sm sm:text-base text-slate-900 dark:text-white">{label}</p>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">{hint}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Свежие задания (живые данные) ---------- */}
      <FreshTasks />

      {/* ---------- Как это работает ---------- */}
      <HowItWorks />

      {/* ---------- Безопасная сделка ---------- */}
      <section id="safe-deal" className="scroll-mt-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto rounded-[2rem] bg-slate-950 text-white overflow-hidden relative">
          <div
            className="home-drift-slow absolute -inset-[10%]"
            style={{ background: 'radial-gradient(45% 70% at 95% 5%, rgba(99,102,241,.35), transparent 70%)' }}
            aria-hidden="true"
          />
          <div className="relative grid lg:grid-cols-2 gap-10 p-8 sm:p-12 lg:p-16">
            <div data-reveal ref={revealRef}>
              <p className="home-rv text-xs font-bold uppercase tracking-[0.16em] text-indigo-300">Безопасная сделка</p>
              <h2 className="home-rv mt-2 text-2xl sm:text-[2rem] font-extrabold tracking-tight" style={delay(1)}>
                Деньги защищены на каждом этапе
              </h2>
              <p className="home-rv mt-4 text-slate-300" style={delay(2)}>
                Сервис держит оплату у себя, пока стороны не выполнят договорённости. Ни заказчик, ни
                исполнитель не могут забрать деньги в одностороннем порядке.
              </p>
              <button
                type="button"
                onClick={() => startTask('')}
                style={delay(3)}
                className="home-rv mt-8 inline-flex items-center gap-2 rounded-xl bg-white text-slate-950 font-bold px-6 py-3 hover:bg-indigo-50 transition motion-safe:active:scale-[0.97]"
              >
                Создать задание <IconArrowRight size={16} />
              </button>
            </div>
            <ul data-reveal ref={revealRef} className="grid gap-3">
              {SAFE_DEAL.map(([t, d], i) => (
                <li key={t} className="home-rv home-rv-side flex gap-4 rounded-2xl bg-white/5 border border-white/10 p-4" style={delay(i, 140, 100)}>
                  <span className="home-check w-8 h-8 shrink-0 rounded-lg bg-emerald-400/15 text-emerald-300 flex items-center justify-center">
                    <IconCheck size={16} strokeWidth={3} />
                  </span>
                  <div>
                    <p className="font-bold">{t}</p>
                    <p className="text-sm text-slate-400 mt-0.5">{d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- Исполнителям ---------- */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
        <div
          data-reveal
          ref={revealRef}
          className="relative overflow-hidden grid lg:grid-cols-[1fr_auto] gap-8 items-center rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-indigo-50 via-white to-amber-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 p-8 sm:p-12"
        >
          <span className="home-blob home-blob-indigo" aria-hidden="true" />
          <span className="home-blob home-blob-amber" aria-hidden="true" />
          <div className="relative">
            <p className="home-rv text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">Для специалистов</p>
            <h2 className="home-rv mt-2 text-2xl sm:text-[2rem] font-extrabold tracking-tight text-slate-900 dark:text-white" style={delay(1)}>
              Зарабатывайте на своих навыках
            </h2>
            <ul className="mt-5 grid sm:grid-cols-3 gap-4 text-sm">
              {FOR_SPECIALISTS.map(([I, t], i) => (
                <li key={t} className="home-rv flex items-start gap-2.5 text-slate-600 dark:text-slate-300" style={delay(i, 110, 220)}>
                  <I size={18} className="mt-0.5 text-indigo-600 dark:text-indigo-400" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex flex-col sm:flex-row lg:flex-col gap-3">
            {!user && (
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                style={delay(0, 0, 450)}
                className="home-rv rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3 transition motion-safe:active:scale-[0.97]"
              >
                Стать исполнителем
              </button>
            )}
            <Link
              to="/tasks"
              style={delay(0, 0, 530)}
              className="home-rv rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold px-6 py-3 text-center hover:border-indigo-400 transition motion-safe:active:scale-[0.97]"
            >
              Смотреть заказы
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="scroll-mt-20 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div data-reveal ref={revealRef}>
          <SectionTitle center className="home-rv" eyebrow="Вопросы и ответы" title="Частые вопросы" />
        </div>
        <div
          data-reveal
          ref={revealRef}
          className="mt-8 divide-y divide-slate-200 dark:divide-slate-700 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60"
        >
          {FAQ.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} className="home-rv" style={delay(i, 70)} />
          ))}
        </div>
      </section>

      {/* ---------- Финальный призыв ---------- */}
      <section className="px-4 sm:px-6 lg:px-8 pb-20">
        <div
          data-reveal
          ref={revealRef}
          className="home-rv home-rv-zoom max-w-7xl mx-auto rounded-[2rem] bg-indigo-600 text-white text-center px-6 py-14 sm:py-16 relative overflow-hidden"
        >
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(40% 80% at 10% 0%, rgba(255,255,255,.18), transparent 70%), radial-gradient(40% 80% at 90% 100%, rgba(245,158,11,.25), transparent 70%)' }}
            aria-hidden="true"
          />
          <span className="home-orb home-orb-a" aria-hidden="true" />
          <span className="home-orb home-orb-b" aria-hidden="true" />
          <div className="relative">
            <h2 className="home-rv text-2xl sm:text-4xl font-extrabold tracking-tight" style={delay(0, 0, 150)}>
              Опишите задачу — остальное возьмём на себя
            </h2>
            <p className="home-rv mt-3 text-indigo-100 max-w-xl mx-auto" style={delay(0, 0, 250)}>
              Исполнители сами предложат цену и сроки, а оплата будет под защитой.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={() => startTask('')}
                style={delay(0, 0, 350)}
                className="home-rv home-shine home-shine-indigo rounded-xl bg-white text-indigo-700 font-bold px-7 py-3.5 hover:bg-indigo-50 transition motion-safe:active:scale-[0.97]"
              >
                Создать задание
              </button>
              <Link
                to="/specialists"
                style={delay(0, 0, 430)}
                className="home-rv rounded-xl border border-white/30 text-white font-bold px-7 py-3.5 hover:bg-white/10 transition motion-safe:active:scale-[0.97] inline-flex items-center justify-center gap-2"
              >
                <IconUsers size={18} /> Найти специалиста
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
