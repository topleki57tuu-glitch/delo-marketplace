// Открытый чат сделки: история сообщений, WebSocket с новыми сообщениями
// и индикатором «печатает», черновик сообщения, отправка текста и файлов.
// Хук живёт в странице, чтобы история грузилась сразу при выборе чата,
// параллельно со списком диалогов, а черновик переживал смену экрана.
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/Toast';

import { playNotificationSound } from './chatUtils.js';
import { apiErrorMessage } from '../../utils/apiError';

export default function useChatRoom({ activeTaskId, token, user }) {
  const { addToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // { user_id: { name, timestamp } }
  const [uploadingFile, setUploadingFile] = useState(false);

  const wsRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  // Сообщения, пришедшие по WebSocket, сервер считает непрочитанными: он
  // отмечает прочитанным только то, что отдал в истории при открытии чата.
  // Поэтому раньше ответ, прочитанный «вживую», висел в счётчике
  // непрочитанных до следующего открытия переписки.
  const markReadTimerRef = useRef(null);
  const pendingReadRef = useRef(false);

  // Load messages & setup WebSocket for active task
  useEffect(() => {
    if (!activeTaskId || !token) return;

    // Переписку предыдущего чата не показываем, пока грузится новая.
    setMessages([]);
    setTypingUsers({});

    let ws = null;
    let disposed = false;
    let reconnectTimer = null;
    let attempt = 0;

    const fetchHistory = async ({ silent = false } = {}) => {
      if (!silent) setLoadingMessages(true);
      try {
        const res = await fetch(`/tasks/${activeTaskId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !disposed) {
          const data = await res.json();
          setMessages(data);
          pendingReadRef.current = false;
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!silent && !disposed) setLoadingMessages(false);
      }
    };

    const markRead = () => {
      if (disposed) return;
      pendingReadRef.current = false;
      fetch(`/tasks/${activeTaskId}/messages/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    };

    const scheduleMarkRead = () => {
      if (document.visibilityState !== 'visible') {
        pendingReadRef.current = true;
        return;
      }
      clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = setTimeout(markRead, 600);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pendingReadRef.current) markRead();
    };
    document.addEventListener('visibilitychange', onVisible);

    fetchHistory();

    // Setup WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/tasks/${activeTaskId}`;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        console.error('WS Connection error:', e);
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        setWsConnected(true);
        ws.send(JSON.stringify({ type: 'auth', token }));
        // После обрыва дочитываем то, что пришло, пока связи не было.
        if (attempt > 0) fetchHistory({ silent: true });
        attempt = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Обработка typing событий
          if (msg.type === 'typing') {
            if (msg.user_id !== user.id) {
              if (msg.is_typing) {
                setTypingUsers(prev => ({
                  ...prev,
                  [msg.user_id]: { name: msg.user_name, timestamp: Date.now() }
                }));
              } else {
                setTypingUsers(prev => {
                  const updated = { ...prev };
                  delete updated[msg.user_id];
                  return updated;
                });
              }
            }
            return;
          }

          // Обработка обычных сообщений. Своё сообщение могло уже попасть
          // в список из ответа на отправку — дубль по id не добавляем.
          setMessages((prev) => (msg.id != null && prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));

          // Звуковое уведомление для входящих сообщений
          if (msg.sender_id !== user.id) {
            scheduleMarkRead();
            playNotificationSound();
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = (event) => {
        setWsConnected(false);
        // 1008 — сервер отказал (нет доступа к сделке или токен устарел):
        // повтор с тем же токеном ничего не даст. После обновления токена
        // эффект перезапустится сам — он зависит от `token`.
        if (disposed || event.code === 1008) return;
        // Связь рвётся при уходе телефона в сон и перезапуске сервера.
        // Раньше чат оставался в «подключение...» навсегда, а новые сообщения
        // переставали приходить до повторного открытия переписки.
        attempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** (attempt - 1), 15000));
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(markReadTimerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      if (ws) ws.close();
    };
  }, [activeTaskId, token]);

  // Auto-cleanup typing indicators after 3 seconds of inactivity
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers(prev => {
        const updated = { ...prev };
        let changed = false;
        Object.keys(updated).forEach(userId => {
          if (now - updated[userId].timestamp > 3000) {
            delete updated[userId];
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageText.trim() || !activeTaskId) return;

    const textToSend = messageText.trim();
    setMessageText('');

    // Stop typing indicator when sending
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing_stop' }));
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    try {
      const res = await fetch(`/tasks/${activeTaskId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: textToSend }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Не удалось отправить сообщение'));
      // Показываем отправленное сразу, не дожидаясь рассылки по WebSocket:
      // без связи сообщение сохранялось, но в переписке не появлялось.
      if (data && data.id != null) {
        setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
      }
    } catch (err) {
      // Текст не теряем: возвращаем его в поле, если там ещё ничего не набрали.
      setMessageText((current) => current || textToSend);
      addToast(err.message, 'error');
    }
  };

  const handleInputChange = (e) => {
    setMessageText(e.target.value);

    // Send typing_start event
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing_start' }));

      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Auto-stop typing after 3 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'typing_stop' }));
        }
      }, 3000);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Лимит сервера на одно изображение — 5 МБ (backend/file_utils.py).
    // Раньше здесь стояло 10 МБ, то есть клиент пропускал файл, который
    // сервер всё равно отклонял.
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      addToast('Файл слишком большой. Максимум 5 МБ', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadingFile(true);

    try {
      // Файл грузим на сервер и отправляем в сообщении короткую ссылку.
      //
      // Раньше сюда клался data-URL целиком (FileReader.readAsDataURL): файл
      // на 1.5 МБ превращался в 1.5 МБ base64 внутри строки БД, и столько же
      // приезжало на каждое чтение чата — ответ рос линейно от числа картинок
      // в переписке. Замер: одно вложение → 1.5 МБ, два → 3.0 МБ.
      //
      // scope=private — вложение личной переписки: сервер отдаёт его только
      // по ссылке с подписью, которую выдаёт участникам сделки вместе
      // с сообщением. Публичный /files/<id> для такого файла вернёт 403.
      //
      // Картинки и документы идут на разные эндпоинты: у них разная проверка
      // содержимого (изображение определяется по magic bytes и отдаётся
      // инлайном, документ — только на скачивание).
      const isImage = file.type.startsWith('image/');
      const endpoint = isImage ? '/upload/image?scope=private' : '/upload/file?scope=private';

      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(endpoint, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const uploaded = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        throw new Error(apiErrorMessage(uploaded, 'Не удалось загрузить файл'));
      }

      const res = await fetch(`/tasks/${activeTaskId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: messageText.trim() || `📎 ${file.name}`,
          file_url: uploaded.url,
          file_name: file.name,
          file_type: file.type,
        }),
      });

      const sent = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(apiErrorMessage(sent, 'Не удалось отправить файл'));
      }
      if (sent && sent.id != null) {
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      }

      setMessageText('');
      addToast('Файл отправлен!', 'success');
    } catch (err) {
      addToast(err.message || 'Не удалось отправить файл', 'error');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return {
    messages,
    loadingMessages,
    wsConnected,
    typingUsers,
    messageText,
    setMessageText,
    uploadingFile,
    fileInputRef,
    handleSendMessage,
    handleInputChange,
    handleFileSelect,
  };
}
