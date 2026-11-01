import React from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { LEGAL_DOCS, LEGAL_EDITION, legalDoc, legalHref } from '../constants/legal.js';
import TermsDoc from './legal/TermsDoc.jsx';
import PrivacyDoc from './legal/PrivacyDoc.jsx';
import ConsentDoc from './legal/ConsentDoc.jsx';
import NotFoundPage from './NotFoundPage.jsx';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { IconLock } from '../components/icons.jsx';

const DOCS = { terms: TermsDoc, privacy: PrivacyDoc, consent: ConsentDoc };

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
    <>
      <PageHero
        eyebrow="Документы"
        icon={IconLock}
        title={meta.title}
        subtitle={`Редакция от ${LEGAL_EDITION}`}
      >
        <nav aria-label="Юридические документы" className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto no-scrollbar">
          {LEGAL_DOCS.map((d) => (
            <NavLink
              key={d.slug}
              to={legalHref(d.slug)}
              className={({ isActive }) => `hero-chip ${isActive ? 'hero-chip-active' : ''}`}
            >
              <span className="sm:hidden">{d.short}</span>
              <span className="hidden sm:inline">{d.title}</span>
            </NavLink>
          ))}
        </nav>
      </PageHero>

      <PageBody>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
          <article className="min-w-0 max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-5 py-6 sm:px-8 sm:py-8">
            <div className="legal-doc">
              <Doc />
            </div>
          </article>

          <aside className="lg:sticky lg:top-24 self-start space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <p className="section-eyebrow">Все документы</p>
              <ul className="mt-3 space-y-2 text-sm">
                {LEGAL_DOCS.map((d) => (
                  <li key={d.slug}>
                    <NavLink
                      to={legalHref(d.slug)}
                      className={({ isActive }) =>
                        `font-semibold ${isActive ? 'text-slate-900 dark:text-white' : 'text-indigo-600 hover:underline dark:text-indigo-400'}`
                      }
                    >
                      {d.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
            <Link
              to="/help"
              className="inline-flex text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Центр помощи →
            </Link>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
