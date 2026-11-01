import React from 'react';
import { Link } from 'react-router-dom';
import { COMPANY, registrationLabel } from '../../constants/company.js';
import { legalHref } from '../../constants/legal.js';

/**
 * Значение реквизита — или заметный маркер, пока его не заполнили
 * в constants/company.js. Пустая строка в юридическом тексте читалась бы
 * как опечатка, а выдуманное значение — хуже пустого.
 */
export function Req({ value, hint }) {
  if (value) return <>{value}</>;
  return <mark className="legal-req">[укажите {hint}]</mark>;
}

/** Пункт документа с номером: «2.3. Текст». */
export function Clause({ n, children }) {
  return (
    <p>
      <span className="legal-num">{n}.</span> {children}
    </p>
  );
}

export function DocLink({ slug, children }) {
  return <Link to={legalHref(slug)}>{children}</Link>;
}

/** Наименование оператора с ИНН и ОГРН — для первого упоминания в тексте. */
export function Operator() {
  return (
    <>
      <Req value={COMPANY.legalName} hint="наименование оператора" /> (ИНН{' '}
      <Req value={COMPANY.inn} hint="ИНН" />, {registrationLabel()}{' '}
      <Req value={COMPANY.ogrn} hint={registrationLabel()} />)
    </>
  );
}

/** Адрес поддержки — ссылкой, если он уже указан. */
export function SupportEmail() {
  if (!COMPANY.email) return <Req value="" hint="email поддержки" />;
  return <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>;
}

/** Блок реквизитов в конце документа. */
export function Requisites() {
  const rows = [
    ['Наименование', <Req value={COMPANY.legalName} hint="наименование оператора" />],
    ['ИНН', <Req value={COMPANY.inn} hint="ИНН" />],
    [registrationLabel(), <Req value={COMPANY.ogrn} hint={registrationLabel()} />],
    ['Адрес', <Req value={COMPANY.address} hint="адрес для писем и претензий" />],
    ['Email', <SupportEmail />],
  ];
  if (COMPANY.phone) rows.push(['Телефон', <a href={`tel:${COMPANY.phone.replace(/[^\d+]/g, '')}`}>{COMPANY.phone}</a>]);
  return (
    <dl className="legal-requisites">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Карточка цели обработки в Политике: что, зачем, на каком основании, сколько. */
export function Purpose({ title, data, basis, term, children }) {
  return (
    <section className="legal-purpose">
      <h3>{title}</h3>
      <dl>
        <div>
          <dt>Данные</dt>
          <dd>{data}</dd>
        </div>
        <div>
          <dt>Основание</dt>
          <dd>{basis}</dd>
        </div>
        <div>
          <dt>Срок</dt>
          <dd>{term}</dd>
        </div>
      </dl>
      {children}
    </section>
  );
}
