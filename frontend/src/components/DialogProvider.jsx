import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IconWarning } from './icons.jsx';

/*
 * Диалоги подтверждения и ввода в стиле сайта — вместо системных
 * window.confirm / window.prompt / alert. Системные окна выглядели чужими
 * (серый блок браузера поверх страницы), не переводились в тёмную тему и
 * на телефоне часто показывали адрес сайта вместо заголовка.
 *
 *   const dialogs = useDialogs();
 *   if (!(await dialogs.confirm({ title: 'Удалить товар?', danger: true }))) return;
 *   const reason = await dialogs.prompt({ title: 'Причина', validate: (v) => … });
 *
 * Без провайдера (например, в юнит-тестах страниц) хук откатывается на
 * window.confirm / window.prompt — поведение страниц от этого не меняется.
 */

const DialogContext = createContext(null);

const FALLBACK = {
  confirm: ({ title, message } = {}) => Promise.resolve(window.confirm([title, message].filter(Boolean).join('\n\n'))),
  prompt: ({ title, message, defaultValue = '' } = {}) => {
    const value = window.prompt([title, message].filter(Boolean).join('\n\n'), defaultValue);
    return Promise.resolve(value);
  },
};

export function useDialogs() {
  return useContext(DialogContext) || FALLBACK;
}

function DialogView({ dialog, onClose }) {
  const { kind, title, message, confirmText, cancelText, danger, placeholder, multiline, validate } = dialog;
  const [value, setValue] = useState(dialog.defaultValue || '');
  const [error, setError] = useState(null);
  const panelRef = useRef(null);
  const fieldRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    (fieldRef.current || panelRef.current)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose(kind === 'prompt' ? null : false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  const submit = (e) => {
    e?.preventDefault();
    if (kind === 'prompt') {
      const problem = validate ? validate(value) : null;
      if (problem) {
        setError(problem);
        fieldRef.current?.focus();
        return;
      }
      onClose(value);
    } else {
      onClose(true);
    }
  };

  const Field = multiline ? 'textarea' : 'input';

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose(kind === 'prompt' ? null : false)}>
      <form
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={message ? 'dialog-message' : undefined}
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-pop p-5 sm:p-6 outline-none"
      >
        <div className="flex items-start gap-3">
          {danger && (
            <span className="w-10 h-10 shrink-0 rounded-xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 flex items-center justify-center">
              <IconWarning size={20} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-lg font-extrabold text-slate-900 dark:text-white">{title}</h2>
            {message && <p id="dialog-message" className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 whitespace-pre-line">{message}</p>}
          </div>
        </div>

        {kind === 'prompt' && (
          <div className="mt-4">
            <Field
              ref={fieldRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder={placeholder}
              rows={multiline ? 4 : undefined}
              aria-label={title}
              aria-invalid={!!error}
              className={multiline ? 'textarea' : 'input'}
            />
            {error && <p className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => onClose(kind === 'prompt' ? null : false)}>
            {cancelText || 'Отмена'}
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}>
            {confirmText || (kind === 'prompt' ? 'Отправить' : 'Подтвердить')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const open = useCallback(
    (kind, options) =>
      new Promise((resolve) => {
        setDialog({ ...options, kind, resolve, key: Date.now() });
      }),
    []
  );

  const api = useMemo(
    () => ({
      confirm: (options = {}) => open('confirm', options),
      prompt: (options = {}) => open('prompt', options),
    }),
    [open]
  );

  const close = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <DialogView key={dialog.key} dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  );
}

export default DialogProvider;
