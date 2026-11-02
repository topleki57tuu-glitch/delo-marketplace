// Страница задания: шапка с бюджетом и главным действием, описание,
// отклики, отзывы и действия по сделке. Сами разделы — в pages/task/,
// здесь — загрузка задания со связанными данными и раскладка страницы.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { taskCategoryLabel } from '../constants/categories.js';
import { useDocumentTitle } from '../components/RouteMeta.jsx';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { ErrorState, Spinner, StateCard } from '../components/PageState.jsx';
import { countLabel } from '../utils/format.js';
import {
  IconCalendar,
  IconCatOther,
  IconCheck,
  IconGlobe,
  IconMessages,
  IconPin,
  IconQuestion,
} from '../components/icons.jsx';
import DealActions from './task/DealActions.jsx';
import ResponseForm from './task/ResponseForm.jsx';
import ResponsesList from './task/ResponsesList.jsx';
import ReviewDialog from './task/ReviewDialog.jsx';
import { DisputeNotice, SafeDealNote, TaskDescription, TaskInfo, TaskReviews } from './task/TaskSections.jsx';
import { CATEGORY_ICONS, STATUS_META, formatDate, formatMoney } from './task/taskDetailShared.jsx';

export default function TaskDetailPage({ user, token, onOpenAuth, onOpenChat }) {
  const { taskId } = useParams();
  const { addToast } = useToast();

  const [task, setTask] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | not-found | error
  const [responses, setResponses] = useState([]);
  // Пока грузится новое задание, в state ещё лежит предыдущее — его
  // название во вкладку не ставим.
  useDocumentTitle(task && String(task.id) === String(taskId) ? task.title : null);
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
            <DisputeNotice dispute={dispute} />

            <TaskDescription task={task} />

            {canRespond && (
              <ResponseForm
                task={task}
                taskId={taskId}
                user={user}
                token={token}
                fieldRef={responseFieldRef}
                onOpenAuth={onOpenAuth}
                onSent={fetchTaskDetails}
              />
            )}

            <ResponsesList
              task={task}
              taskId={taskId}
              token={token}
              responses={responses}
              responsesCount={responsesCount}
              isAuthor={isAuthor}
              onChanged={fetchTaskDetails}
            />

            {task.status === 'completed' && (taskReviews.length > 0 || canReview) && (
              <TaskReviews reviews={taskReviews} canReview={canReview} onWriteReview={() => setShowReviewModal(true)} />
            )}
          </div>

          <aside className="space-y-5">
            <TaskInfo task={task} />

            {isParticipant && (task.status === 'in_progress' || canCancel) && (
              <DealActions
                task={task}
                taskId={taskId}
                token={token}
                user={user}
                dispute={dispute}
                isAuthor={isAuthor}
                isAssignedSpecialist={isAssignedSpecialist}
                canCancel={canCancel}
                onChanged={fetchTaskDetails}
                onCompleted={() => setShowReviewModal(true)}
              />
            )}

            <SafeDealNote />
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
