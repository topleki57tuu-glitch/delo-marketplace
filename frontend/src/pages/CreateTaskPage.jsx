import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CityInput from '../components/CityInput';
import { ImageUploader } from '../components/ImageUploader';
import { AITaskAssistant } from '../components/AITaskAssistant';
import { useToast } from '../components/Toast';

const CATEGORIES = [
  { id: 'development', label: 'Разработка сайтов и IT', icon: '💻' },
  { id: 'design', label: 'Дизайн и графика', icon: '🎨' },
  { id: 'repairs', label: 'Ремонт и строительство', icon: '🔨' },
  { id: 'cleaning', label: 'Уборка и клининг', icon: '✨' },
  { id: 'delivery', label: 'Курьеры и доставка', icon: '🚚' },
  { id: 'photo_video', label: 'Фото и видеосъемка', icon: '📷' },
  { id: 'tutoring', label: 'Репетиторы и обучение', icon: '📚' },
  { id: 'beauty', label: 'Красота и здоровье', icon: '💅' },
  { id: 'events', label: 'Мероприятия и промо', icon: '🎉' },
  { id: 'business', label: 'Бизнес и юридические услуги', icon: '💼' },
  { id: 'other', label: 'Другое', icon: '📦' },
];

export default function CreateTaskPage({ user, token, onOpenAuth, onTaskCreated }) {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('development');
  const [budget, setBudget] = useState('');
  const [isRemote, setIsRemote] = useState(false);
  const [selectedCity, setSelectedCity] = useState(null);
  const [address, setAddress] = useState('');
  const [deadline, setDeadline] = useState('');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 max-w-md w-full p-8 rounded-2xl border border-slate-200 dark:border-slate-700 text-center space-y-4 shadow-xl">
          <div className="text-4xl">🔒</div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Требуется авторизация</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Чтобы опубликовать задание, войдите в аккаунт заказчика или зарегистрируйтесь.
          </p>
          <button
            onClick={() => onOpenAuth('login')}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20"
          >
            Войти в аккаунт
          </button>
        </div>
      </div>
    );
  }

  const handleApplyAiSuggestion = (suggestion) => {
    if (suggestion.title) setTitle(suggestion.title);
    if (suggestion.description) setDescription(suggestion.description);
    if (suggestion.category) setCategory(suggestion.category);
    if (suggestion.budget) setBudget(String(suggestion.budget));
    addToast('ТЗ успешно сформировано AI-помощником!', 'success');
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
        city: isRemote ? null : selectedCity ? selectedCity.name : null,
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
        throw new Error(data.detail || 'Ошибка при создании задания');
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Создать новое задание
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Опишите, что нужно сделать, и специалисты предложат свои услуги
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAiModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl text-sm shadow-md shadow-indigo-500/20 flex items-center gap-2 transition-all"
          >
            <span>✨</span>
            <span>Помощь AI-ассистента</span>
          </button>
        </div>

        {/* Task Form */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
          {/* Category */}
          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
              Категория задания
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
              Название задания *
            </label>
            <input
              type="text"
              placeholder="Например: Разработать адаптивный лендинг для кофейни"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
              Подробное описание задачи *
            </label>
            <textarea
              rows={5}
              placeholder="Опишите все детали, требования, желаемый результат и условия..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              required
            />
          </div>

          {/* Budget & Deadline Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                Бюджет (₽)
              </label>
              <input
                type="number"
                placeholder="Оставьте пустым для договорной цены"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                Срок выполнения (дата)
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Location & Remote */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700/60 space-y-4">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRemote}
                onChange={(e) => setIsRemote(e.target.checked)}
                className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-semibold text-sm">Удаленная работа (онлайн по всей стране)</span>
            </label>

            {!isRemote && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Город</label>
                  <CityInput
                    selectedCity={selectedCity}
                    onSelectCity={(city) => setSelectedCity(city)}
                    placeholder="Выберите город"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Улица, дом (необязательно)</label>
                  <input
                    type="text"
                    placeholder="ул. Ленина, д. 10"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Photos / Images */}
          <div>
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
              Фотографии и материалы (до 5 шт.)
            </label>
            <ImageUploader
              images={images}
              token={token}
              onChange={(newImgs) => setImages(newImgs)}
            />
          </div>

          {/* Submit Button */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/tasks')}
              className="px-5 py-3 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Публикация...</span>
                </>
              ) : (
                <span>Опубликовать задание</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* AI Assistant Modal */}
      {showAiModal && (
        <AITaskAssistant
          onClose={() => setShowAiModal(false)}
          onApplySuggestion={handleApplyAiSuggestion}
          token={token}
        />
      )}
    </div>
  );
}
