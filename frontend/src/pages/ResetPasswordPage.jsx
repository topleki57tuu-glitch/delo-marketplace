import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      addToast('Пароль должен содержать минимум 8 символов', 'error');
      return;
    }
    if (password !== confirm) {
      addToast('Пароли не совпадают', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось обновить пароль');
      setDone(true);
      addToast('Пароль обновлён!', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full space-y-5 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="text-center space-y-2">
          <div className="text-4xl">🔑</div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Новый пароль</h1>
        </div>

        {!token ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ссылка недействительна — в ней нет токена. Запросите сброс пароля заново.
            </p>
            <Link to="/" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium">
              На главную
            </Link>
          </div>
        ) : done ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
              Пароль успешно обновлён. Теперь вы можете войти с новым паролем.
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm"
            >
              Перейти ко входу
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Новый пароль (от 8 символов)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Повторите пароль</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all"
            >
              {loading ? 'Сохранение...' : 'Сохранить новый пароль'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
