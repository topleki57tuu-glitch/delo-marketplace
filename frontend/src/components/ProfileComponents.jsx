import React from 'react';
import { Avatar } from './Avatar';
import { Link } from 'react-router-dom';
import { IconCatBusiness, IconTools, IconAdmin, IconCheck, IconClose, IconPin, IconStar } from '../components/icons.jsx';

/**
 * Header секция профиля с аватаром, именем, статистикой
 */
export function ProfileHeader({ user, isSpecialist, onSwitchRole, onEdit, onLogout, isEditing }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <Avatar user={user} size="2xl" className="shadow-lg" />
          {user.verified && (
            <span className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1 rounded-full shadow-md text-xs font-bold" title="Документы проверены">
              <IconCheck />
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {user.name || 'Пользователь'}
            </h1>
            {user.verified && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-1 border border-emerald-300 dark:border-emerald-700">
                <span><IconCheck /></span> Проверен
              </span>
            )}
            {user.is_pro && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 shadow-sm">
                PRO
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 font-medium">
              {isSpecialist ? <><IconTools /> Специалист</> : <><IconCatBusiness /> Заказчик</>}
            </span>
            <span><IconStar /> Рейтинг: {user.rating || '5.0'}</span>
            <span>•</span>
            <span>Завершено: {user.completed_tasks || 0}</span>
            {user.city && (
              <>
                <span>•</span>
                <span><IconPin /> {user.city}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
        <button
          onClick={onSwitchRole}
          className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs sm:text-sm font-semibold rounded-xl transition-all"
        >
          Переключить на {isSpecialist ? 'Заказчика' : 'Специалиста'}
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md transition-all"
        >
          {isEditing ? 'Закрыть редактор' : 'Редактировать профиль'}
        </button>
        <button
          onClick={onLogout}
          className="px-4 py-2.5 text-xs sm:text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

/**
 * Статистика пользователя (карточки)
 */
export function Stat({ label, value, sub }) {
  return (
    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Verification/Trust Banner
 */
export function TrustBanner({ user, verificationData, onRequestVerification }) {
  const reqStatus = verificationData?.request?.status;

  return (
    <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-6 sm:p-7 rounded-3xl shadow-md border border-indigo-900/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
      <div className="space-y-2 max-w-2xl">
        <div className="flex items-center gap-2">
          <span className="text-xl"><IconAdmin /></span>
          <h2 className="text-lg font-bold text-white">Безопасность и доверие сервиса «ДЕЛО»</h2>
        </div>
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          {user.verified
            ? 'Ваша личность подтверждена. Все ваши сделки защищены сервисом безопасных платежей (эскроу). В каталоге ваши отклики отображаются выше.'
            : 'Подтвердите личность для получения значка проверенного пользователя. Ваши отклики будут выше в каталоге, а заказчики смогут доверять вам больше.'}
        </p>
      </div>

      {!user.verified && (
        <div className="shrink-0">
          {reqStatus === 'pending' && (
            <div className="px-5 py-3 bg-amber-500/20 border border-amber-500/40 rounded-xl text-sm font-semibold text-amber-200 flex items-center gap-2">
              <span className="animate-pulse">⏳</span>
              Заявка на проверке
            </div>
          )}
          {reqStatus === 'rejected' && (
            <button
              onClick={onRequestVerification}
              className="px-5 py-3 bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 rounded-xl text-sm font-semibold text-red-200 transition-colors"
            >
              <IconClose /> Отклонено. Подать снова
            </button>
          )}
          {!reqStatus && (
            <button
              onClick={onRequestVerification}
              className="px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-sm font-bold shadow-lg transition-all"
            >
              <IconCheck /> Подтвердить личность
            </button>
          )}
        </div>
      )}
    </div>
  );
}
