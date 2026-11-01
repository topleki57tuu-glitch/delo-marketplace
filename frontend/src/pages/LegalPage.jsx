import React from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { LEGAL_DOCS, LEGAL_EDITION, legalDoc, legalHref } from '../constants/legal.js';
import TermsDoc from './legal/TermsDoc.jsx';
import PrivacyDoc from './legal/PrivacyDoc.jsx';
import ConsentDoc from './legal/ConsentDoc.jsx';
import NotFoundPage from './NotFoundPage.jsx';

const DOCS = { terms: TermsDoc, privacy: PrivacyDoc, consent: ConsentDoc };

const navClass = ({ isActive }) =>
  `shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

/**
 * Юридические документы: /legal/terms, /legal/privacy, /legal/consent.
 *
 * Тексты — компоненты в pages/legal, реквизиты — constants/company.js.
 * Страница открывается и без входа: на документы ведут ссылки из формы
 * регистрации, и прочитать их нужно до того, как появится аккаунт.
 */
export default function LegalPage() {
  const { doc } = useParams();
  const meta = legalDoc(doc);
  const Doc = DOCS[doc];
  if (!meta || !Doc) return <NotFoundPage />;

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        <aside className="lg:sticky lg:top-24 self-start min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Документы
          </p>
          <nav
            aria-label="Юридические документы"
            className="mt-3 -mx-4 px-4 lg:mx-0 lg:px-0 flex lg:flex-col gap-1 overflow-x-auto no-scrollbar"
          >
            {LEGAL_DOCS.map((d) => (
              <NavLink key={d.slug} to={legalHref(d.slug)} className={navClass}>
                <span className="lg:hidden">{d.short}</span>
                <span className="hidden lg:inline">{d.title}</span>
              </NavLink>
            ))}
          </nav>
          <Link
            to="/help"
            className="mt-4 hidden lg:inline-flex text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Центр помощи →
          </Link>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <header className="pb-6 border-b border-slate-200 dark:border-slate-800">
            <h1 className="page-title">{meta.title}</h1>
            <p className="page-subtitle">Редакция от {LEGAL_EDITION}</p>
          </header>
          <div className="legal-doc mt-6">
            <Doc />
          </div>
        </article>
      </div>
    </div>
  );
}
