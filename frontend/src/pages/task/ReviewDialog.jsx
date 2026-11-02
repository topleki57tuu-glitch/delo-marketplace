// Окно отзыва после завершённой сделки: оценка звёздами и комментарий.
import React, { useRef, useState } from 'react';
import { useFocusTrap, useModal } from '../../utils/a11y.js';
import { IconStar } from '../../components/icons.jsx';

export default function ReviewDialog({ open, title, text, onClose, onSubmit }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const panelRef = useRef(null);
  useModal(open, onClose);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    const ok = await onSubmit({ rating, comment: comment.trim() });
    setSending(false);
    if (ok) {
      setComment('');
      setRating(5);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-pop p-5 sm:p-6"
      >
        <h2 id="review-title" className="text-lg font-extrabold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{text}</p>

        <div role="radiogroup" aria-label="Оценка" className="mt-5 flex items-center justify-center gap-1.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={star === rating}
              aria-label={`${star} из 5`}
              onClick={() => setRating(star)}
              className={`p-1 rounded-lg transition-transform hover:scale-110 ${star <= rating ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'}`}
            >
              <IconStar size={32} fill={star <= rating ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>

        <label htmlFor="review-comment" className="sr-only">Комментарий</label>
        <textarea
          id="review-comment"
          rows={3}
          placeholder="Что понравилось, что можно улучшить..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="textarea mt-5"
        />

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Позже
          </button>
          <button type="submit" disabled={sending} className="btn btn-primary">
            {sending ? 'Отправка...' : 'Отправить отзыв'}
          </button>
        </div>
      </form>
    </div>
  );
}
