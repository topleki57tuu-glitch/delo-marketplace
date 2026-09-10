import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../components/Toast';

export default function ChatsPage({ user, token, onOpenAuth }) {
  const [searchParams] = useSearchParams();
  const initialTaskId = searchParams.get('taskId');
  const { addToast } = useToast();

  const [activeTaskId, setActiveTaskId] = useState(initialTaskId ? parseInt(initialTaskId, 10) : null);
  const [tasks, setTasks] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Load user's tasks with chats
  useEffect(() => {
    if (!token) return;
    const loadUserTasks = async () => {
      try {
        const res = await fetch('/tasks/', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const allTasks = await res.json();
          // Filter tasks where user is customer or executor
          const myTasks = allTasks.filter(
            (t) => t.customer_id === user?.id || t.executor_id === user?.id
          );
          setTasks(myTasks);
          if (!activeTaskId && myTasks.length > 0) {
            setActiveTaskId(myTasks[0].id);
          }
        }
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoadingTasks(false);
      }
    };

    loadUserTasks();
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

  const activeTask = tasks.find((t) => t.id === activeTaskId);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="h-[calc(100vh-140px)] bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex overflow-hidden">
        {/* Chats Sidebar */}
        <div className="w-80 border-r border-slate-200 dark:border-slate-700/60 flex flex-col shrink-0 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700/60">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Сообщения и сделки</h2>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/40">
            {loadingTasks ? (
              <div className="p-4 text-center text-slate-400 text-xs">Загрузка чатов...</div>
            ) : tasks.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                У вас пока нет активных сделок и чатов.
              </div>
            ) : (
              tasks.map((t) => {
                const isActive = t.id === activeTaskId;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTaskId(t.id)}
                    className={`w-full p-4 text-left transition-colors flex flex-col gap-1 ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-l-4 border-indigo-600'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {t.title}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-200 dark:bg-slate-700">
                        {t.status === 'open' ? 'Открыт' : t.status === 'in_progress' ? 'В работе' : 'Завершен'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {t.budget ? `${t.budget} ₽` : 'По договоренности'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat Window */}
        <div className="flex-1 flex flex-col bg-white dark:bg-slate-800">
          {activeTask ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    Чат по заказу: {activeTask.title}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span>{wsConnected ? 'Онлайн (WebSockets)' : 'Подключение...'}</span>
                  </div>
                </div>
                <Link
                  to={`/tasks/${activeTask.id}`}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  К заданию &rarr;
                </Link>
              </div>

              {/* Messages Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/30 dark:bg-slate-900/20">
                {loadingMessages ? (
                  <div className="py-10 text-center text-slate-400 text-xs">Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-sm">
                    Начните общение в чате сделки!
                  </div>
                ) : (
                  messages.map((m, idx) => {
                    const isMe = m.sender_id === user.id;
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <span className="text-[10px] text-slate-400 mb-0.5 px-1">
                          {m.sender_name || (isMe ? 'Вы' : 'Собеседник')}
                        </span>
                        <div
                          className={`max-w-md p-3 rounded-2xl text-sm leading-relaxed ${
                            isMe
                              ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-600/10'
                              : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none border border-slate-200/80 dark:border-slate-600 shadow-sm'
                          }`}
                        >
                          {m.text}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-200 dark:border-slate-700/60 flex gap-3">
                <input
                  type="text"
                  placeholder="Напишите сообщение..."
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  className="flex-1 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!messageText.trim()}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md transition-all"
                >
                  Отправить
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Выберите чат из списка слева
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
