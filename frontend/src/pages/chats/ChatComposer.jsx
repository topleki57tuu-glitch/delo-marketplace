// Поле ввода чата: быстрые фразы, эмодзи, вложение файла и отправка
// по Enter (Shift+Enter — перенос строки).
import React, { useEffect, useRef, useState } from 'react';
import { EmojiPicker } from '../../components/EmojiPicker';
import { IconArrowRight, IconRefresh, IconLink, IconSmile } from '../../components/icons.jsx';
import { QUICK_TEMPLATES } from './chatUtils.js';

export default function ChatComposer({ room }) {
  const { messageText, setMessageText, uploadingFile, fileInputRef, handleSendMessage, handleInputChange, handleFileSelect } = room;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef(null);

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

  const handleEmojiClick = (emojiObject) => {
    setMessageText(prev => prev + emojiObject.emoji);
    setShowEmojiPicker(false);
  };

  return (
    <>
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
  );
}
