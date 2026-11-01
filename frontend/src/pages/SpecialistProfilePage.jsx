import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDocumentTitle } from '../components/RouteMeta.jsx';
import PageHero, { HeroAvatar, PageBody } from '../components/PageHero.jsx';
import { ErrorState, Spinner, StateCard } from '../components/PageState.jsx';
import {
  IconBriefcase,
  IconCheck,
  IconEdit,
  IconLock,
  IconPin,
  IconSearch,
  IconStar,
  IconUser,
} from '../components/icons.jsx';
import { lastSeenLabel, parseList } from '../utils/format.js';

function Stars({ value, size = 14 }) {
  const rating = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-400" role="img" aria-label={`Оценка ${rating} из 5`}>
      {Array.from({ length: 5 }, (_, i) =>
        i < rating ? (
          <IconStar key={i} size={size} fill="currentColor" />
        ) : (
          <IconStar key={i} size={size} className="text-slate-300 dark:text-slate-600" />
        )
      )}
    </span>
  );
}

function Section({ eyebrow, title, children, className = '' }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
      {title && <h2 className="section-title mt-1 mb-4">{title}</h2>}
      {children}
    </section>
  );
}

export default function SpecialistProfilePage({ user, onOpenAuth }) {
  const { specialistId } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | not-found | error

  useDocumentTitle(profile && String(profile.id) === String(specialistId) ? profile.name || 'Специалист' : null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [profRes, revRes] = await Promise.all([
        fetch(`/users/${specialistId}/public`),
        fetch(`/users/${specialistId}/reviews`),
      ]);
      if (profRes.status === 404 || profRes.status === 422) {
        setProfile(null);
        setStatus('not-found');
        return;
      }
      if (!profRes.ok) throw new Error('profile');
      setProfile(await profRes.json());
      setReviews(revRes.ok ? await revRes.json() : []);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
    }
  }, [specialistId]);

  useEffect(() => {
    load();
  }, [load]);

  const back = { to: '/specialists', label: 'Все специалисты' };

  if (status !== 'ready' || !profile) {
    const notFound = status === 'not-found';
    return (
      <>
        <PageHero
          width="medium"
          size="sm"
          back={back}
          eyebrow="Профиль"
          icon={IconUser}
          title={status === 'loading' ? null : notFound ? 'Профиль не найден' : 'Профиль недоступен'}
        />
        <PageBody width="medium">
          {status === 'loading' ? (
            <Spinner label="Загрузка профиля..." />
          ) : notFound ? (
            <StateCard
              icon={IconSearch}
              title="Такого пользователя нет"
              text="Возможно, ссылка устарела или профиль удалён."
            >
              <Link to="/specialists" className="btn btn-primary">Все специалисты</Link>
              <Link to="/tasks" className="btn btn-secondary">К заданиям</Link>
            </StateCard>
          ) : (
            <ErrorState text="Не удалось загрузить профиль. Проверьте соединение и попробуйте ещё раз." onRetry={load} />
          )}
        </PageBody>
      </>
    );
  }

  const isSpecialist = profile.role !== 'customer';
  const isOwn = user && String(user.id) === String(profile.id);
  const skills = parseList(profile.skills);
  let portfolio = [];
  try {
    portfolio = profile.portfolio ? JSON.parse(profile.portfolio) : [];
    if (!Array.isArray(portfolio)) portfolio = [];
  } catch (e) {
    portfolio = [];
  }
  const reviewsCount = reviews.length || profile.reviews_count || 0;
  const presence = profile.online ? 'в сети' : lastSeenLabel(profile.last_seen);

  const offerTask = () => (user ? navigate('/create-task') : onOpenAuth?.('register'));

  return (
    <>
      <PageHero
        width="medium"
        back={back}
        media={<HeroAvatar src={profile.avatar} name={profile.name} fallback="С" online={!!profile.online} verified={!!profile.verified} />}
        eyebrow={isSpecialist ? 'Специалист' : 'Заказчик'}
        icon={isSpecialist ? IconBriefcase : IconUser}
        title={profile.name || (isSpecialist ? 'Специалист' : 'Заказчик')}
        titleClassName="hero-title-sm"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            {profile.is_pro && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950">
                PRO
              </span>
            )}
            {profile.verified && (
              <span className="inline-flex items-center gap-1 font-semibold text-sky-300">
                <IconCheck size={14} /> Проверен
              </span>
            )}
            {profile.city && (
              <span className="inline-flex items-center gap-1">
                <IconPin size={14} /> {profile.city}
              </span>
            )}
            {presence && (
              <span className={`inline-flex items-center gap-1.5 ${profile.online ? 'text-emerald-300 font-semibold' : 'text-slate-400'}`}>
                {profile.online && <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />}
                {presence}
              </span>
            )}
          </div>
        }
        aside={
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="hero-stat">
                <p className="hero-stat-label">Рейтинг</p>
                <p className="hero-stat-value inline-flex items-center gap-1">
                  <IconStar size={16} fill="currentColor" className="text-amber-300" />
                  {profile.rating != null ? Number(profile.rating).toFixed(1) : '—'}
                </p>
              </div>
              <div className="hero-stat">
                <p className="hero-stat-label">Отзывы</p>
                <p className="hero-stat-value">{reviewsCount}</p>
              </div>
              <div className="hero-stat">
                <p className="hero-stat-label">{isSpecialist ? 'Выполнено' : 'Завершено'}</p>
                <p className="hero-stat-value">{profile.completed_tasks || 0}</p>
              </div>
            </div>
            {isOwn ? (
              <Link to="/profile" className="btn btn-glass w-full">
                <IconEdit /> Редактировать профиль
              </Link>
            ) : isSpecialist ? (
              <button type="button" className="btn btn-cta w-full" onClick={offerTask}>
                + Предложить задание
              </button>
            ) : null}
          </div>
        }
      />

      <PageBody width="medium">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
          <div className="space-y-5 min-w-0">
            <Section eyebrow="О себе" title={isSpecialist ? 'Чем занимается' : 'О заказчике'}>
              {profile.bio ? (
                <p className="text-[0.9375rem] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line">{profile.bio}</p>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Пользователь пока ничего о себе не рассказал.</p>
              )}
            </Section>

            {portfolio.length > 0 && (
              <Section eyebrow="Портфолио" title="Примеры работ">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {portfolio.map((item, idx) => {
                    const src = typeof item === 'string' ? item : item?.image_url;
                    const caption = typeof item === 'object' ? item?.title : null;
                    if (!src) return null;
                    return (
                      <a
                        key={idx}
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                      >
                        <img src={src} alt={caption || `Работа ${idx + 1}`} loading="lazy" className="w-full h-32 sm:h-36 object-cover group-hover:scale-105 transition-transform" />
                        {caption && <span className="block px-2.5 py-2 text-xs font-semibold truncate text-slate-700 dark:text-slate-200">{caption}</span>}
                      </a>
                    );
                  })}
                </div>
              </Section>
            )}

            <Section eyebrow="Отзывы" title={isSpecialist ? `Отзывы заказчиков · ${reviewsCount}` : `Отзывы исполнителей · ${reviewsCount}`}>
              {reviews.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Отзывов пока нет. Они появляются после завершённых сделок.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {reviews.map((rev) => (
                    <li key={rev.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-9 h-9 shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-sm font-bold flex items-center justify-center overflow-hidden">
                            {rev.reviewer_avatar ? (
                              <img src={rev.reviewer_avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (rev.reviewer_name || '?')[0].toUpperCase()
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{rev.reviewer_name}</p>
                            {rev.task_title && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {rev.task_id ? (
                                  <Link to={`/tasks/${rev.task_id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                                    «{rev.task_title}»
                                  </Link>
                                ) : (
                                  `«${rev.task_title}»`
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                        <Stars value={rev.rating} />
                      </div>
                      {rev.comment && (
                        <p className="mt-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{rev.comment}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <aside className="space-y-5">
            {skills.length > 0 && (
              <Section eyebrow="Навыки" className="!p-5">
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {skills.map((sk, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700/70 rounded-full text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {sk}
                    </span>
                  ))}
                </div>
              </Section>
            )}
            <div className="rounded-2xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/70 dark:bg-indigo-500/10 p-5">
              <p className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <IconLock size={16} className="text-indigo-600 dark:text-indigo-300" /> Безопасная сделка
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Оплата хранится на площадке и переходит исполнителю только после того, как заказчик примет работу.
                Если что-то пойдёт не так — откройте спор, его рассмотрит модератор.
              </p>
              <Link to="/help" className="mt-3 inline-flex text-sm font-semibold text-indigo-600 dark:text-indigo-300 hover:underline">
                Как это работает →
              </Link>
            </div>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
