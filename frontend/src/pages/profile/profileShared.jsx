// Общие части личного кабинета: справочники статусов, форматирование
// сумм и дат, карточка раздела и диалог подачи документов на проверку.
// Ими пользуются и страница профиля, и вынесенные из неё вкладки.
import React, { useState } from 'react';
import { useFocusTrap, useModal } from '../../utils/a11y.js';
import { parseServerDate } from '../../utils/format.js';
import { IconBank, IconClose, IconLock, IconPayout, IconPurchases, IconRecycle, IconWallet } from '../../components/icons.jsx';

export const TX_TYPES = {
  deposit: { label: 'Пополнение', icon: IconWallet },
  escrow_hold: { label: 'Заморозка по сделке', icon: IconLock },
  escrow_release: { label: 'Выплата по сделке', icon: IconPayout },
  escrow_refund: { label: 'Возврат по сделке', icon: IconRecycle },
  purchase: { label: 'Покупка пакета', icon: IconPurchases },
  withdraw_hold: { label: 'Вывод средств (заявка)', icon: IconBank },
  withdraw_refund: { label: 'Возврат заявки на вывод', icon: IconRecycle },
};

export const WITHDRAWAL_STATUS = {
  pending:   { label: 'Ожидает',   cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  paid:      { label: 'Выплачено', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  rejected:  { label: 'Отклонено', cls: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  cancelled: { label: 'Отменено',  cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

export const VERIFICATION_STATUS = {
  approved: { label: 'Одобрено', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  rejected: { label: 'Отклонено', cls: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  pending: { label: 'Ожидает', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
};

export const PACKAGES = {
  resp_10: { title: '10 откликов', price: 190 },
  pro_1: { title: 'PRO на месяц', price: 590 },
  pro_3: { title: 'PRO на 3 месяца', price: 1490 },
};

export const rub = (value) => `${(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
export const dateTime = (value) =>
  parseServerDate(value)?.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) || '';
export const longDate = (value) =>
  parseServerDate(value)?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) || null;

export function Panel({ eyebrow, title, text, action, children, className = '', id }) {
  return (
    <section id={id} className={`card p-5 sm:p-6 ${className}`}>
      {(eyebrow || title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
            {title && <h2 className="section-title mt-1">{title}</h2>}
            {text && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{text}</p>}
          </div>
          {action && <div className="flex flex-wrap gap-2 max-w-full">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyLine({ children }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-7 text-center text-sm text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

export function VerifyDialog({ open, defaultName, onClose, onSubmit }) {
  const [fullName, setFullName] = useState(defaultName || '');
  const [docType, setDocType] = useState('passport');
  const [docNumber, setDocNumber] = useState('');
  const [sending, setSending] = useState(false);
  const panelRef = React.useRef(null);
  useModal(open, onClose);
  useFocusTrap(open, panelRef);
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    await onSubmit({ fullName, docType, docNumber });
    setSending(false);
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
        aria-labelledby="verify-title"
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-pop p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="verify-title" className="text-lg font-extrabold text-slate-900 dark:text-white">Подтверждение личности</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Проверенным пользователям доверяют больше, а в анкете появляется знак «Проверен».
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Закрыть">
            <IconClose />
          </button>
        </div>

        <div>
          <label htmlFor="ver-name" className="field-label">ФИО (по паспорту)</label>
          <input id="ver-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" required className="input" />
        </div>
        <div>
          <label htmlFor="ver-type" className="field-label">Тип подтверждения</label>
          <select id="ver-type" value={docType} onChange={(e) => setDocType(e.target.value)} className="select">
            <option value="passport">Паспорт гражданина РФ</option>
            <option value="inn_self_employed">ИНН / справка о самозанятости</option>
          </select>
        </div>
        <div>
          <label htmlFor="ver-number" className="field-label">
            {docType === 'passport' ? 'Серия и номер паспорта' : 'Номер ИНН (12 цифр)'}
          </label>
          <input
            id="ver-number"
            type="text"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder={docType === 'passport' ? '4515 123456' : '770123456789'}
            className="input"
          />
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <IconLock size={14} className="mt-0.5 shrink-0" /> Данные обрабатываются в соответствии с 152-ФЗ и нужны только для проверки.
        </p>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-secondary">Отмена</button>
          <button type="submit" disabled={sending} className="btn btn-primary">
            {sending ? 'Отправка...' : 'Отправить на проверку'}
          </button>
        </div>
      </form>
    </div>
  );
}
