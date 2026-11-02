// Вкладка «Профиль» личного кабинета: анкета (просмотр и редактирование),
// портфолио специалиста, проверка личности и переключение режима.
// Черновик анкеты приходит из страницы (useProfileForm), окно подачи
// документов тоже открывает страница.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { useDialogs } from '../../components/DialogProvider.jsx';
import CityInput from '../../components/CityInput';
import { PortfolioUploader } from '../../components/ImageUploader';
import { AvatarUploader } from '../../components/Avatar';
import { parseList } from '../../utils/format.js';
import { useAuthStore } from '../../store/authStore';
import { IconAdmin, IconCheck, IconEdit, IconEye, IconRecycle, IconRefresh } from '../../components/icons.jsx';
import { EmptyLine, Panel } from './profileShared.jsx';
import { apiErrorMessage } from '../../utils/apiError';

export default function ProfileTab({ user, token, form, verificationData, onOpenVerify, onUpdateUser }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [switchingRole, setSwitchingRole] = useState(false);
  const {
    isEditing, setIsEditing,
    name, setName,
    bio, setBio,
    city, setCity,
    phone, setPhone,
    skills, setSkills,
    saving,
    handleSaveProfile,
  } = form;
  const isSpecialist = user.role === 'specialist';
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const parsePortfolio = () => {
    try {
      const items = user?.portfolio ? JSON.parse(user.portfolio) : [];
      return Array.isArray(items) ? items : [];
    } catch (e) {
      return [];
    }
  };

  const savePortfolio = async (items) => {
    try {
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ portfolio: JSON.stringify(items) }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить портфолио');
      onUpdateUser();
      return true;
    } catch (err) {
      addToast(err.message, 'error');
      return false;
    }
  };

  const handlePortfolioAdd = async (url) => {
    if (await savePortfolio([...parsePortfolio(), url])) addToast('Работа добавлена в портфолио', 'success');
  };

  const handlePortfolioDelete = async (idx) => {
    const ok = await dialogs.confirm({ title: 'Удалить работу из портфолио?', confirmText: 'Удалить', danger: true });
    if (!ok) return;
    if (await savePortfolio(parsePortfolio().filter((_, i) => i !== idx))) addToast('Работа удалена из портфолио', 'success');
  };

  const handleSwitchRole = async () => {
    const toSpecialist = !isSpecialist;
    const ok = await dialogs.confirm({
      title: toSpecialist ? 'Перейти в режим специалиста?' : 'Перейти в режим заказчика?',
      message: toSpecialist
        ? 'Вы сможете откликаться на задания и продавать услуги. Вернуться в режим заказчика можно в любой момент.'
        : 'Вы сможете публиковать задания и выбирать исполнителей. Вернуться в режим специалиста можно в любой момент.',
      confirmText: 'Переключить',
    });
    if (!ok) return;
    setSwitchingRole(true);
    try {
      const res = await fetch('/users/me/switch-role', {
        method: 'POST',
        headers: auth,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Не удалось переключить роль'));

      if (data.token) {
        const { login } = useAuthStore.getState();
        login(data.token, data.role);
      }

      addToast(`Теперь вы ${data.role === 'specialist' ? 'специалист' : 'заказчик'}`, 'success');
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSwitchingRole(false);
    }
  };

  const reqStatus = verificationData?.request?.status;
  const portfolio = parsePortfolio();
  const userSkills = parseList(user.skills);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
      <div className="space-y-5 min-w-0">
        {isEditing ? (
          <Panel eyebrow="Анкета" title="Редактирование профиля">
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="pb-4 border-b border-slate-100 dark:border-slate-700/70">
                <p className="field-label">Фото профиля</p>
                <AvatarUploader currentAvatar={user.avatar} onAvatarUpdate={onUpdateUser} token={token} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pf-name" className="field-label">Имя</label>
                  <input id="pf-name" type="text" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="input" />
                </div>
                <div>
                  <label htmlFor="pf-phone" className="field-label">Телефон</label>
                  <input
                    id="pf-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={30}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 900 000-00-00"
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="pf-city" className="field-label">Город</label>
                <CityInput
                  id="pf-city"
                  value={typeof city === 'object' && city ? city.name : city || ''}
                  onChange={setCity}
                  placeholder="Любой город России"
                />
              </div>
              <div>
                <label htmlFor="pf-bio" className="field-label">О себе</label>
                <textarea
                  id="pf-bio"
                  rows={4}
                  maxLength={2000}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={isSpecialist ? 'Опыт, чем занимаетесь, в какое время на связи' : 'Пара слов о себе — исполнителям проще откликаться'}
                  className="textarea"
                />
              </div>
              {isSpecialist && (
                <div>
                  <label htmlFor="pf-skills" className="field-label">Навыки</label>
                  <input
                    id="pf-skills"
                    type="text"
                    maxLength={500}
                    value={skills}
                    onChange={(e) => setSkills(e.target.value)}
                    placeholder="Например: сантехника, электрика, сборка мебели"
                    className="input"
                  />
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Через запятую — по ним вас находят в каталоге специалистов.</p>
                </div>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsEditing(false)} className="btn btn-secondary">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </Panel>
        ) : (
          <Panel
            eyebrow="Анкета"
            title="О себе"
            action={
              <>
                <Link to={`/specialist/${user.id}`} className="btn btn-ghost !px-3 !py-2">
                  <IconEye size={16} /> Как видят другие
                </Link>
                <button type="button" onClick={() => setIsEditing(true)} className="btn btn-secondary !px-3 !py-2">
                  <IconEdit size={16} /> Редактировать
                </button>
              </>
            }
          >
            {user.bio ? (
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line break-words">{user.bio}</p>
            ) : (
              <EmptyLine>
                {isSpecialist
                  ? 'Расскажите об опыте и о том, за какие задачи беретесь, — заказчики читают это перед выбором исполнителя.'
                  : 'Пара слов о себе помогает исполнителям быстрее откликаться.'}
              </EmptyLine>
            )}
            <dl className="mt-5 grid gap-3 sm:grid-cols-3 text-sm">
              {[
                ['Email', user.email],
                ['Телефон', user.phone],
                ['Город', user.city],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3.5 py-2.5 min-w-0">
                  <dt className="text-xs font-semibold text-slate-400">{label}</dt>
                  <dd className={`mt-0.5 font-semibold truncate ${value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>
                    {value || 'не указан'}
                  </dd>
                </div>
              ))}
            </dl>
            {isSpecialist && (
              <div className="mt-5">
                <p className="text-xs font-semibold text-slate-400 mb-2">Навыки</p>
                {userSkills.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {userSkills.map((s) => (
                      <span key={s} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Не указаны — добавьте их в редакторе профиля.</p>
                )}
              </div>
            )}
          </Panel>
        )}

        {isSpecialist && (
          <section className="card p-5 sm:p-6">
            <PortfolioUploader
              token={token}
              portfolio={portfolio}
              onUploadSuccess={handlePortfolioAdd}
              onDelete={handlePortfolioDelete}
            />
          </section>
        )}
      </div>

      <aside className="space-y-5">
        <Panel eyebrow="Доверие" title="Проверка личности">
          {user.verified ? (
            <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <IconCheck size={16} className="mt-0.5 shrink-0" />
              Личность подтверждена — в анкете стоит знак «Проверен».
            </p>
          ) : reqStatus === 'pending' ? (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-sm text-amber-800 dark:text-amber-300">
              <IconRefresh size={16} className="mt-0.5 shrink-0" />
              Заявка на проверке. Обычно это занимает до 2 часов.
            </p>
          ) : (
            <>
              {reqStatus === 'rejected' && (
                <p className="mb-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-300">
                  Заявка отклонена: «{verificationData?.request?.rejection_reason || 'уточните данные'}». Исправьте данные и отправьте снова.
                </p>
              )}
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Паспорт или статус самозанятого — и в анкете появится знак «Проверен». Таким пользователям доверяют больше.
              </p>
              <button type="button" onClick={onOpenVerify} className="btn btn-primary w-full mt-4">
                <IconAdmin size={16} /> {reqStatus === 'rejected' ? 'Подать заново' : 'Пройти проверку'}
              </button>
            </>
          )}
        </Panel>

        <Panel eyebrow="Режим" title={isSpecialist ? 'Вы — специалист' : 'Вы — заказчик'}>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isSpecialist
              ? 'Нужно что-то сделать самим? Переключитесь в режим заказчика и опубликуйте задание.'
              : 'Хотите зарабатывать на своих навыках? В режиме специалиста можно откликаться на задания и продавать услуги.'}
          </p>
          <button type="button" onClick={handleSwitchRole} disabled={switchingRole} className="btn btn-secondary w-full mt-4">
            <IconRecycle size={16} />
            {switchingRole ? 'Переключаем...' : isSpecialist ? 'Стать заказчиком' : 'Стать специалистом'}
          </button>
        </Panel>
      </aside>
    </div>
  );
}
