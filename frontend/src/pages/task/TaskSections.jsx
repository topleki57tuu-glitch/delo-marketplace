// Разделы страницы задания без собственной логики: плашка спора,
// описание с фото, отзывы по сделке, сведения о задании и памятка
// о безопасной сделке.
import React from 'react';
import { Link } from 'react-router-dom';
import {
  IconCalendar,
  IconGlobe,
  IconJustice,
  IconLock,
  IconPin,
  IconStar,
  IconUser,
} from '../../components/icons.jsx';
import { Card, DetailRow, formatDate } from './taskDetailShared.jsx';

// Плашка над описанием: спор открыт (деньги заморожены) или уже решён.
const DISPUTE_OUTCOME = {
  resolved_customer: 'Спор закрыт: деньги возвращены заказчику',
  resolved_specialist: 'Спор закрыт: деньги выплачены исполнителю',
  closed: 'Спор отозван',
};

export function DisputeNotice({ dispute }) {
  if (!dispute) return null;
  return (
    <>
      {dispute.status === 'open' && (
        <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 sm:p-5 flex items-start gap-3">
          <span className="w-10 h-10 shrink-0 rounded-xl bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-300 flex items-center justify-center">
            <IconJustice size={20} />
          </span>
          <div className="text-sm min-w-0">
            <p className="font-bold text-red-700 dark:text-red-200">Спор открыт — деньги заморожены</p>
            <p className="text-red-700/90 dark:text-red-300 mt-1">
              {dispute.opened_by_name}: «{dispute.reason}»
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-300/80 mt-1.5">
              Арбитраж площадки рассмотрит спор и вынесет решение. Продолжайте общение в чате сделки.
            </p>
          </div>
        </div>
      )}
      {/* Итог спора показываем всегда: без комментария арбитра блок раньше
          не появлялся, и стороны видели только статус «Отменено» без
          объяснения, куда ушли деньги. */}
      {dispute.status !== 'open' && (
        <div className="card p-4 sm:p-5 flex items-start gap-3">
          <span className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 flex items-center justify-center">
            <IconJustice size={20} />
          </span>
          <div className="text-sm">
            <p className="font-bold text-slate-800 dark:text-slate-100">
              {DISPUTE_OUTCOME[dispute.status] || 'Спор закрыт'}
            </p>
            {dispute.resolution_comment && (
              <p className="text-slate-500 dark:text-slate-400 mt-1">{dispute.resolution_comment}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function TaskDescription({ task }) {
  let images = [];
  try {
    images = task.images ? JSON.parse(task.images) : [];
    if (!Array.isArray(images)) images = [];
  } catch (e) {
    images = [];
  }

  return (
    <Card eyebrow="Задание" title="Описание">
      <p className="text-[0.9375rem] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line">{task.description}</p>
      {images.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Фото к заданию</p>
          <div className="flex flex-wrap gap-3">
            {images.map((imgUrl, idx) => (
              <a
                key={idx}
                href={imgUrl}
                target="_blank"
                rel="noreferrer"
                className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-90 transition-opacity"
              >
                <img src={imgUrl} alt={`Фото ${idx + 1}`} loading="lazy" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function TaskReviews({ reviews: taskReviews, canReview, onWriteReview }) {
  return (
    <Card
      eyebrow="Отзывы"
      title="Отзывы по сделке"
      action={
        canReview && (
          <button type="button" className="btn btn-primary !py-2 !text-xs shrink-0" onClick={onWriteReview}>
            <IconStar size={14} /> Оставить отзыв
          </button>
        )
      }
    >
      {taskReviews.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Отзывов пока нет — оцените сотрудничество первым.</p>
      ) : (
        <ul className="space-y-3">
          {taskReviews.map((rev) => (
            <li key={rev.id} className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {rev.reviewer_name} <span className="font-normal text-slate-500 dark:text-slate-400">о {rev.target_user_name}</span>
                </p>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-500">
                  <IconStar size={14} fill="currentColor" /> {rev.rating}
                </span>
              </div>
              {rev.comment && <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{rev.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TaskInfo({ task }) {
  return (
    <Card>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
        <DetailRow icon={IconUser} label="Заказчик">
          <Link to={`/specialist/${task.customer_id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
            {task.customer_name || 'Заказчик'}
          </Link>
        </DetailRow>
        <DetailRow icon={task.is_remote ? IconGlobe : IconPin} label="Где">
          {task.is_remote ? 'Удалённая работа' : [task.city, task.address].filter(Boolean).join(', ') || 'Не указано'}
          {!task.is_remote && task.address_hidden && (
            <p className="mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">
              Точный адрес увидит исполнитель после назначения
            </p>
          )}
        </DetailRow>
        <DetailRow icon={IconCalendar} label="Срок сдачи">
          {task.deadline ? formatDate(task.deadline) : 'Не указан'}
        </DetailRow>
      </div>
    </Card>
  );
}

export function SafeDealNote() {
  return (
    <div className="rounded-2xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/70 dark:bg-indigo-500/10 p-5">
      <p className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
        <IconLock size={16} className="text-indigo-600 dark:text-indigo-300" /> Безопасная сделка
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        Бюджет замораживается, когда заказчик выбирает исполнителя, и переходит ему только после приёмки работы.
      </p>
      <Link to="/help" className="mt-3 inline-flex text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline">
        Как это работает →
      </Link>
    </div>
  );
}
