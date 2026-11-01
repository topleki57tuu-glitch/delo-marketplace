import React from 'react';
import { legalHref } from '../constants/legal.js';

const linkClass = 'font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:decoration-current dark:text-indigo-400';

function DocAnchor({ slug, children }) {
  // Новая вкладка: иначе переход по ссылке закрыл бы форму вместе с
  // введёнными email и паролем.
  return (
    <a href={legalHref(slug)} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

/**
 * Две отметки согласия — при регистрации и в окне с новой редакцией.
 *
 * Именно две, а не одна «принимаю всё»: с 1 сентября 2025 года согласие на
 * обработку персональных данных оформляется отдельно от других документов
 * (ст. 9 152-ФЗ в ред. 156-ФЗ). По умолчанию обе сняты — заранее
 * проставленная отметка согласием не считается. required — чтобы браузер
 * сам не дал отправить форму и показал, какую отметку пропустили.
 */
export function LegalConsentFields({ terms, pd, onTermsChange, onPdChange }) {
  const box = 'mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900';
  const row = 'flex items-start gap-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300 cursor-pointer';
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Документы сервиса</legend>
      <label className={row}>
        <input
          type="checkbox"
          name="accept_terms"
          required
          checked={terms}
          onChange={(e) => onTermsChange(e.target.checked)}
          className={box}
        />
        <span>
          Принимаю <DocAnchor slug="terms">Пользовательское соглашение</DocAnchor> и ознакомлен(а) с{' '}
          <DocAnchor slug="privacy">Политикой обработки персональных данных</DocAnchor>
        </span>
      </label>
      <label className={row}>
        <input
          type="checkbox"
          name="pd_consent"
          required
          checked={pd}
          onChange={(e) => onPdChange(e.target.checked)}
          className={box}
        />
        <span>
          Даю <DocAnchor slug="consent">согласие на обработку персональных данных</DocAnchor>
        </span>
      </label>
    </fieldset>
  );
}
