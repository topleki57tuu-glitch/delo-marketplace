import React from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../components/Logo.jsx';
import { useDocumentTitle } from '../components/RouteMeta.jsx';

export default function NotFoundPage() {
  useDocumentTitle('Страница не найдена');
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="text-center max-w-md">
        <LogoMark size={56} className="mx-auto" />
        <p className="mt-8 font-display text-6xl font-bold text-slate-900 dark:text-white">404</p>
        <h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-white">Такой страницы нет</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          Возможно, ссылка устарела или в адресе опечатка. Начните с главной или посмотрите открытые задания.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/" className="btn btn-primary">На главную</Link>
          <Link to="/tasks" className="btn btn-secondary">Все задания</Link>
        </div>
      </div>
    </div>
  );
}
