// Telegram в настройках: привязка аккаунта к боту ДЕЛО.
//
// Сайт выдаёт одноразовую ссылку t.me/<бот>?start=link_… (15 минут), человек
// жмёт «Старт» в Telegram, а страница тем временем опрашивает статус и сама
// показывает «Подключён». Пока бот на сервере не настроен (нет токена),
// панели нет вовсе — кнопка, которая ничего не делает, хуже её отсутствия.
import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useDialogs } from '../../components/DialogProvider.jsx';
import { IconCheck, IconTelegram } from '../../components/icons.jsx';
import { apiErrorMessage } from '../../utils/apiError';
import { Panel } from './profileShared.jsx';

const POLL_MS = 3000;

export default function TelegramPanel({ token }) {
  const { addToast } = useToast();
  const dialogs = useDialogs();
  const [status, setStatus] = useState(null);
  const [link, setLink] = useState(null); // { url, until } — ссылка выдана, ждём «Старт»
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/telegram/status', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = await res.json();
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, [token]);

  useEffect(() => {
    if (token) loadStatus();
  }, [token, loadStatus]);

  useEffect(() => {
    if (!link) return undefined;
    const timer = setInterval(async () => {
      if (Date.now() > link.until) {
        setLink(null);
        return;
      }
      const data = await loadStatus();
      if (data?.linked) {
        setLink(null);
        addToast('Telegram подключён — уведомления придут туда', 'success');
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [link, loadStatus, addToast]);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/telegram/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, 'Не удалось получить ссылку'));
      setLink({ url: data.url, until: Date.now() + (data.expires_in || 900) * 1000 });
      // Браузер может не дать открыть окно после запроса — тогда остаётся
      // кнопка «Открыть Telegram» ниже.
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      addToast(err.message || 'Не удалось получить ссылку', 'error');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await dialogs.confirm({
      title: 'Отключить Telegram?',
      message: 'Личные уведомления перестанут приходить в Telegram. Радар заказов в боте останется.',
      confirmText: 'Отключить',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch('/telegram/link', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Не удалось отключить Telegram'));
      }
      await loadStatus();
      addToast('Telegram отключён', 'success');
    } catch (err) {
      addToast(err.message || 'Не удалось отключить Telegram', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status?.enabled) return null;

  return (
    <Panel
      eyebrow="Уведомления"
      title="Telegram"
      text="Новые сообщения, отклики и статусы заказов — сразу в Telegram. А радар пришлёт свежие задания по вашим фильтрам."
    >
      {status.linked ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <IconCheck size={16} /> Подключён{status.username ? ` к @${status.username}` : ''}
          </p>
          {!status.notify_enabled && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Уведомления выключены в боте — включите их кнопкой «🔔 Уведомления».
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://t.me/${status.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              <IconTelegram size={16} /> Открыть бота
            </a>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="btn btn-ghost !text-red-600 dark:!text-red-400"
            >
              Отключить
            </button>
          </div>
        </div>
      ) : link ? (
        <div className="space-y-3">
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            <IconTelegram size={16} /> Открыть Telegram
          </a>
          <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
            Нажмите «Старт» в боте — привязка завершится сама. Ссылка одноразовая и действует 15 минут.
          </p>
        </div>
      ) : (
        <button type="button" onClick={connect} disabled={busy} className="btn btn-primary">
          <IconTelegram size={16} /> {busy ? 'Готовим ссылку...' : 'Подключить Telegram'}
        </button>
      )}
    </Panel>
  );
}
