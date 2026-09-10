import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';

export default function DisputesPage({ user, token, onOpenAuth }) {
  const { addToast } = useToast();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [comments, setComments] = useState({});

  const fetchDisputes = async () => {
    setLoading(true);
    try {
      const res = await fetch('/admin/disputes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error('Не удалось загрузить споры');
      const data = await res.json();
      setDisputes(data.disputes || []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchDisputes();
    else setLoading(false);
  }, [token]);

  const handleResolve = async (disputeId, decision) => {
    const decisionText = decision === 'refund_customer'
      ? 'вернуть средства заказчику'
      : 'выплатить средства исполнителю';
    if (!window.confirm(`Подтвердите решение: ${decisionText}?`)) return;

    setResolvingId(disputeId + decision);
    try {
      const res = await fetch(`/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision, comment: comments[disputeId] || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка при вынесении решения');
      addToast(data.message || 'Спор закрыт', 'success');
      fetchDisputes();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setResolvingId(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-4xl">⚖️</div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Арбитраж споров</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Войдите под учётной записью арбитра</p>
          <button
            onClick={() => onOpenAuth('login')}
            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl"
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-4xl">🔒</div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Нет доступа</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Эта страница доступна только арбитрам платформы.
          </p>
          <Link to="/tasks" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium">
            К списку заданий
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          ⚖️ Арбитраж споров
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Открытых споров: <span className="font-semibold text-red-600 dark:text-red-400">{disputes.length}</span>
        </p>
      </div>

      {disputes.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl border border-slate-200 dark:border-slate-700 text-center space-y-3">
          <div className="text-4xl">🎉</div>
          <p className="font-bold text-slate-900 dark:text-white">Открытых споров нет</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Все сделки идут без конфликтов.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((d) => (
            <div
              key={d.id}
              className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-red-200 dark:border-red-900/50 shadow-sm space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <Link
                    to={`/tasks/${d.task_id}`}
                    className="text-lg font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline"
                  >
                    {d.task_title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span>💼 {d.customer_name}</span>
                    <span>→</span>
                    <span>🛠️ {d.executor_name}</span>
                    <span>•</span>
                    <span>Спор открыл: <b>{d.opened_by_name}</b></span>
                  </div>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <span className="text-xs text-slate-400 block">Сумма эскроу</span>
                  <span className="text-xl font-extrabold text-amber-600 dark:text-amber-400">
                    {d.budget ? `${d.budget.toLocaleString('ru-RU')} ₽` : '—'}
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-300">
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Причина спора</span>
                {d.reason}
              </div>

              <textarea
                rows={2}
                placeholder="Комментарий арбитра (виден обеим сторонам)..."
                value={comments[d.id] || ''}
                onChange={(e) => setComments({ ...comments, [d.id]: e.target.value })}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  onClick={() => handleResolve(d.id, 'refund_customer')}
                  disabled={!!resolvingId}
                  className="px-5 py-2.5 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-xl text-sm shadow-md disabled:opacity-50 transition-all"
                >
                  {resolvingId === d.id + 'refund_customer' ? 'Обработка...' : '↩ Вернуть заказчику'}
                </button>
                <button
                  onClick={() => handleResolve(d.id, 'pay_specialist')}
                  disabled={!!resolvingId}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md disabled:opacity-50 transition-all"
                >
                  {resolvingId === d.id + 'pay_specialist' ? 'Обработка...' : '💸 Выплатить исполнителю'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
