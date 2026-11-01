import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import format from 'date-fns/format';
import isToday from 'date-fns/isToday';
import isYesterday from 'date-fns/isYesterday';
import ru from 'date-fns/locale/ru';
import { EmojiPicker } from '../components/EmojiPicker';
import PageHero, { HeroTabs } from '../components/PageHero.jsx';
import { AuthRequired } from '../components/PageState.jsx';
import { IconArrowLeft, IconArrowRight, IconInbox, IconRefresh, IconLink, IconMessages, IconSearch, IconSmile } from '../components/icons.jsx';
import { parseServerDate } from '../utils/format.js';

const CHAT_STATUS = {
  open: { label: 'Открыт', cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  in_progress: { label: 'В работе', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  disputed: { label: 'Спор', cls: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  completed: { label: 'Завершён', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  cancelled: { label: 'Отменён', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'В работе' },
  { id: 'completed', label: 'Завершённые' },
];

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches;

// Форматирование времени для чата
function formatMessageTime(dateStr) {
  const date = parseServerDate(dateStr);
  if (!date) return '';

  if (isToday(date)) {
    return format(date, 'HH:mm');
  } else if (isYesterday(date)) {
    return 'вчера ' + format(date, 'HH:mm');
  } else {
    return format(date, 'd MMM, HH:mm', { locale: ru });
  }
}

// Относительное время для списка чатов
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  try {
    return formatDistanceToNow(parseServerDate(dateStr), {
      addSuffix: true,
      locale: ru
    });
  } catch {
    return '';
  }
}

export default function ChatsPage({ user, token, onOpenAuth }) {
  const [searchParams] = useSearchParams();
  const initialTaskId = searchParams.get('taskId');
  const { addToast } = useToast();

  const [activeTaskId, setActiveTaskId] = useState(initialTaskId ? parseInt(initialTaskId, 10) : null);
  const [chats, setChats] = useState([]); // Изменено: используем /chats endpoint
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all, active, completed
  const [typingUsers, setTypingUsers] = useState({}); // { user_id: { name, timestamp } }
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load user's chats with metadata
  useEffect(() => {
    if (!token) return;
    const loadChats = async () => {
      try {
        const res = await fetch('/chats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setChats(data);
          // На телефоне список и переписка — отдельные экраны: первый чат
          // открываем сами только там, где они стоят рядом.
          if (!activeTaskId && data.length > 0 && isDesktop()) {
            setActiveTaskId(data[0].task_id);
          }
        }
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoadingChats(false);
      }
    };

    loadChats();

    // Refresh chats every 30 seconds for unread count update
    const interval = setInterval(loadChats, 30000);
    return () => clearInterval(interval);
  }, [token, user]);

  // Load messages & setup WebSocket for active task
  useEffect(() => {
    if (!activeTaskId || !token) return;

    let ws = null;
    const fetchHistory = async () => {
      setLoadingMessages(true);
      try {
        const res = await fetch(`/tasks/${activeTaskId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setMessages(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingMessages(false);
      }
    };

    fetchHistory();

    // Setup WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/tasks/${activeTaskId}`;

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setWsConnected(true);
        ws.send(JSON.stringify({ type: 'auth', token }));
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

          // Обработка обычных сообщений
          setMessages((prev) => [...prev, msg]);

          // Звуковое уведомление для входящих сообщений
          if (msg.sender_id !== user.id) {
            playNotificationSound();
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = () => setWsConnected(false);
      wsRef.current = ws;
    } catch (e) {
      console.error('WS Connection error:', e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [activeTaskId, token]);

  // Прокручиваем только ленту сообщений. scrollIntoView двигал и саму
  // страницу: при открытии чатов окно уезжало вниз, мимо шапки раздела.
  const scrolledOnceRef = useRef(false);
  useEffect(() => {
    scrolledOnceRef.current = false;
  }, [activeTaskId]);
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: scrolledOnceRef.current ? 'smooth' : 'auto' });
    if (messages.length) scrolledOnceRef.current = true;
  }, [messages, loadingMessages]);

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

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  const playNotificationSound = () => {
    // Простой beep звук (можно заменить на загрузку audio файла)
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  };

  const QUICK_TEMPLATES = [
    'Здравствуйте! Готов обсудить детали задачи.',
    'Подскажите, пожалуйста, какие сроки для вас в приоритете?',
    'Уточните, пожалуйста, есть ли готовое ТЗ или примеры?',
    'Всё понятно, приступаю к выполнению работы!',
    'Отправил предварительные результаты на согласование.'
  ];

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

      if (!res.ok) throw new Error('Не удалось отправить сообщение');
    } catch (err) {
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

  const handleEmojiClick = (emojiObject) => {
    setMessageText(prev => prev + emojiObject.emoji);
    setShowEmojiPicker(false);
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
        throw new Error(uploaded.detail || 'Не удалось загрузить файл');
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

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || 'Не удалось отправить файл');
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

  const counts = {
    all: chats.length,
    active: chats.filter((c) => c.task_status === 'in_progress').length,
    completed: chats.filter((c) => c.task_status === 'completed').length,
  };
  const unreadTotal = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  // На телефоне открытая переписка занимает весь экран — шапку раздела прячем
  const chatOpen = !!(user && activeTaskId);

  const hero = (
    <PageHero
      size="sm"
      eyebrow="Чаты сделок"
      icon={IconMessages}
      title="Сообщения"
      subtitle={
        user && unreadTotal > 0
          ? `Непрочитанных сообщений: ${unreadTotal}`
          : 'Переписка по заданиям — с заказчиками и исполнителями.'
      }
      className={chatOpen ? 'max-md:hidden' : ''}
      actions={
        user && (
          <HeroTabs
            label="Какие чаты показать"
            items={FILTERS.map((f) => ({ ...f, count: counts[f.id] }))}
            value={filter}
            onChange={setFilter}
          />
        )
      }
    />
  );

  if (!user) {
    return (
      <>
        {hero}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-28 md:pb-14">
          <AuthRequired
            onOpenAuth={onOpenAuth}
            title="Войдите, чтобы открыть чаты"
            text="Здесь хранится переписка по каждому заданию: с заказчиками и исполнителями."
          />
        </div>
      </>
    );
  }

  // Фильтрация и поиск чатов
  const filteredChats = chats.filter((chat) => {
    if (filter === 'active' && chat.task_status !== 'in_progress') return false;
    if (filter === 'completed' && chat.task_status !== 'completed') return false;
    if (searchQuery && !(chat.task_title || '').toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const activeChat = chats.find((c) => c.task_id === activeTaskId);

  return (
    <>
      {hero}
      <div className={`mx-auto max-w-7xl md:px-6 lg:px-8 md:pt-6 md:pb-14 ${chatOpen ? '' : 'px-4 pt-5 pb-28'}`}>
        <div
          className={`flex overflow-hidden bg-white dark:bg-slate-800 md:rounded-2xl md:border md:border-slate-200 md:dark:border-slate-700 md:shadow-card md:h-[min(46rem,calc(100dvh-13rem))] md:min-h-[30rem] ${
            chatOpen ? 'h-[calc(100dvh-8.25rem)]' : 'rounded-2xl border border-slate-200 dark:border-slate-700'
          }`}
        >
          {/* Список диалогов */}
          <aside
            aria-label="Диалоги"
            className={`${chatOpen ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 flex-col md:border-r border-slate-200 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/30`}
          >
            <div className="p-3 border-b border-slate-200 dark:border-slate-700/70">
              <label htmlFor="chats-search" className="sr-only">Поиск по чатам</label>
              <div className="relative">
                <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="chats-search"
                  type="search"
                  placeholder="Поиск по названию задания..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input !pl-9 !py-2 !text-sm"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingChats ? (
                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400" role="status">Загрузка чатов...</div>
              ) : filteredChats.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <span className="mx-auto w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                    <IconInbox size={20} />
                  </span>
                  <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                    {searchQuery || filter !== 'all' ? 'Ничего не найдено' : 'Чатов пока нет'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {searchQuery || filter !== 'all'
                      ? 'Попробуйте другой запрос или фильтр.'
                      : 'Чат появляется, когда заказчик выбирает исполнителя.'}
                  </p>
                  {!searchQuery && filter === 'all' && (
                    <Link to="/tasks" className="btn btn-secondary mt-4 !text-xs !py-2">К заданиям</Link>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {filteredChats.map((chat) => {
                    const isActive = chat.task_id === activeTaskId;
                    const st = CHAT_STATUS[chat.task_status] || CHAT_STATUS.open;
                    return (
                      <li key={chat.task_id}>
                        <button
                          type="button"
                          onClick={() => setActiveTaskId(chat.task_id)}
                          aria-current={isActive ? 'true' : undefined}
                          className={`w-full px-4 py-3.5 text-left flex gap-3 transition-colors border-l-[3px] ${
                            isActive
                              ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-600 dark:border-indigo-400'
                              : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/40'
                          }`}
                        >
                          <span className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-sm font-bold flex items-center justify-center overflow-hidden">
                            {chat.other_user_avatar ? (
                              <img src={chat.other_user_avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (chat.other_user_name || '?')[0].toUpperCase()
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{chat.task_title}</span>
                              {chat.unread_count > 0 && (
                                <span className="shrink-0 min-w-[1.25rem] px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full text-center">
                                  {chat.unread_count}
                                </span>
                              )}
                            </span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {chat.other_user_name}
                              {chat.last_message ? ` · ${chat.last_message}` : ''}
                            </span>
                            <span className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                              <span className={`px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                              {chat.last_message_time && (
                                <span className="text-slate-400 truncate">{formatRelativeTime(chat.last_message_time)}</span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Переписка */}
          {/* min-w-0 обязателен. У flex-1 минимум по умолчанию — min-content, и
              панель не могла сжаться ниже ширины строки быстрых фраз (кнопки
              там с whitespace-nowrap). Контейнер с overflow: hidden тогда
              прокручивался вправо при автоскролле на фокус, и список диалогов
              уезжал за левый край. */}
          <section className={`${chatOpen ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-white dark:bg-slate-800`}>
            {activeChat ? (
              <>
                <div className="px-3 sm:px-4 py-3 border-b border-slate-200 dark:border-slate-700/70 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTaskId(null)}
                    className="md:hidden w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    aria-label="Все чаты"
                  >
                    <IconArrowLeft size={18} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">{activeChat.task_title}</h2>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      <span
                        className={`w-2 h-2 shrink-0 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        title={wsConnected ? 'Сообщения приходят сразу' : 'Подключение...'}
                      />
                      {activeChat.other_user_name}
                      {activeChat.other_user_role ? ` · ${activeChat.other_user_role}` : ''}
                      {!wsConnected && <span className="text-amber-600 dark:text-amber-400"> · подключение...</span>}
                    </p>
                  </div>
                  <Link to={`/tasks/${activeChat.task_id}`} className="btn btn-secondary shrink-0 !px-3 !py-1.5 !text-xs">
                    К заданию <IconArrowRight size={14} />
                  </Link>
                </div>

                <div
                  ref={messagesContainerRef}
                  className="flex-1 px-3 sm:px-5 py-4 overflow-y-auto overscroll-contain space-y-3 bg-slate-50/60 dark:bg-slate-900/30"
                  aria-live="polite"
                >
                  {loadingMessages ? (
                    <div className="py-10 text-center text-slate-400 text-xs" role="status">Загрузка сообщений...</div>
                  ) : messages.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                      Сообщений пока нет. Напишите первым — обсудите сроки и детали.
                    </div>
                  ) : (
                    messages.map((m, idx) => {
                      const isMe = m.sender_id === user.id;
                      const date = parseServerDate(m.created_at);
                      const prevDate = idx > 0 ? parseServerDate(messages[idx - 1].created_at) : null;
                      const showDateSeparator = date && (!prevDate || date.toDateString() !== prevDate.toDateString());

                      return (
                        <React.Fragment key={m.id ?? `${m.created_at}-${idx}`}>
                          {showDateSeparator && (
                            <div className="flex items-center justify-center py-1">
                              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-0.5 rounded-full">
                                {isToday(date) ? 'Сегодня' : isYesterday(date) ? 'Вчера' : format(date, 'd MMMM yyyy', { locale: ru })}
                              </span>
                            </div>
                          )}

                          <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            {!isMe && <span className="text-[11px] text-slate-400 mb-0.5 px-1">{m.sender_name}</span>}
                            <div
                              className={`max-w-[85%] sm:max-w-md px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                                isMe
                                  ? 'bg-indigo-600 text-white rounded-br-md'
                                  : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-bl-md border border-slate-200 dark:border-slate-600'
                              }`}
                            >
                              {m.file_url && (
                                <div className="mb-2">
                                  {m.file_type?.startsWith('image/') ? (
                                    <a href={m.file_url} target="_blank" rel="noopener noreferrer">
                                      <img src={m.file_url} alt={m.file_name || 'Вложение'} className="max-w-full sm:max-w-xs rounded-lg hover:opacity-90 transition-opacity" />
                                    </a>
                                  ) : (
                                    <a
                                      href={m.file_url}
                                      download={m.file_name}
                                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                                        isMe ? 'bg-indigo-500 hover:bg-indigo-400' : 'bg-slate-100 dark:bg-slate-600 hover:bg-slate-200 dark:hover:bg-slate-500'
                                      }`}
                                    >
                                      <IconLink size={18} />
                                      <span className="flex-1 min-w-0">
                                        <span className="block font-semibold text-xs truncate">{m.file_name}</span>
                                        <span className={`block text-[10px] ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>Скачать файл</span>
                                      </span>
                                    </a>
                                  )}
                                </div>
                              )}

                              <p className="whitespace-pre-wrap break-words">{m.text}</p>
                              <span className={`block text-[10px] mt-1 text-right ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                                {formatMessageTime(m.created_at)}
                              </span>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {Object.keys(typingUsers).length > 0 && (
                  <div className="px-4 py-1.5 text-xs text-slate-500 dark:text-slate-400 italic border-t border-slate-100 dark:border-slate-700/50">
                    {Object.values(typingUsers).map((u) => u.name).join(', ')} печатает
                    <span className="inline-flex ml-1">
                      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                    </span>
                  </div>
                )}

                <div className="px-3 sm:px-4 pt-2.5 border-t border-slate-200 dark:border-slate-700/70">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5" role="group" aria-label="Быстрые фразы">
                    {QUICK_TEMPLATES.map((template, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setMessageText(template)}
                        title={template}
                        className="shrink-0 max-w-[15rem] truncate px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:border-indigo-300 hover:text-indigo-700 dark:hover:border-indigo-400/60 dark:hover:text-white transition-colors"
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSendMessage} className="p-3 sm:p-4 bg-white dark:bg-slate-800">
                  <div className="flex gap-1.5 sm:gap-2 items-end">
                    <div className="relative" ref={emojiPickerRef}>
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors"
                        aria-label="Добавить эмодзи"
                        aria-expanded={showEmojiPicker}
                      >
                        <IconSmile size={20} />
                      </button>
                      {showEmojiPicker && (
                        <div className="absolute bottom-full left-0 mb-2 z-50">
                          <EmojiPicker
                            onEmojiClick={handleEmojiClick}
                            width={300}
                            height={360}
                            searchPlaceHolder="Поиск эмодзи..."
                            previewConfig={{ showPreview: false }}
                          />
                        </div>
                      )}
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                      className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50"
                      aria-label="Прикрепить файл"
                    >
                      {uploadingFile ? <IconRefresh size={18} className="animate-spin" /> : <IconLink size={18} />}
                    </button>

                    <label htmlFor="chat-message" className="sr-only">Сообщение</label>
                    <textarea
                      id="chat-message"
                      value={messageText}
                      onChange={handleInputChange}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage(e);
                        }
                      }}
                      placeholder="Сообщение... (Enter — отправить)"
                      className="textarea flex-1 min-w-0 resize-none !py-2.5 !text-sm max-h-40"
                      rows="2"
                      disabled={uploadingFile}
                    />
                    <button
                      type="submit"
                      disabled={!messageText.trim() || uploadingFile}
                      className="btn btn-primary shrink-0 self-end !px-3 sm:!px-5"
                      aria-label="Отправить"
                    >
                      <IconArrowRight size={18} className="sm:hidden" />
                      <span className="hidden sm:inline">Отправить</span>
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-xs">
                  <span className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                    <IconMessages size={26} />
                  </span>
                  <p className="mt-4 font-bold text-slate-900 dark:text-white">
                    {loadingChats ? 'Загрузка...' : activeTaskId ? 'Чат не найден' : 'Выберите чат'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {activeTaskId && !loadingChats
                      ? 'Возможно, у этого задания ещё нет исполнителя.'
                      : 'Переписка по заданию откроется здесь.'}
                  </p>
                  {activeTaskId && !loadingChats && (
                    <button type="button" className="btn btn-secondary mt-4 md:hidden" onClick={() => setActiveTaskId(null)}>
                      <IconArrowLeft size={16} /> Все чаты
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
