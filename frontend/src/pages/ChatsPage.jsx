import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';

// Форматирование времени для чата
function formatMessageTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);

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
    return formatDistanceToNow(new Date(dateStr), {
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

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

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
          if (!activeTaskId && data.length > 0) {
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-xl border border-slate-200 dark:border-slate-700">
          <div className="text-4xl">💬</div>
          <h2 className="text-xl font-bold">Войдите для доступа к чатам</h2>
          <button onClick={() => onOpenAuth('login')} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl">
            Войти в аккаунт
          </button>
        </div>
      </div>
    );
  }

  // Фильтрация и поиск чатов
  const filteredChats = chats.filter(chat => {
    // Фильтр по статусу
    if (filter === 'active' && chat.task_status !== 'in_progress') return false;
    if (filter === 'completed' && chat.task_status !== 'completed') return false;

    // Поиск по названию
    if (searchQuery && !chat.task_title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    return true;
  });

  const activeChat = chats.find((c) => c.task_id === activeTaskId);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="h-[calc(100vh-140px)] bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex overflow-hidden">
        {/* Chats Sidebar */}
        <div className="w-80 border-r border-slate-200 dark:border-slate-700/60 flex flex-col shrink-0 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Сообщения</h2>

            {/* Search */}
            <input
              type="text"
              placeholder="Поиск по чатам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            />

            {/* Filters */}
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  filter === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                Все
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  filter === 'active'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                Активные
              </button>
              <button
                onClick={() => setFilter('completed')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  filter === 'completed'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                Завершенные
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/40">
            {loadingChats ? (
              <div className="p-4 text-center text-slate-400 text-xs">Загрузка чатов...</div>
            ) : filteredChats.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                {searchQuery ? 'Ничего не найдено' : 'У вас пока нет активных чатов'}
              </div>
            ) : (
              filteredChats.map((chat) => {
                const isActive = chat.task_id === activeTaskId;
                return (
                  <button
                    key={chat.task_id}
                    onClick={() => setActiveTaskId(chat.task_id)}
                    className={`w-full p-4 text-left transition-colors flex flex-col gap-2 relative ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-l-4 border-indigo-600'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700/40'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="font-bold text-sm text-slate-900 dark:text-white truncate pr-2">
                        {chat.task_title}
                      </span>
                      {/* Unread badge */}
                      {chat.unread_count > 0 && (
                        <span className="flex-shrink-0 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full">
                          {chat.unread_count}
                        </span>
                      )}
                    </div>

                    {/* Last message preview */}
                    {chat.last_message && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {chat.last_message}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px]">
                      <span className="px-2 py-0.5 rounded-full font-semibold bg-slate-200 dark:bg-slate-700">
                        {chat.task_status === 'open' ? 'Открыт' :
                         chat.task_status === 'in_progress' ? 'В работе' : 'Завершен'}
                      </span>
                      {chat.last_message_time && (
                        <span className="text-slate-400">
                          {formatRelativeTime(chat.last_message_time)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat Window */}
        <div className="flex-1 flex flex-col bg-white dark:bg-slate-800">
          {activeChat ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {activeChat.task_title}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span>{wsConnected ? 'Онлайн' : 'Подключение...'}</span>
                    <span>•</span>
                    <span>{activeChat.other_user_name}</span>
                  </div>
                </div>
                <Link
                  to={`/tasks/${activeChat.task_id}`}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  К заданию &rarr;
                </Link>
              </div>

              {/* Messages Area */}
              <div
                ref={messagesContainerRef}
                className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/30 dark:bg-slate-900/20"
              >
                {loadingMessages ? (
                  <div className="py-10 text-center text-slate-400 text-xs">Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-sm">
                    Начните общение в чате сделки!
                  </div>
                ) : (
                  messages.map((m, idx) => {
                    const isMe = m.sender_id === user.id;
                    const prevMsg = messages[idx - 1];
                    const showDateSeparator = !prevMsg ||
                      new Date(m.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();

                    return (
                      <React.Fragment key={m.id}>
                        {showDateSeparator && (
                          <div className="flex items-center justify-center py-2">
                            <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                              {isToday(new Date(m.created_at)) ? 'Сегодня' :
                               isYesterday(new Date(m.created_at)) ? 'Вчера' :
                               format(new Date(m.created_at), 'd MMMM yyyy', { locale: ru })}
                            </span>
                          </div>
                        )}

                        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                          {!isMe && (
                            <span className="text-[10px] text-slate-400 mb-0.5 px-1">
                              {m.sender_name}
                            </span>
                          )}
                          <div
                            className={`max-w-md p-3 rounded-2xl text-sm leading-relaxed ${
                              isMe
                                ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-600/10'
                                : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-bl-none border border-slate-200 dark:border-slate-600'
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.text}</p>
                            <span className={`block text-[10px] mt-1 ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
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

              {/* Quick Templates */}
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700/40 bg-slate-50/50 dark:bg-slate-900/20">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {QUICK_TEMPLATES.map((template, idx) => (
                    <button
                      key={idx}
                      onClick={() => setMessageText(template)}
                      className="px-3 py-1.5 bg-white dark:bg-slate-700 text-xs text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-600"
                    >
                      {template.slice(0, 30)}...
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Area */}
              <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800">
                <div className="flex gap-2">
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                    placeholder="Введите сообщение... (Enter для отправки)"
                    className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    rows="2"
                  />
                  <button
                    type="submit"
                    disabled={!messageText.trim()}
                    className="px-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors self-end"
                  >
                    Отправить
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <div className="text-6xl mb-4">💬</div>
                <p className="text-sm">Выберите чат для начала общения</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
