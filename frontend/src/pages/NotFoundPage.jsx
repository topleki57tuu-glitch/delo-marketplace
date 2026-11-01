import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../components/RouteMeta.jsx';
import { IconSearch } from '../components/icons.jsx';

export default function NotFoundPage() {
  useDocumentTitle('Страница не найдена');
  return (
    <section className="hero-band dark min-h-[70vh] flex items-center">
      <div className="relative w-full max-w-2xl mx-auto px-4 py-16 sm:py-24 text-center">
        <span className="hero-eyebrow mb-6">
          <IconSearch size={14} className="text-amber-300" /> Ошибка 404
        </span>
        <p
          aria-hidden="true"
          className="font-display font-bold leading-none tracking-tight text-[6rem] sm:text-[8.5rem] bg-gradient-to-b from-white to-indigo-300/60 bg-clip-text text-transparent"
        >
          404
        </p>
        <h1 className="hero-title mt-4">Такой страницы нет</h1>
        <p className="hero-subtitle mx-auto max-w-md">
          Возможно, ссылка устарела или в адресе опечатка. Начните с главной или посмотрите открытые задания.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/" className="btn btn-cta">На главную</Link>
          <Link to="/tasks" className="btn btn-glass">Все задания</Link>
        </div>
      </div>
    </section>
  );
}
