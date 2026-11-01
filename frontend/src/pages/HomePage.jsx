import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconAdmin, IconArrowRight, IconCatBeauty, IconCatCleaning, IconCatDelivery, IconCatDesign,
  IconCatDevelopment, IconCatPhotoVideo, IconCatRepairs, IconCatTutoring, IconCheck, IconGlobe,
  IconJustice, IconLock, IconMessages, IconPin, IconSearch, IconSparkles, IconStar, IconUsers, IconWallet,
} from '../components/icons.jsx';
import { taskCategoryLabel } from '../constants/categories.js';

/*
 * Главная. Тексты — только про то, что сервис действительно делает:
 * никаких «тысяч исполнителей» и «№1» — непроверяемые заявления в рекламе
 * запрещены (38-ФЗ «О рекламе», ст. 5) и подрывают доверие сильнее, чем
 * их отсутствие. Живые данные — блок «Свежие задания» из API.
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

const STEPS = {
  customer: [
    { title: 'Опишите задачу', text: 'Что сделать, к какому сроку и за какой бюджет. AI-помощник поможет составить понятное ТЗ.' },
    { title: 'Выберите исполнителя', text: 'Специалисты откликаются со своей ценой. Сравните отзывы, рейтинг и портфолио.' },
    { title: 'Оплатите через эскроу', text: 'Бюджет замораживается на защищённом счёте — исполнитель видит, что заказ оплачен.' },
    { title: 'Примите работу', text: 'Деньги переходят исполнителю только после вашего подтверждения.' },
  ],
  specialist: [
    { title: 'Заполните профиль', text: 'Навыки, портфолио, город. Пройдите верификацию — проверенным доверяют чаще.' },
    { title: 'Откликайтесь на задания', text: 'Предлагайте цену и сроки. Новые заказы — в ленте, на карте и в Telegram-боте.' },
    { title: 'Работайте спокойно', text: 'Оплата зарезервирована заранее: заказчик не сможет «пропасть» после сдачи работы.' },
    { title: 'Получайте деньги', text: 'После приёмки сумма зачисляется на баланс, вывод — по заявке из профиля.' },
  ],
};

const FAQ = [
  {
    q: 'Как работает безопасная сделка?',
    a: 'Когда вы выбираете исполнителя, бюджет задания замораживается на эскроу-счёте. Исполнитель получает деньги только после того, как вы подтвердите выполнение. До этого момента средства не принадлежат ни одной из сторон.',
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

function formatBudget(v) {
  return v ? `${Number(v).toLocaleString('ru-RU')} ₽` : 'Договорная';
}

function useLatestTasks() {
  const [state, setState] = useState({ loading: true, tasks: [] });
  useEffect(() => {
    let alive = true;
    fetch('/tasks/?status_filter=open&page=1&per_page=6')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list = Array.isArray(d) ? d : d?.tasks || [];
        setState({ loading: false, tasks: list.filter((t) => t.status === 'open').slice(0, 6) });
      })
      .catch(() => alive && setState({ loading: false, tasks: [] }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function SectionTitle({ eyebrow, title, text, center = false }) {
  return (
    <div className={center ? 'text-center max-w-2xl mx-auto' : 'max-w-2xl'}>
      {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">{eyebrow}</p>}
      <h2 className="mt-2 text-2xl sm:text-[2rem] font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h2>
      {text && <p className="mt-3 text-slate-500 dark:text-slate-400">{text}</p>}
    </div>
  );
}

/* Иллюстрация в hero: путь денег в безопасной сделке. Статичная схема,
   а не «живые» цифры — на ней нечему устаревать. */
function EscrowCard() {
  const rows = [
    { label: 'Задание опубликовано', done: true },
    { label: 'Исполнитель выбран', done: true },
    { label: 'Бюджет на эскроу', done: true, lock: true },
    { label: 'Работа принята', done: false },
    { label: 'Выплата исполнителю', done: false },
  ];
  return (
    <div className="relative w-full max-w-sm mx-auto">
      <div className="absolute -inset-6 bg-indigo-500/30 blur-3xl rounded-full" aria-hidden="true" />
      <div className="relative rounded-3xl bg-white text-slate-800 shadow-2xl shadow-indigo-950/40 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-semibold">Безопасная сделка</p>
            <p className="font-bold text-slate-900">Ремонт ванной комнаты</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1">
            <IconLock size={12} /> Защищено
          </span>
        </div>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4 flex items-end justify-between">
          <div>
            <p className="text-xs text-slate-400">Заморожено</p>
            <p className="font-display text-2xl font-bold text-slate-900">45 000 ₽</p>
          </div>
          <IconWallet size={28} className="text-indigo-500" />
        </div>
        <ol className="mt-5 space-y-3">
          {rows.map((r, i) => (
            <li key={r.label} className="flex items-center gap-3 text-sm">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  r.done ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {r.done ? <IconCheck size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span className={r.done ? 'font-semibold text-slate-800' : 'text-slate-400'}>{r.label}</span>
              {r.lock && <IconLock size={13} className="ml-auto text-emerald-500" />}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function HomePage({ user, onOpenAuth }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState('customer');
  const latest = useLatestTasks();

  const startTask = (title) => {
    const t = (title ?? query).trim();
    const target = t ? `/create-task?title=${encodeURIComponent(t)}` : '/create-task';
    if (user) navigate(target);
    else onOpenAuth('register');
  };

  return (
    <div className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div
          className="absolute inset-0 opacity-90"
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
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-16 sm:pt-20 sm:pb-24 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center">
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs sm:text-sm font-semibold text-indigo-100">
              <IconLock size={14} className="text-emerald-400" /> Безопасная сделка на каждом заказе
            </span>
            <h1 className="mt-6 font-display text-[2.1rem] sm:text-5xl lg:text-[3.25rem] font-bold leading-[1.1] tracking-tight">
              Найдите специалиста для{' '}
              <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">любой задачи</span>
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-300 max-w-xl mx-auto lg:mx-0">
              Опишите, что нужно сделать, — исполнители сами предложат цену и сроки. Деньги ждут на
              эскроу-счёте и переходят исполнителю только после вашего подтверждения.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                startTask();
              }}
              className="mt-8 flex flex-col sm:flex-row gap-2 rounded-2xl bg-white p-2 shadow-2xl shadow-indigo-950/40 max-w-xl mx-auto lg:mx-0"
            >
              <label className="flex-1 flex items-center gap-2 px-3">
                <IconSearch size={18} className="text-slate-400" />
                <span className="sr-only">Что нужно сделать?</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Например, собрать шкаф"
                  className="w-full py-3 bg-transparent text-slate-900 placeholder:text-slate-400 outline-none text-sm sm:text-base"
                />
              </label>
              <button type="submit" className="rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-6 py-3 transition-colors">
                Создать задание
              </button>
            </form>

            <div className="mt-4 flex flex-wrap justify-center lg:justify-start gap-2">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => startTask(q)}
                  className="rounded-full border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>

            <p className="mt-8 text-sm text-slate-400">
              Вы исполнитель?{' '}
              <Link to="/tasks" className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                Смотреть заказы
              </Link>
            </p>
          </div>
          <div className="hidden md:block">
            <EscrowCard />
          </div>
        </div>
      </section>

      {/* ---------- Ценности ---------- */}
      <section className="border-b border-slate-100 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: IconLock, title: 'Эскроу на каждом заказе', text: 'Деньги заморожены до приёмки' },
            { icon: IconAdmin, title: 'Проверка исполнителей', text: 'Паспорт или статус самозанятого' },
            { icon: IconJustice, title: 'Арбитраж споров', text: 'Решение по переписке и файлам' },
            { icon: IconMessages, title: 'Чат внутри сделки', text: 'Файлы, фото, история договорённостей' },
          ].map(({ icon: I, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="w-10 h-10 shrink-0 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                <I size={20} />
              </span>
              <div>
                <p className="font-bold text-sm text-slate-900 dark:text-white">{title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Категории ---------- */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <SectionTitle eyebrow="Категории" title="Чем можем помочь" text="От бытовых дел до digital-проектов — выберите направление." />
          <Link to="/tasks" className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:gap-2.5 transition-all">
            Все категории <IconArrowRight size={16} />
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {CATEGORIES.map(({ id, label, hint, icon: I }) => (
            <Link
              key={id}
              to={`/tasks?category=${id}`}
              className="group rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-800/60 p-4 sm:p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover transition-all"
            >
              <span className="w-11 h-11 rounded-xl bg-slate-50 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center transition-colors">
                <I size={22} />
              </span>
              <p className="mt-4 font-bold text-sm sm:text-base text-slate-900 dark:text-white">{label}</p>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">{hint}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Свежие задания (живые данные) ---------- */}
      {(latest.loading || latest.tasks.length > 0) && (
        <section className="bg-slate-50 dark:bg-slate-950/40 border-y border-slate-100 dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <SectionTitle eyebrow="Прямо сейчас" title="Свежие задания" text="Открытые заказы, на которые можно откликнуться." />
              <Link to="/tasks" className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:gap-2.5 transition-all">
                Все задания <IconArrowRight size={16} />
              </Link>
            </div>
            <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {latest.loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-40 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 animate-pulse" />
                  ))
                : latest.tasks.map((t, i) => (
                    <Link
                      key={t.id}
                      to={`/tasks/${t.id}`}
                      className={`${i >= 3 ? 'hidden sm:flex' : 'flex'} group flex-col rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 hover:border-indigo-300 dark:hover:border-indigo-500/60 hover:shadow-card-hover transition-all`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold px-2.5 py-1">
                          {taskCategoryLabel(t.category)}
                        </span>
                        <span className="font-display font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatBudget(t.budget)}</span>
                      </div>
                      <p className="mt-3 font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {t.title}
                      </p>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">{t.description}</p>
                      <p className="mt-auto pt-4 text-xs text-slate-400 flex items-center gap-1.5">
                        {t.is_remote ? <IconGlobe size={13} /> : <IconPin size={13} />}
                        {t.is_remote ? 'Удалённо' : t.city || 'Город не указан'}
                      </p>
                    </Link>
                  ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------- Как это работает ---------- */}
      <section id="how" className="scroll-mt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
        <SectionTitle center eyebrow="Как это работает" title="Четыре шага до результата" />
        <div className="mt-8 flex justify-center">
          <div role="tablist" className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {[
              ['customer', 'Заказчикам'],
              ['specialist', 'Исполнителям'],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={audience === id}
                onClick={() => setAudience(id)}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
                  audience === id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ol className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS[audience].map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-slate-200 dark:border-slate-700/70 p-6 bg-white dark:bg-slate-800/60">
              <span className="font-display text-4xl font-bold text-indigo-100 dark:text-indigo-500/25">0{i + 1}</span>
              <p className="mt-3 font-bold text-slate-900 dark:text-white">{s.title}</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Безопасная сделка ---------- */}
      <section id="safe-deal" className="scroll-mt-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto rounded-[2rem] bg-slate-950 text-white overflow-hidden relative">
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(50% 80% at 100% 0%, rgba(99,102,241,.35), transparent 70%)' }}
            aria-hidden="true"
          />
          <div className="relative grid lg:grid-cols-2 gap-10 p-8 sm:p-12 lg:p-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-300">Безопасная сделка</p>
              <h2 className="mt-2 text-2xl sm:text-[2rem] font-extrabold tracking-tight">Деньги защищены на каждом этапе</h2>
              <p className="mt-4 text-slate-300">
                Сервис держит оплату у себя, пока стороны не выполнят договорённости. Ни заказчик, ни
                исполнитель не могут забрать деньги в одностороннем порядке.
              </p>
              <button
                type="button"
                onClick={() => startTask('')}
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white text-slate-950 font-bold px-6 py-3 hover:bg-indigo-50 transition-colors"
              >
                Создать задание <IconArrowRight size={16} />
              </button>
            </div>
            <ul className="grid gap-3">
              {[
                ['Оплата при выборе исполнителя', 'Бюджет замораживается на эскроу — исполнитель видит, что заказ оплачен.'],
                ['Выплата после приёмки', 'Исполнитель получает деньги только после вашего подтверждения.'],
                ['Спор вместо отмены', 'Если что-то пошло не так, арбитр решит, кому достанутся средства.'],
                ['Автоматический возврат', 'Если исполнитель откажется от заказа, деньги сразу вернутся заказчику.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-4 rounded-2xl bg-white/5 border border-white/10 p-4">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-emerald-400/15 text-emerald-300 flex items-center justify-center">
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
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-center rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-indigo-50 via-white to-amber-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 p-8 sm:p-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">Для специалистов</p>
            <h2 className="mt-2 text-2xl sm:text-[2rem] font-extrabold tracking-tight text-slate-900 dark:text-white">
              Зарабатывайте на своих навыках
            </h2>
            <ul className="mt-5 grid sm:grid-cols-3 gap-4 text-sm">
              {[
                [IconWallet, 'Оплата зарезервирована до начала работы'],
                [IconStar, 'Рейтинг и отзывы от реальных заказчиков'],
                [IconSparkles, 'Новые заказы в ленте, на карте и в Telegram'],
              ].map(([I, t]) => (
                <li key={t} className="flex items-start gap-2.5 text-slate-600 dark:text-slate-300">
                  <I size={18} className="mt-0.5 text-indigo-600 dark:text-indigo-400" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3">
            {!user && (
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3 transition-colors"
              >
                Стать исполнителем
              </button>
            )}
            <Link
              to="/tasks"
              className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold px-6 py-3 text-center hover:border-indigo-400 transition-colors"
            >
              Смотреть заказы
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section id="faq" className="scroll-mt-20 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <SectionTitle center eyebrow="Вопросы и ответы" title="Частые вопросы" />
        <div className="mt-8 divide-y divide-slate-200 dark:divide-slate-700 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-bold text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="w-7 h-7 shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 transition-transform group-open:rotate-45 text-lg leading-none">
                  +
                </span>
              </summary>
              <p className="pb-5 -mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- Финальный призыв ---------- */}
      <section className="px-4 sm:px-6 lg:px-8 pb-20">
        <div className="max-w-7xl mx-auto rounded-[2rem] bg-indigo-600 text-white text-center px-6 py-14 sm:py-16 relative overflow-hidden">
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(40% 80% at 10% 0%, rgba(255,255,255,.18), transparent 70%), radial-gradient(40% 80% at 90% 100%, rgba(245,158,11,.25), transparent 70%)' }}
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight">Опишите задачу — остальное возьмём на себя</h2>
            <p className="mt-3 text-indigo-100 max-w-xl mx-auto">Исполнители сами предложат цену и сроки, а оплата будет под защитой.</p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={() => startTask('')}
                className="rounded-xl bg-white text-indigo-700 font-bold px-7 py-3.5 hover:bg-indigo-50 transition-colors"
              >
                Создать задание
              </button>
              <Link to="/specialists" className="rounded-xl border border-white/30 text-white font-bold px-7 py-3.5 hover:bg-white/10 transition-colors inline-flex items-center justify-center gap-2">
                <IconUsers size={18} /> Найти специалиста
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
