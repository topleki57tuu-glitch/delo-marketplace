import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CityInput from '../components/CityInput';
import { ImageUploader } from '../components/ImageUploader';
import { AITaskAssistant } from '../components/AITaskAssistant';
import { useToast } from '../components/Toast';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { AuthRequired } from '../components/PageState.jsx';
import { IconCatBeauty, IconCatBusiness, IconCatCleaning, IconCatDelivery, IconCatDesign, IconCatDevelopment, IconCatEvents, IconCatOther, IconCatPhotoVideo, IconCatRepairs, IconCatTutoring, IconCatWriting, IconBriefcase, IconLock, IconSparkles } from '../components/icons.jsx';
import { apiErrorMessage } from '../utils/apiError';

const CATEGORIES = [
  { id: 'development', label: 'Разработка сайтов и IT', icon: <IconCatDevelopment /> },
  { id: 'design', label: 'Дизайн и графика', icon: <IconCatDesign /> },
  { id: 'writing', label: 'Тексты и переводы', icon: <IconCatWriting /> },
  { id: 'repairs', label: 'Ремонт и строительство', icon: <IconCatRepairs /> },
  { id: 'cleaning', label: 'Уборка и клининг', icon: <IconCatCleaning /> },
  { id: 'delivery', label: 'Курьеры и доставка', icon: <IconCatDelivery /> },
  { id: 'photo_video', label: 'Фото и видеосъемка', icon: <IconCatPhotoVideo /> },
  { id: 'tutoring', label: 'Репетиторы и обучение', icon: <IconCatTutoring /> },
  { id: 'beauty', label: 'Красота и здоровье', icon: <IconCatBeauty /> },
  { id: 'events', label: 'Мероприятия и промо', icon: <IconCatEvents /> },
  { id: 'business', label: 'Бизнес и юридические услуги', icon: <IconCatBusiness /> },
  { id: 'other', label: 'Другое', icon: <IconCatOther /> },
];

// Сегодняшняя дата по часам пользователя — нижняя граница поля «Срок»
// (сервер прошедшую дату не примет, app/schemas: TaskCreate).
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CreateTaskPage({ user, token, onOpenAuth, onTaskCreated }) {
  const navigate = useNavigate();
  const { addToast } = useToast();

  // ?title= приходит из поиска на главной: «Что нужно сделать?» → сюда.
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState(() => (searchParams.get('title') || '').slice(0, 200));
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('development');
  const [budget, setBudget] = useState('');
  const [isRemote, setIsRemote] = useState(false);
  const [selectedCity, setSelectedCity] = useState('');
  const [address, setAddress] = useState('');
  const [deadline, setDeadline] = useState('');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const handleApplyAiSuggestion = (suggestion) => {
    // Поля ответа бэкенда — suggested_* (см. backend/app/api/ai.py)
    if (suggestion.suggested_title) setTitle(suggestion.suggested_title);
    if (suggestion.suggested_description) setDescription(suggestion.suggested_description);
    if (suggestion.suggested_category) setCategory(suggestion.suggested_category);
    if (suggestion.suggested_budget) setBudget(String(suggestion.suggested_budget));
    addToast('ТЗ успешно сформировано AI-помощником!', 'success');
    setShowAiModal(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      addToast('Заполните название и описание задания', 'error');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        category,
        budget: budget ? parseInt(budget, 10) : null,
        is_remote: isRemote,
        city: isRemote ? null : selectedCity.trim() || null,
        address: isRemote ? null : address.trim() || null,
        deadline: deadline || null,
        images: images.length > 0 ? JSON.stringify(images) : null,
      };

      const res = await fetch('/tasks/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, 'Ошибка при создании задания'));
      }

      addToast('Задание успешно создано!', 'success');
      if (onTaskCreated) onTaskCreated();
      navigate(`/tasks/${data.task_id}`);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const hero = (
    <PageHero
      width="medium"
      size="sm"
      back={{ to: '/tasks', label: 'Все задания' }}
      eyebrow="Новое задание"
      icon={IconBriefcase}
      title="Создать задание"
      subtitle="Опишите, что нужно сделать, — специалисты сами предложат цену и сроки."
      actions={
        user ? (
          <button type="button" onClick={() => setShowAiModal(true)} className="btn btn-glass">
            <IconSparkles className="text-amber-300" /> Помощь AI-ассистента
          </button>
        ) : null
      }
    />
  );

  if (!user) {
    return (
      <>
        {hero}
        <PageBody width="medium">
          <AuthRequired
            onOpenAuth={onOpenAuth}
            text="Чтобы опубликовать задание, войдите в аккаунт заказчика или зарегистрируйтесь."
          />
        </PageBody>
      </>
    );
  }

  const section = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6';
  const label = 'block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5';

  return (
    <>
      {hero}
      <PageBody width="medium">
        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] items-start">
          <div className="space-y-6 min-w-0">
            <section className={section}>
              <h2 className="section-title">Что нужно сделать</h2>
              <div className="mt-5 space-y-5">
                <div>
                  <label htmlFor="task-category" className={label}>Категория задания</label>
                  <select id="task-category" value={category} onChange={(e) => setCategory(e.target.value)} className="select">
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="task-title" className={label}>
                    Название задания <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    placeholder="Например: Разработать адаптивный лендинг для кофейни"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    className="input"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="task-description" className={label}>
                    Подробное описание задачи <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="task-description"
                    rows={6}
                    placeholder="Опишите все детали, требования, желаемый результат и условия..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="textarea"
                    maxLength={5000}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="task-budget" className={label}>Бюджет, ₽</label>
                    <input
                      id="task-budget"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="10000000"
                      placeholder="Оставьте пустым для договорной цены"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label htmlFor="task-deadline" className={label}>Срок выполнения</label>
                    <input
                      id="task-deadline"
                      type="date"
                      min={todayISO()}
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className={section}>
              <h2 className="section-title">Где выполнить</h2>
              <label className="mt-4 flex items-center gap-3 cursor-pointer select-none rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <input
                  type="checkbox"
                  checked={isRemote}
                  onChange={(e) => setIsRemote(e.target.checked)}
                  className="w-5 h-5 rounded accent-indigo-600"
                />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Удалённая работа — онлайн, по всей стране</span>
              </label>

              {!isRemote && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5">
                  <div>
                    <span className={label}>Город</span>
                    <CityInput
                      value={selectedCity}
                      onChange={setSelectedCity}
                      placeholder="Выберите город"
                    />
                  </div>
                  <div>
                    <label htmlFor="task-address" className={label}>Улица, дом (необязательно)</label>
                    <input
                      id="task-address"
                      type="text"
                      placeholder="ул. Ленина, д. 10"
                      maxLength={200}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      aria-describedby="task-address-hint"
                      className="input"
                    />
                    {/* Обещание держит backend: app/api/tasks.py, _public_task */}
                    <p id="task-address-hint" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                      Увидит только исполнитель, которого вы выберете. Остальным — город и район.
                    </p>
                  </div>
                </div>
              )}
            </section>

            <section className={section}>
              <h2 className="section-title">Фотографии и материалы</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">До 5 файлов: фото места работ, пример, техническое задание.</p>
              <div className="mt-4">
                <ImageUploader images={images} token={token} onChange={(newImgs) => setImages(newImgs)} maxImages={5} />
              </div>
            </section>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" onClick={() => navigate('/tasks')} className="btn btn-secondary">
                Отмена
              </button>
              <button type="submit" disabled={loading} className="btn btn-cta !px-7 !py-3">
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    Публикация...
                  </>
                ) : (
                  'Опубликовать задание'
                )}
              </button>
            </div>
          </div>

          <aside className="rounded-2xl border border-indigo-100 dark:border-indigo-500/25 bg-indigo-50/60 dark:bg-indigo-500/10 p-5 lg:sticky lg:top-24">
            <p className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
              <IconLock size={16} className="text-indigo-600 dark:text-indigo-300" /> Безопасная сделка
            </p>
            <ol className="mt-4 space-y-3">
              {[
                'Специалисты откликаются со своей ценой и сроками',
                'Вы выбираете исполнителя — бюджет резервируется на эскроу',
                'Исполнитель сдаёт работу',
                'Деньги переходят ему только после вашего подтверждения',
              ].map((step, i) => (
                <li key={step} className="flex gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </aside>
        </form>
      </PageBody>

      {/* AI Assistant Modal */}
      {showAiModal && (
        <AITaskAssistant
          onClose={() => setShowAiModal(false)}
          onApplySuggestion={handleApplyAiSuggestion}
          currentTask={{ budget }}
        />
      )}
    </>
  );
}
