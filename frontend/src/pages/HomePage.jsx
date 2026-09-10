import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

const CATEGORIES = [
  { id: 'development', label: 'Разработка сайтов и IT', icon: '💻', count: '120+' },
  { id: 'design', label: 'Дизайн и графика', icon: '🎨', count: '85+' },
  { id: 'repairs', label: 'Ремонт и строительство', icon: '🔨', count: '240+' },
  { id: 'cleaning', label: 'Уборка и клининг', icon: '✨', count: '90+' },
  { id: 'delivery', label: 'Курьеры и доставка', icon: '🚚', count: '150+' },
  { id: 'photo_video', label: 'Фото и видеосъемка', icon: '📷', count: '65+' },
  { id: 'tutoring', label: 'Репетиторы и обучение', icon: '📚', count: '110+' },
  { id: 'beauty', label: 'Красота и здоровье', icon: '💅', count: '75+' },
];

export default function HomePage({ user, onOpenAuth, onOpenCreateTask }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 pb-20">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-10">
          <div className="flex-1 text-center md:text-left space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 text-sm font-medium">
              <span>🚀</span>
              <span>Платформа безопасных сделок №1</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
              Найдите проверенного <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">специалиста</span> для любых задач
            </h1>
            <p className="text-lg text-indigo-200 max-w-xl">
              Тысячи проверенных исполнителей готовы выполнить ваши задания: от ремонта до разработки сервисов.
            </p>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-2">
              <button
                onClick={() => {
                  if (user) {
                    navigate('/create-task');
                  } else {
                    onOpenAuth('register');
                  }
                }}
                className="px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              >
                + Создать задание
              </button>
              <Link
                to="/tasks"
                className="px-6 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/20 transition-all backdrop-blur-sm"
              >
                Найти работу / Заказы
              </Link>
            </div>
          </div>

          <div className="flex-1 w-full max-w-md bg-white/10 p-6 rounded-2xl border border-white/20 backdrop-blur-md shadow-2xl text-white">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span>⚡</span>
              <span>Как работает сервис</span>
            </h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-900 font-bold flex items-center justify-center shrink-0">1</div>
                <div>
                  <h4 className="font-semibold">Опишите задачу</h4>
                  <p className="text-xs text-indigo-200">Используйте AI-помощника для быстрого составления понятного ТЗ.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-900 font-bold flex items-center justify-center shrink-0">2</div>
                <div>
                  <h4 className="font-semibold">Получите отклики</h4>
                  <p className="text-xs text-indigo-200">Специалисты предложат свои цены и сроки. Выберите лучшего по отзывам.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-900 font-bold flex items-center justify-center shrink-0">3</div>
                <div>
                  <h4 className="font-semibold">Безопасная оплата</h4>
                  <p className="text-xs text-indigo-200">Средства замораживаются и перечисляются только после вашего подтверждения.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories Grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Популярные категории</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Выберите направление или найдите задачу по душе</p>
          </div>
          <Link to="/tasks" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline text-sm flex items-center gap-1">
            Все категории &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              to={`/tasks?category=${cat.id}`}
              className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-500 transition-all group flex flex-col justify-between"
            >
              <div className="text-3xl mb-3 transform group-hover:scale-110 transition-transform origin-left">{cat.icon}</div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors text-sm sm:text-base">
                  {cat.label}
                </h3>
                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 inline-block">{cat.count} заданий</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Security & Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-3xl p-8 sm:p-12 shadow-xl border border-indigo-500/20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-2xl mx-auto md:mx-0">
                🛡️
              </div>
              <h3 className="text-xl font-bold">Эскроу защита</h3>
              <p className="text-sm text-slate-300">Деньги находятся в безопасности на специальном счете до окончания работы.</p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-2xl mx-auto md:mx-0">
                ⭐
              </div>
              <h3 className="text-xl font-bold">Честные отзывы</h3>
              <p className="text-sm text-slate-300">Отзывы и оценки могут оставлять только реальные участники завершенных сделок.</p>
            </div>
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl mx-auto md:mx-0">
                💬
              </div>
              <h3 className="text-xl font-bold">Чат в реальном времени</h3>
              <p className="text-sm text-slate-300">Обсуждайте детали, обменивайтесь файлами и согласовывайте условия онлайн.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
