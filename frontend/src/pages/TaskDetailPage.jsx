import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';

export default function TaskDetailPage({ user, token, onOpenAuth, onOpenChat, onOpenPublicProfile }) {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [task, setTask] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responseText, setResponseText] = useState('');
  const [proposedPrice, setProposedPrice] = useState('');
  const [estimatedDays, setEstimatedDays] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [completing, setCompleting] = useState(false);

  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  const fetchTaskDetails = async () => {
    try {
      const res = await fetch(`/tasks/${taskId}`);
      if (!res.ok) throw new Error('Заказ не найден');
      const data = await res.json();
      setTask(data);

      // If user is logged in, load responses
      if (token) {
        const respRes = await fetch(`/tasks/${taskId}/responses`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (respRes.ok) {
          const respData = await respRes.json();
          setResponses(respData);
        }
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTaskDetails();
  }, [taskId, token]);

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

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось отправить отклик');

      addToast('Ваш отклик успешно отправлен!', 'success');
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

  const handleAssignSpecialist = async (specialistId) => {
    if (!window.confirm('Назначить этого специалиста исполнителем? Средства (бюджет) будут заморожены через безопасную сделку.')) {
      return;
    }

    setAssigningId(specialistId);
    try {
      const res = await fetch(`/tasks/${taskId}/assign?specialist_id=${specialistId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка при назначении исполнителя');

      addToast('Исполнитель назначен! Сделка перешла в статус "В работе"', 'success');
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setAssigningId(null);
    }
  };

  const handleCompleteTask = async () => {
    if (!window.confirm('Вы подтверждаете выполнение заказа? Средства будут переведены исполнителю.')) {
      return;
    }

    setCompleting(true);
    try {
      const res = await fetch(`/tasks/${taskId}/complete`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка при завершении заказа');

      addToast('Заказ успешно завершен! Средства переведены.', 'success');
      setShowReviewModal(true);
      fetchTaskDetails();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCompleting(false);
    }
  };

  const handleSendReview = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`/tasks/${taskId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rating: reviewRating,
          comment: reviewComment.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка при отправке отзыва');

      addToast('Спасибо за ваш отзыв!', 'success');
      setShowReviewModal(false);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl text-center space-y-4 max-w-md w-full shadow-lg">
          <div className="text-4xl">❓</div>
          <h2 className="text-xl font-bold">Заказ не найден</h2>
          <button
            onClick={() => navigate('/tasks')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium"
          >
            Вернуться к списку
          </button>
        </div>
      </div>
    );
  }

  const isAuthor = user && user.id === task.customer_id;
  const isAssignedSpecialist = user && user.id === task.executor_id;
  const canRespond = user && user.role === 'specialist' && task.status === 'open';

  let parsedImages = [];
  try {
    if (task.images) parsedImages = JSON.parse(task.images);
  } catch (e) {
    parsedImages = [];
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Back Link */}
        <Link
          to="/tasks"
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          &larr; Назад ко всем заданиям
        </Link>

        {/* Task Card */}
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  {task.category}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    task.status === 'open'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : task.status === 'in_progress'
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {task.status === 'open' ? '🟢 Открыт' : task.status === 'in_progress' ? '🟡 В работе' : '✅ Завершен'}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                {task.title}
              </h1>
            </div>

            <div className="text-left sm:text-right">
              <span className="text-xs text-slate-400 block mb-0.5">Бюджет</span>
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                {task.budget ? `${task.budget.toLocaleString('ru-RU')} ₽` : 'По договоренности'}
              </span>
            </div>
          </div>

          {/* Description */}
          <div className="text-sm sm:text-base text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line border-t border-b border-slate-100 dark:border-slate-700/60 py-4">
            {task.description}
          </div>

          {/* Images */}
          {parsedImages.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Прикрепленные фото</h4>
              <div className="flex flex-wrap gap-3">
                {parsedImages.map((imgUrl, idx) => (
                  <a
                    key={idx}
                    href={imgUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-90 transition-opacity"
                  >
                    <img src={imgUrl} alt="Task material" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400 pt-2">
            <div>
              <span className="block text-slate-400 text-xs mb-0.5">Локация</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                📍 {task.is_remote ? 'Удаленная работа' : task.city || 'Не указан'}
              </span>
            </div>
            {task.deadline && (
              <div>
                <span className="block text-slate-400 text-xs mb-0.5">Срок сдачи</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  📅 {task.deadline}
                </span>
              </div>
            )}
            <div>
              <span className="block text-slate-400 text-xs mb-0.5">Заказчик</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                👤 {task.customer_name || 'Заказчик'}
              </span>
            </div>
            <div>
              <span className="block text-slate-400 text-xs mb-0.5">Откликов</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                💬 {responses.length || task.responses_count || 0}
              </span>
            </div>
          </div>

          {/* Actions Bar */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {(isAuthor || isAssignedSpecialist) && (
                <button
                  onClick={() => onOpenChat(task.id)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all"
                >
                  <span>💬</span>
                  <span>Открыть чат сделки</span>
                </button>
              )}
            </div>

            {isAuthor && task.status === 'in_progress' && (
              <button
                onClick={handleCompleteTask}
                disabled={completing}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md shadow-emerald-600/20 transition-all"
              >
                {completing ? 'Завершение...' : '✅ Подтвердить выполнение и выплатить'}
              </button>
            )}
          </div>
        </div>

        {/* Specialist Response Form */}
        {canRespond && (
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Откликнуться на задание</h3>
            <form onSubmit={handleSendResponse} className="space-y-4">
              <textarea
                rows={4}
                placeholder="Напишите, почему вы подходите для этой работы, ваш опыт и готовность начать..."
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Ваша цена (₽)</label>
                  <input
                    type="number"
                    placeholder="Например: 5000"
                    value={proposedPrice}
                    onChange={(e) => setProposedPrice(e.target.value)}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Срок выполнения (дней)</label>
                  <input
                    type="number"
                    placeholder="Например: 3"
                    value={estimatedDays}
                    onChange={(e) => setEstimatedDays(e.target.value)}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submittingResponse}
                  className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                >
                  {submittingResponse ? 'Отправка...' : 'Отправить отклик'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Responses List */}
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center justify-between">
            <span>Отклики специалистов ({responses.length})</span>
          </h3>

          {responses.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              Пока нет откликов. Будьте первым, кто откликнется!
            </div>
          ) : (
            <div className="space-y-4 divide-y divide-slate-100 dark:divide-slate-700/50">
              {responses.map((resp) => (
                <div key={resp.id} className="pt-4 first:pt-0 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 font-bold flex items-center justify-center text-sm shrink-0">
                        {resp.specialist_name ? resp.specialist_name[0].toUpperCase() : 'S'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onOpenPublicProfile(resp.specialist_id)}
                            className="font-bold text-slate-900 dark:text-white hover:underline text-sm sm:text-base text-left"
                          >
                            {resp.specialist_name || 'Специалист'}
                          </button>
                          {resp.specialist_pro && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">
                              PRO
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>⭐ {resp.specialist_rating || '5.0'}</span>
                          <span>•</span>
                          <span>{resp.specialist_completed_tasks || 0} заданий</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {resp.proposed_price && (
                        <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 block">
                          {resp.proposed_price.toLocaleString('ru-RU')} ₽
                        </span>
                      )}
                      {resp.estimated_days && (
                        <span className="text-xs text-slate-400">{resp.estimated_days} дн.</span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 pl-13">
                    {resp.text}
                  </p>

                  {isAuthor && task.status === 'open' && (
                    <div className="pl-13 flex items-center gap-3 pt-1">
                      <button
                        onClick={() => handleAssignSpecialist(resp.specialist_id)}
                        disabled={assigningId === resp.specialist_id}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        {assigningId === resp.specialist_id ? 'Назначение...' : 'Выбрать исполнителем'}
                      </button>
                      <button
                        onClick={() => onOpenPublicProfile(resp.specialist_id)}
                        className="px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                      >
                        Профиль и отзывы
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Оставить отзыв о работе</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Поставьте оценку и поделитесь впечатлениями о сотрудничестве.
            </p>

            <form onSubmit={handleSendReview} className="space-y-4">
              <div className="flex items-center justify-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setReviewRating(star)}
                    className="text-3xl transition-transform hover:scale-125 focus:outline-none"
                  >
                    {star <= reviewRating ? '⭐' : '☆'}
                  </button>
                ))}
              </div>

              <textarea
                rows={3}
                placeholder="Напишите комментарий..."
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReviewModal(false)}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
                >
                  Позже
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm shadow-md"
                >
                  Отправить отзыв
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
