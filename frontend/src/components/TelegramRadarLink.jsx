// Кнопка «Заказы в Telegram» на ленте заданий: ведёт в бота, где радар
// присылает свежие задания по выбранным категориям, бюджету и городу.
// Ссылку отдаёт бэкенд (/telegram/info); пока бот на сервере не настроен,
// кнопки нет. Запрос один на вкладку — имя бота от страницы к странице
// не меняется; после сетевой ошибки попробуем снова при следующем показе.
import React, { useEffect, useState } from 'react';
import { IconTelegram } from './icons.jsx';

let pending = null;

function loadRadarUrl() {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => fetch('/telegram/info'))
      .then((res) => (res?.ok ? res.json() : null))
      .then((data) => (data?.enabled && /^https:\/\/t\.me\/\w+/.test(data.url || '') ? data.url : null))
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
}

export function resetTelegramRadarCache() {
  pending = null;
}

export default function TelegramRadarLink({ className = 'btn btn-glass' }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    loadRadarUrl().then((value) => {
      if (alive && value) setUrl(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title="Бот пришлёт новые задания по вашим фильтрам"
    >
      <IconTelegram /> Заказы в Telegram
    </a>
  );
}
