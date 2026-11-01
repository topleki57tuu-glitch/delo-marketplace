import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { IconCheck, IconKey } from '../components/icons.jsx';

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
    <section className="hero-band min-h-[75vh] flex items-center">
      <div className="relative w-full max-w-md mx-auto px-4 py-12 sm:py-16">
        <div className="text-center mb-6">
          <span className="hero-eyebrow mb-4">
            <IconKey size={14} className="text-amber-300" /> Восстановление доступа
          </span>
          <h1 className="hero-title">Новый пароль</h1>
        </div>

        <div className="card p-6 sm:p-8 shadow-pop">
          {!token ? (
            <div className="text-center space-y-5">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Ссылка недействительна — в ней нет токена. Запросите сброс пароля заново.
              </p>
              <Link to="/" className="btn btn-primary w-full">
                На главную
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-5">
              <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                <IconCheck size={22} />
              </span>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 font-semibold">
                Пароль успешно обновлён. Теперь вы можете войти с новым паролем.
              </p>
              <button type="button" onClick={() => navigate('/')} className="btn btn-primary w-full">
                Перейти ко входу
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-password" className="field-label">Новый пароль (от 8 символов)</label>
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div>
                <label htmlFor="reset-confirm" className="field-label">Повторите пароль</label>
                <input
                  id="reset-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="btn btn-primary w-full !py-3">
                {loading ? 'Сохранение...' : 'Сохранить новый пароль'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
