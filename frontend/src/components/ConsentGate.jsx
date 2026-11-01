import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useToast } from './Toast';
import { useModal } from '../utils/a11y';
import { apiErrorMessage } from '../utils/apiError';
import { LEGAL_EDITION } from '../constants/legal.js';
import { LegalConsentFields } from './LegalConsentFields.jsx';
import { LogoMark } from './Logo.jsx';

/** Нужно ли пользователю принять действующую редакцию документов. */
export function needsLegalConsent(user) {
  return Boolean(user?.legal_version_required && user.legal_version !== user.legal_version_required);
}

const noop = () => {};

/**
 * Окно с документами для тех, кто вошёл, но действующую редакцию не принимал:
 * аккаунты, созданные до появления документов, и все — после смены редакции
 * (LEGAL_VERSION в backend/app/core/legal.py).
 *
 * Закрыть окно нельзя — только принять или выйти: продолжать обработку
 * данных без согласия сервис не вправе. На страницах /legal/* окно не
 * показывается, иначе оно закрыло бы те самые документы, которые предлагает
 * прочитать (ссылки открываются в новой вкладке, где пользователь тоже вошёл).
 */
export default function ConsentGate() {
  const { token, user, updateUser, logout } = useAuthStore();
  const { pathname } = useLocation();
  const { addToast } = useToast();
  const [terms, setTerms] = useState(false);
  const [pd, setPd] = useState(false);
  const [saving, setSaving] = useState(false);

  const open = Boolean(token) && needsLegalConsent(user) && !pathname.startsWith('/legal/');
  useModal(open, noop, { escapeEnabled: false, lockScroll: true, restoreFocus: true });
  if (!open) return null;

  const isUpdate = Boolean(user.legal_version);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/users/me/legal-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accept_terms: terms, pd_consent: pd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Не удалось сохранить согласие'));
      // Профиль берём из store заново: за время запроса его мог обновить опрос.
      const latest = useAuthStore.getState().user || user;
      updateUser({ ...latest, legal_version: data.legal_version || latest.legal_version_required });
      addToast('Спасибо! Документы приняты', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-gate-title"
        aria-describedby="consent-gate-text"
        className="w-full sm:max-w-md bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl p-6 sm:p-8 space-y-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:pb-8"
      >
        <LogoMark size={40} />
        <div>
          <h2 id="consent-gate-title" className="text-xl font-extrabold text-slate-900 dark:text-white">
            {isUpdate ? 'Мы обновили документы' : 'Документы сервиса'}
          </h2>
          <p id="consent-gate-text" className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {isUpdate
              ? `С ${LEGAL_EDITION} действует новая редакция пользовательского соглашения и согласия на обработку персональных данных. Чтобы продолжить, примите их.`
              : 'У сервиса появились пользовательское соглашение и политика обработки персональных данных. Чтобы продолжить работу, примите соглашение и дайте согласие на обработку данных.'}
          </p>
        </div>

        <LegalConsentFields terms={terms} pd={pd} onTermsChange={setTerms} onPdChange={setPd} />

        <div className="space-y-2">
          <button type="submit" disabled={saving} className="btn btn-primary w-full !py-3">
            {saving ? 'Сохраняем…' : 'Принять и продолжить'}
          </button>
          <button type="button" onClick={logout} className="btn btn-ghost w-full">
            Выйти
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Не согласны с документами? Вы можете выйти и закрыть аккаунт через поддержку — остаток
          баланса будет выплачен.
        </p>
      </form>
    </div>
  );
}
