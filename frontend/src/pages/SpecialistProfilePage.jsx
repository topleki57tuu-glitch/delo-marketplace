import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';

export default function SpecialistProfilePage({ user, onOpenAuth }) {
  const { specialistId } = useParams();
  const { addToast } = useToast();

  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfileData = async () => {
      try {
        const [profRes, revRes] = await Promise.all([
          fetch(`/users/${specialistId}/public`),
          fetch(`/users/${specialistId}/reviews`),
        ]);

        if (!profRes.ok) throw new Error('Специалист не найден');
        const profData = await profRes.json();
        setProfile(profData);

        if (revRes.ok) {
          const revData = await revRes.json();
          setReviews(revData);
        }
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchProfileData();
  }, [specialistId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-4xl">🔍</div>
          <h2 className="text-xl font-bold">Профиль не найден</h2>
          <Link to="/tasks" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium">
            К списку заданий
          </Link>
        </div>
      </div>
    );
  }

  let parsedSkills = [];
  try {
    if (profile.skills) parsedSkills = JSON.parse(profile.skills);
  } catch (e) {
    parsedSkills = [];
  }

  let parsedPortfolio = [];
  try {
    if (profile.portfolio) parsedPortfolio = JSON.parse(profile.portfolio);
  } catch (e) {
    parsedPortfolio = [];
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-6">
      <Link to="/tasks" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
        &larr; Назад к заданиям
      </Link>

      {/* Main Profile Header */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-extrabold text-4xl flex items-center justify-center shadow-xl shadow-indigo-500/25 shrink-0">
            {profile.name ? profile.name[0].toUpperCase() : 'U'}
          </div>

          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
                {profile.name || 'Специалист'}
              </h1>
              {profile.is_pro && (
                <span className="px-3 py-1 rounded-full text-xs font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 shadow-sm">
                  PRO
                </span>
              )}
              {profile.verified && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  ✓ Проверен
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1 font-bold text-amber-500">
                ⭐ {profile.rating ? profile.rating.toFixed(1) : '5.0'}
              </span>
              <span>•</span>
              <span>{reviews.length} отзывов</span>
              <span>•</span>
              <span>Выполнено заказов: {profile.completed_tasks || 0}</span>
              {profile.city && (
                <>
                  <span>•</span>
                  <span>📍 {profile.city}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {profile.bio && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60 text-sm sm:text-base text-slate-700 dark:text-slate-200 leading-relaxed">
            {profile.bio}
          </div>
        )}

        {/* Skills */}
        {parsedSkills.length > 0 && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Навыки и специализация</h3>
            <div className="flex flex-wrap gap-2">
              {parsedSkills.map((sk, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-full text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {sk}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Portfolio section */}
      {parsedPortfolio.length > 0 && (
        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Примеры работ (Портфолио)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {parsedPortfolio.map((item, idx) => (
              <div key={idx} className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 group">
                <img src={item.image_url || item} alt="Portfolio" className="w-full h-36 object-cover group-hover:scale-105 transition-transform" />
                {item.title && (
                  <div className="p-2 text-xs font-semibold truncate bg-slate-50 dark:bg-slate-900">{item.title}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews Section */}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white">Отзывы заказчиков ({reviews.length})</h3>

        {reviews.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">
            Отзывов пока нет.
          </div>
        ) : (
          <div className="space-y-4 divide-y divide-slate-100 dark:divide-slate-700/50">
            {reviews.map((rev) => (
              <div key={rev.id} className="pt-4 first:pt-0 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-900 dark:text-white">{rev.reviewer_name}</span>
                  <span className="text-amber-500 font-bold text-sm">{'⭐'.repeat(rev.rating)}</span>
                </div>
                {rev.task_title && (
                  <span className="text-xs text-slate-400 block">Задание: «{rev.task_title}»</span>
                )}
                {rev.comment && (
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">{rev.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
