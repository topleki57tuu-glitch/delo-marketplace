import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useDialogs } from '../components/DialogProvider.jsx';
import { taskCategoryLabel } from '../constants/categories.js';
import { useDocumentTitle } from '../components/RouteMeta.jsx';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { ErrorState, Spinner, StateCard } from '../components/PageState.jsx';
import { useFocusTrap, useModal } from '../utils/a11y.js';
import { countLabel } from '../utils/format.js';
import {
  IconCalendar,
  IconCatBeauty,
  IconCatBusiness,
  IconCatCleaning,
  IconCatDelivery,
  IconCatDesign,
  IconCatDevelopment,
  IconCatEvents,
  IconCatOther,
  IconCatPhotoVideo,
  IconCatRepairs,
  IconCatTutoring,
  IconCatWriting,
  IconCheck,
  IconGlobe,
  IconJustice,
  IconLock,
  IconMessages,
  IconPin,
  IconQuestion,
  IconStar,
  IconUser,
  IconWarning,
} from '../components/icons.jsx';

const CATEGORY_ICONS = {
  development: IconCatDevelopment,
  design: IconCatDesign,
  writing: IconCatWriting,
  repairs: IconCatRepairs,
  cleaning: IconCatCleaning,
  delivery: IconCatDelivery,
  photo_video: IconCatPhotoVideo,
  tutoring: IconCatTutoring,
  beauty: IconCatBeauty,
  events: IconCatEvents,
  business: IconCatBusiness,
  other: IconCatOther,
};

// Плашки статуса стоят на тёмной шапке, поэтому цвета — полупрозрачные светлые
const STATUS_META = {
  open: { label: 'Принимает отклики', cls: 'bg-emerald-400/15 text-emerald-300', dot: 'bg-emerald-400' },
  in_progress: { label: 'В работе', cls: 'bg-amber-400/15 text-amber-200', dot: 'bg-amber-300' },
  disputed: { label: 'Арбитраж', cls: 'bg-red-400/15 text-red-300', dot: 'bg-red-400' },
  completed: { label: 'Завершено', cls: 'bg-sky-400/15 text-sky-200', dot: 'bg-sky-300' },
  cancelled: { label: 'Отменено', cls: 'bg-white/10 text-slate-300', dot: 'bg-slate-400' },
};

const formatMoney = (value) => `${Number(value).toLocaleString('ru-RU')} ₽`;
// Бэкенд отдаёт «2026-11-08 15:40:26» — Safari не разбирает дату с пробелом
const parseDate = (value) => new Date(String(value).replace(' ', 'T'));
const formatDate = (value) => parseDate(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function Card({ eyebrow, title, action, children, className = '', id }) {
  return (
    <section id={id} className={`card p-5 sm:p-6 ${className}`}>
      {(eyebrow || title) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
            {title && <h2 className="section-title mt-1">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="w-9 h-9 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 flex items-center justify-center">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{children}</div>
      </div>
    </div>
  );
}

function ReviewDialog({ open, title, text, onClose, onSubmit }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const panelRef = useRef(null);
  useModal(open, onClose);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    const ok = await onSubmit({ rating, comment: comment.trim() });
    setSending(false);
    if (ok) {
      setComment('');
      setRating(5);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-pop p-5 sm:p-6"
      >
        <h2 id="review-title" className="text-lg font-extrabold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{text}</p>

        <div role="radiogroup" aria-label="Оценка" className="mt-5 flex items-center justify-center gap-1.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={star === rating}
              aria-label={`${star} из 5`}
              onClick={() => setRating(star)}
              className={`p-1 rounded-lg transition-transform hover:scale-110 ${star <= rating ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'}`}
            >
              <IconStar size={32} fill={star <= rating ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>

        <label htmlFor="review-comment" className="sr-only">Комментарий</label>
        <textarea
          id="review-comment"
          rows={3}
          placeholder="Что понравилось, что можно улучшить..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="textarea mt-5"
        />

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Позже
          </button>
          <button type="submit" disabled={sending} className="btn btn-primary">
            {sending ? 'Отправка...' : 'Отправить отзыв'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function TaskDetailPage({ user, token, onOpenAuth, onOpenChat }) {
  const { taskId } = useParams();
  const { addToast } = useToast();
  const dialogs = useDialogs();

  const [task, setTask] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | not-found | error
  const [responses, setResponses] = useState([]);
  // Пока грузится новое задание, в state ещё лежит предыдущее — его
  // название во вкладку не ставим.
  useDocumentTitle(task && String(task.id) === String(taskId) ? task.title : null);
  const [responseText, setResponseText] = useState('');
  const [proposedPrice, setProposedPrice] = useState('');
  const [estimatedDays, setEstimatedDays] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [openingDispute, setOpeningDispute] = useState(false);
  const responseFieldRef = useRef(null);

  const [dispute, setDispute] = useState(null);

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [taskReviews, setTaskReviews] = useState([]);
  const [canReview, setCanReview] = useState(false);

  const fetchTaskDetails = useCallback(async () => {
    try {
      // С токеном: улицу, дом и точку на карте backend отдаёт только заказчику,
      // назначенному исполнителю и модератору, остальным — город и район
      // (app/api/tasks.py). Истёкший токен обёртка utils/session.js продлит
      // сама; если сессию продлить не удалось — страница публичная, грузим без входа.
      let res = await fetch(`/tasks/${taskId}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (res.status === 401 && token) res = await fetch(`/tasks/${taskId}`);
      if (res.status === 404 || res.status === 422) {
        setTask(null);
        setStatus('not-found');
        return;
      }
      if (!res.ok) throw new Error('task');
      const data = await res.json();
      setTask(data);
      setStatus('ready');

      if (token) {
        const auth = { headers: { Authorization: `Bearer ${token}` } };
        const [respRes, dispRes, revRes] = await Promise.all([
          fetch(`/tasks/${taskId}/responses`, auth),
          fetch(`/tasks/${taskId}/dispute`, auth),
          data.status === 'completed' ? fetch(`/tasks/${taskId}/reviews`, auth) : Promise.resolve(null),
        ]);
        if (respRes.ok) setResponses(await respRes.json());
        // Информация о споре доступна участникам сделки и арбитрам
        setDispute(dispRes.ok ? (await dispRes.json()).dispute || null : null);
        if (revRes && revRes.ok) {
          const revData = await revRes.json();
          setTaskReviews(revData.reviews || []);
          setCanReview(!!revData.can_review);
        } else {
          setTaskReviews([]);
          setCanReview(false);
        }
      } else {
        setResponses([]);
        setDispute(null);
      }
    } catch (err) {
      setStatus((s) => (s === 'ready' ? s : 'error'));
      addToast('Не удалось загрузить задание', 'error');
    }
  }, [taskId, token]);

  useEffect(() => {
    fetchTaskDetails();
  }, [fetchTaskDetails]);

  const handleSendResponse = async (e) => {
    e.preventDefault();
    if (!token) {
      onOpenAuth('login');
      return;
    }
    if (!responseText.trim()) {
      addToast('Напишите текст отклика', 'error');
      return;
    }

    setSubmittingResponse(true);
    try {
      const res = await fetch(`/tasks/${taskId}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: responseText.trim(),
          proposed_price: proposedPrice ? parseInt(proposedPrice, 10) : null,
          estimated_days: estimatedDays ? parseInt(estimatedDays, 10) : null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось отправить отклик');

      addToast('Отклик отправлен — заказчик получит уведомление', 'success');
      setResponseText('');
      setProposedPrice('');
      setEstimatedDays('');
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmittingResponse(false);
    }
  };

  const handleAssignSpecialist = async (specialistId, name) => {
    const ok = await dialogs.confirm({
      title: `Выбрать исполнителем${name ? ` — ${name}` : ''}?`,
      message:
        'Бюджет заморозится на безопасной сделке и перейдёт исполнителю, когда вы примете работу.\n\nПосле назначения отменить заказ в одностороннем порядке нельзя: если что-то пойдёт не так, откройте спор — арбитр решит, вернуть ли деньги.',
      confirmText: 'Назначить',
    });
    if (!ok) return;

    setAssigningId(specialistId);
    try {
      const res = await fetch(`/tasks/${taskId}/assign?specialist_id=${specialistId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Ошибка при назначении исполнителя');

      addToast('Исполнитель назначен — заказ в работе', 'success');
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setAssigningId(null);
    }
  };

  const handleCompleteTask = async () => {
    const ok = await dialogs.confirm({
      title: 'Принять работу?',
      message: 'Замороженный бюджет будет переведён исполнителю. Отменить это действие нельзя.',
      confirmText: 'Принять и выплатить',
    });
    if (!ok) return;

    setCompleting(true);
    try {
      const res = await fetch(`/tasks/${taskId}/complete`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Ошибка при завершении заказа');

      addToast('Заказ завершён, деньги переведены исполнителю', 'success');
      setShowReviewModal(true);
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCompleting(false);
    }
  };

  const handleOpenDispute = async () => {
    const reason = await dialogs.prompt({
      title: 'Открыть спор',
      message:
        'Деньги останутся замороженными, пока арбитраж площадки не вынесет решение: вернуть их заказчику или выплатить исполнителю.',
      placeholder: 'Опишите проблему: что пошло не так, какие договорённости нарушены...',
      multiline: true,
      confirmText: 'Открыть спор',
      validate: (v) => (v.trim().length < 5 ? 'Опишите причину спора — хотя бы пару слов' : null),
    });
    if (reason === null || reason === undefined) return;

    setOpeningDispute(true);
    try {
      const res = await fetch(`/tasks/${taskId}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось открыть спор');
      addToast(data.message || 'Спор открыт', 'success');
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setOpeningDispute(false);
    }
  };

  const handleCancelTask = async () => {
    const isMyDispute = dispute && dispute.status === 'open' && user && dispute.opened_by === user.id;
    let options;
    if (isMyDispute && isAuthor) {
      options = {
        title: 'Отозвать спор?',
        message: 'Заказ вернётся в работу, деньги останутся замороженными до завершения.',
        confirmText: 'Отозвать спор',
      };
    } else if (isMyDispute) {
      options = {
        title: 'Отозвать спор и отказаться от заказа?',
        message: 'Замороженные деньги вернутся заказчику.',
        confirmText: 'Отказаться',
        danger: true,
      };
    } else {
      options = {
        title: 'Отказаться от заказа?',
        message: 'Замороженные деньги (эскроу) вернутся заказчику, заказ снова станет открытым для других специалистов.',
        confirmText: 'Отказаться',
        danger: true,
      };
    }
    if (!(await dialogs.confirm(options))) return;

    setCancelling(true);
    try {
      const res = await fetch(`/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Не удалось выполнить действие');
      addToast(data.message || 'Готово', 'success');
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handleSendReview = async ({ rating, comment }) => {
    try {
      const res = await fetch(`/tasks/${taskId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rating, comment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Ошибка при отправке отзыва');

      addToast('Спасибо за отзыв!', 'success');
      setShowReviewModal(false);
      fetchTaskDetails();
      return true;
    } catch (err) {
      addToast(err.message, 'error');
      return false;
    }
  };

  const back = { to: '/tasks', label: 'Все задания' };

  if (status !== 'ready' || !task) {
    const notFound = status === 'not-found';
    return (
      <>
        <PageHero
          width="medium"
          size="sm"
          back={back}
          eyebrow="Задание"
          icon={IconQuestion}
          title={status === 'loading' ? null : notFound ? 'Задание не найдено' : 'Задание недоступно'}
        />
        <PageBody width="medium">
          {status === 'loading' ? (
            <Spinner label="Загрузка задания..." />
          ) : notFound ? (
            <StateCard icon={IconQuestion} title="Такого задания нет" text="Возможно, его удалили или ссылка устарела.">
              <Link to="/tasks" className="btn btn-primary">Все задания</Link>
            </StateCard>
          ) : (
            <ErrorState text="Не удалось загрузить задание. Проверьте соединение." onRetry={fetchTaskDetails} />
          )}
        </PageBody>
      </>
    );
  }

  const isAuthor = !!user && user.id === task.customer_id;
  const isAssignedSpecialist = !!user && user.id === task.executor_id;
  const isParticipant = isAuthor || isAssignedSpecialist;
  const myResponse = user ? responses.find((r) => r.specialist_id === user.id) : null;
  const canRespond = !!user && user.role === 'specialist' && task.status === 'open' && !isAuthor && !myResponse;
  const statusMeta = STATUS_META[task.status] || STATUS_META.open;
  const CategoryIcon = CATEGORY_ICONS[task.category] || IconCatOther;
  const responsesCount = isAuthor ? responses.length : task.responses_count ?? responses.length;
  const canCancel =
    (task.status === 'in_progress' && isAssignedSpecialist) ||
    (task.status === 'disputed' && isParticipant && dispute && user && dispute.opened_by === user.id);

  let images = [];
  try {
    images = task.images ? JSON.parse(task.images) : [];
    if (!Array.isArray(images)) images = [];
  } catch (e) {
    images = [];
  }

  const focusResponseForm = () => {
    const form = document.getElementById('respond');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => responseFieldRef.current?.focus({ preventScroll: true }), 350);
  };

  let heroAction = null;
  if (isParticipant) {
    heroAction = (
      <button type="button" className="btn btn-cta w-full" onClick={() => onOpenChat?.(task.id)}>
        <IconMessages /> Чат сделки
      </button>
    );
  } else if (canRespond) {
    heroAction = (
      <button type="button" className="btn btn-cta w-full" onClick={focusResponseForm}>
        Откликнуться
      </button>
    );
  } else if (!user && task.status === 'open') {
    heroAction = (
      <button type="button" className="btn btn-cta w-full" onClick={() => onOpenAuth?.('login')}>
        Войти и откликнуться
      </button>
    );
  } else if (myResponse && task.status === 'open') {
    heroAction = (
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
        <IconCheck size={16} /> Вы откликнулись
      </p>
    );
  }

  return (
    <>
      <PageHero
        width="medium"
        size="sm"
        back={back}
        eyebrow={taskCategoryLabel(task.category)}
        icon={CategoryIcon}
        title={task.title}
        titleClassName="hero-title-sm"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
              {statusMeta.label}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {task.is_remote ? <IconGlobe size={14} /> : <IconPin size={14} />}
              {task.is_remote ? 'Удалённо' : task.city || 'Город не указан'}
            </span>
            {task.deadline && (
              <span className="inline-flex items-center gap-1.5">
                <IconCalendar size={14} /> до {formatDate(task.deadline)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <IconMessages size={14} /> {countLabel(responsesCount || 0, 'отклик', 'отклика', 'откликов')}
            </span>
          </span>
        }
        aside={
          <div className="hero-stat sm:min-w-[17rem]">
            <p className="hero-stat-label">Бюджет</p>
            <p className="hero-stat-value !text-[1.75rem] sm:!text-[2rem]">
              {task.budget ? formatMoney(task.budget) : 'Договорная'}
            </p>
            {heroAction && <div className="mt-3">{heroAction}</div>}
          </div>
        }
      />

      <PageBody width="medium">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] items-start">
          <div className="space-y-5 min-w-0">
            {dispute && dispute.status === 'open' && (
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
            {dispute && dispute.status !== 'open' && dispute.resolution_comment && (
              <div className="card p-4 sm:p-5 flex items-start gap-3">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 flex items-center justify-center">
                  <IconJustice size={20} />
                </span>
                <div className="text-sm">
                  <p className="font-bold text-slate-800 dark:text-slate-100">Спор закрыт</p>
                  <p className="text-slate-500 dark:text-slate-400 mt-1">{dispute.resolution_comment}</p>
                </div>
              </div>
            )}

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

            {canRespond && (
              <Card id="respond" eyebrow="Отклик" title="Предложите свою цену и сроки" className="scroll-mt-24">
                <form onSubmit={handleSendResponse} className="space-y-4">
                  <div>
                    <label htmlFor="response-text" className="field-label">Сообщение заказчику</label>
                    <textarea
                      id="response-text"
                      ref={responseFieldRef}
                      rows={4}
                      placeholder="Почему вы подходите: опыт, похожие работы, когда готовы начать..."
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      className="textarea"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="response-price" className="field-label">Ваша цена, ₽</label>
                      <input
                        id="response-price"
                        type="number"
                        min="0"
                        inputMode="numeric"
                        placeholder={task.budget ? String(task.budget) : 'Например: 5000'}
                        value={proposedPrice}
                        onChange={(e) => setProposedPrice(e.target.value)}
                        className="input"
                      />
                    </div>
                    <div>
                      <label htmlFor="response-days" className="field-label">Срок, дней</label>
                      <input
                        id="response-days"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        placeholder="Например: 3"
                        value={estimatedDays}
                        onChange={(e) => setEstimatedDays(e.target.value)}
                        className="input"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {user.is_pro
                        ? 'PRO: отклики без ограничений'
                        : `Отклик спишет 1 из доступных: ${user.response_credits ?? 0}`}
                    </p>
                    <button type="submit" disabled={submittingResponse} className="btn btn-primary">
                      {submittingResponse ? 'Отправка...' : 'Отправить отклик'}
                    </button>
                  </div>
                </form>
              </Card>
            )}

            <Card eyebrow="Отклики" title={`Специалисты · ${responsesCount || 0}`}>
              {/* Чужие отклики видит только автор задания (бэкенд отдаёт остальным
                  лишь их собственный). Поэтому «Будьте первым» показываем, только
                  когда откликов действительно нет. */}
              {responses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  {!isAuthor && (task.responses_count || 0) > 0
                    ? 'Отклики видит только заказчик. Откликнитесь, чтобы предложить свою цену и сроки.'
                    : task.status === 'open'
                      ? 'Пока нет откликов. Будьте первым!'
                      : 'Откликов не было.'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {responses.map((resp) => {
                    const isExecutor = task.executor_id === resp.specialist_id;
                    return (
                      <li key={resp.id} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="relative shrink-0">
                              <span className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center overflow-hidden">
                                {resp.specialist_avatar ? (
                                  <img src={resp.specialist_avatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  (resp.specialist_name || 'С')[0].toUpperCase()
                                )}
                              </span>
                              {resp.specialist_online && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full" title="В сети" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Link
                                  to={`/specialist/${resp.specialist_id}`}
                                  className="font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                                >
                                  {resp.specialist_name || 'Специалист'}
                                </Link>
                                {resp.specialist_pro && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">PRO</span>
                                )}
                                {resp.specialist_verified && <IconCheck size={14} className="text-sky-500" title="Проверен" />}
                                {isExecutor && (
                                  <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Исполнитель</span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                <IconStar size={13} fill="currentColor" className="text-amber-400" />
                                <span className="font-semibold text-slate-700 dark:text-slate-200">
                                  {resp.specialist_rating != null ? Number(resp.specialist_rating).toFixed(1) : '—'}
                                </span>
                                <span>· {countLabel(resp.specialist_completed_tasks || 0, 'заказ', 'заказа', 'заказов')}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {resp.proposed_price ? (
                              <span className="block font-extrabold text-slate-900 dark:text-white">{formatMoney(resp.proposed_price)}</span>
                            ) : null}
                            {resp.estimated_days ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {countLabel(resp.estimated_days, 'день', 'дня', 'дней')}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{resp.text}</p>

                        {isAuthor && task.status === 'open' && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleAssignSpecialist(resp.specialist_id, resp.specialist_name)}
                              disabled={assigningId === resp.specialist_id}
                              className="btn btn-primary !py-2 !text-xs"
                            >
                              {assigningId === resp.specialist_id ? 'Назначение...' : 'Выбрать исполнителем'}
                            </button>
                            <Link to={`/specialist/${resp.specialist_id}`} className="btn btn-secondary !py-2 !text-xs">
                              Профиль и отзывы
                            </Link>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {task.status === 'completed' && (taskReviews.length > 0 || canReview) && (
              <Card
                eyebrow="Отзывы"
                title="Отзывы по сделке"
                action={
                  canReview && (
                    <button type="button" className="btn btn-primary !py-2 !text-xs shrink-0" onClick={() => setShowReviewModal(true)}>
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
            )}
          </div>

          <aside className="space-y-5">
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

            {isParticipant && (task.status === 'in_progress' || canCancel) && (
              <Card eyebrow="Сделка">
                <div className="space-y-2">
                  {isAuthor && task.status === 'in_progress' && (
                    <button type="button" onClick={handleCompleteTask} disabled={completing} className="btn w-full bg-emerald-600 hover:bg-emerald-500 text-white">
                      {completing ? 'Завершение...' : <><IconCheck /> Принять работу и оплатить</>}
                    </button>
                  )}
                  {task.status === 'in_progress' && !task.has_open_dispute && (
                    <button
                      type="button"
                      onClick={handleOpenDispute}
                      disabled={openingDispute}
                      className="btn w-full border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20"
                    >
                      <IconWarning /> {openingDispute ? 'Открываем спор...' : 'Открыть спор'}
                    </button>
                  )}
                  {/* Заказ в работе может отменить только исполнитель (отказ); заказчик — через спор.
                      В споре — только инициатор: заказчик отзывает спор (заказ возвращается в работу),
                      исполнитель отзывает спор и отказывается (эскроу возвращается заказчику). */}
                  {canCancel && (
                    <button type="button" onClick={handleCancelTask} disabled={cancelling} className="btn btn-secondary w-full">
                      {cancelling
                        ? 'Отмена...'
                        : task.status === 'disputed'
                          ? isAuthor
                            ? 'Отозвать спор'
                            : 'Отозвать спор и отказаться'
                          : 'Отказаться от заказа'}
                    </button>
                  )}
                </div>
                {isAuthor && task.status === 'in_progress' && (
                  <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Заказ в работе нельзя отменить в одностороннем порядке. Если исполнитель не справляется,
                    откройте спор — арбитр решит, вернуть ли вам деньги. Исполнитель может сам отказаться
                    от заказа, тогда деньги вернутся автоматически.
                  </p>
                )}
                {isAssignedSpecialist && task.status === 'in_progress' && (
                  <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Если откажетесь, замороженные деньги вернутся заказчику.
                  </p>
                )}
              </Card>
            )}

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
          </aside>
        </div>
      </PageBody>

      <ReviewDialog
        open={showReviewModal}
        title={isAuthor ? 'Оцените работу исполнителя' : 'Оцените заказчика'}
        text="Отзыв увидят другие пользователи — он помогает выбирать надёжных партнёров."
        onClose={() => setShowReviewModal(false)}
        onSubmit={handleSendReview}
      />
    </>
  );
}
