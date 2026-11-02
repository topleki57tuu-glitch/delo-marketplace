// Список диалогов: поиск по названию задания и чаты с непрочитанными.
// На телефоне список и переписка — отдельные экраны (chatOpen).
import React from 'react';
import { Link } from 'react-router-dom';
import { IconInbox, IconSearch } from '../../components/icons.jsx';
import { CHAT_STATUS, formatRelativeTime } from './chatUtils.js';

export default function ChatList({ filteredChats, chatOpen, loadingChats, filter, searchQuery, onSearchChange, activeTaskId, onSelect }) {
  return (
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
            onChange={(e) => onSearchChange(e.target.value)}
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
                    onClick={() => onSelect(chat.task_id)}
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
  );
}
