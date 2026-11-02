// Открытый чат: шапка с собеседником, лента сообщений с разделителями
// по дням, индикатор «печатает» и поле ввода (ChatComposer). Данные
// и отправка — в useChatRoom.
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import format from 'date-fns/format';
import isToday from 'date-fns/isToday';
import isYesterday from 'date-fns/isYesterday';
import ru from 'date-fns/locale/ru';
import { IconArrowLeft, IconArrowRight, IconLink } from '../../components/icons.jsx';
import { parseServerDate } from '../../utils/format.js';
import { formatMessageTime } from './chatUtils.js';
import ChatComposer from './ChatComposer.jsx';

export default function ChatThread({ activeChat, activeTaskId, user, room, onBack }) {
  const { messages, loadingMessages, wsConnected, typingUsers } = room;
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

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

  return (
    <>
    <div className="px-3 sm:px-4 py-3 border-b border-slate-200 dark:border-slate-700/70 flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
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

      <ChatComposer room={room} />
    </>
  );
}
