// Раздел «Сообщения»: список чатов сделок и открытая переписка.
// Список — pages/chats/ChatList, переписка — ChatThread, данные открытого
// чата и WebSocket — useChatRoom; здесь — список чатов, фильтры и раскладка.
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import PageHero, { HeroTabs } from '../components/PageHero.jsx';
import { AuthRequired } from '../components/PageState.jsx';
import { IconArrowLeft, IconMessages } from '../components/icons.jsx';
import ChatList from './chats/ChatList.jsx';
import ChatThread from './chats/ChatThread.jsx';
import useChatRoom from './chats/useChatRoom.js';
import { FILTERS, isDesktop } from './chats/chatUtils.js';

export default function ChatsPage({ user, token, onOpenAuth }) {
  const [searchParams] = useSearchParams();
  const initialTaskId = searchParams.get('taskId');
  const { addToast } = useToast();

  const [activeTaskId, setActiveTaskId] = useState(initialTaskId ? parseInt(initialTaskId, 10) : null);
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all, active, completed

  const room = useChatRoom({ activeTaskId, token, user });

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
          <ChatList
            filteredChats={filteredChats}
            chatOpen={chatOpen}
            loadingChats={loadingChats}
            filter={filter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeTaskId={activeTaskId}
            onSelect={setActiveTaskId}
          />

          {/* Переписка */}
          {/* min-w-0 обязателен. У flex-1 минимум по умолчанию — min-content, и
              панель не могла сжаться ниже ширины строки быстрых фраз (кнопки
              там с whitespace-nowrap). Контейнер с overflow: hidden тогда
              прокручивался вправо при автоскролле на фокус, и список диалогов
              уезжал за левый край. */}
          <section className={`${chatOpen ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-white dark:bg-slate-800`}>
            {activeChat ? (
              <ChatThread
                activeChat={activeChat}
                activeTaskId={activeTaskId}
                user={user}
                room={room}
                onBack={() => setActiveTaskId(null)}
              />
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
