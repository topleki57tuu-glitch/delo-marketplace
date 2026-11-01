import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * React Router не прокручивает страницу сам: при переходе по ссылке из
 * подвала новая страница открывалась с середины, а ссылки вида /#faq
 * вообще никуда не вели. Здесь: новый путь — наверх, якорь — к элементу
 * (с повторами: раздел может прийти из lazy-чанка чуть позже).
 */
export default function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return undefined;
    }
    let tries = 0;
    let timer;
    const go = () => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (tries++ < 20) timer = setTimeout(go, 100);
    };
    go();
    return () => clearTimeout(timer);
  }, [pathname, hash]);
  return null;
}
