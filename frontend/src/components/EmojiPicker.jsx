import React, { useState } from 'react';

// Легковесный emoji picker (всего ~2KB вместо 383KB!)
const EMOJI_CATEGORIES = {
  'Смайлы': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴'],
  'Жесты': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '👏', '🙌', '👐', '🤲', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶'],
  'Эмоции': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐'],
  'Животные': ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋'],
  'Еда': ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🧆', '🌮', '🌯', '🥗', '🥘', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊'],
  'Предметы': ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂'],
  'Другое': ['✅', '❌', '⭐', '🌟', '💫', '✨', '⚡', '🔥', '💥', '💯', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '🔔', '🔕', '📢', '📣', '💬', '💭', '🗯️', '💤', '👀', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💿', '💾', '💽', '📀', '🎥', '🎬', '📷', '📸', '📹', '📼']
};

export function EmojiPicker({ onEmojiClick, width = 320, height = 400 }) {
  const [activeCategory, setActiveCategory] = useState('Смайлы');
  const [search, setSearch] = useState('');

  const handleEmojiClick = (emoji) => {
    onEmojiClick({ emoji });
  };

  // Фильтрация по поиску
  const filteredEmojis = search
    ? Object.values(EMOJI_CATEGORIES).flat().filter(emoji =>
        emoji.includes(search) ||
        Object.keys(EMOJI_CATEGORIES).some(cat =>
          cat.toLowerCase().includes(search.toLowerCase()) &&
          EMOJI_CATEGORIES[cat].includes(emoji)
        )
      )
    : EMOJI_CATEGORIES[activeCategory];

  return (
    <div
      className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {/* Поиск */}
      <div className="p-2 border-b border-slate-200 dark:border-slate-700">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск эмодзи..."
          className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Категории */}
      {!search && (
        <div className="flex gap-1 p-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
          {Object.keys(EMOJI_CATEGORIES).map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                activeCategory === category
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      )}

      {/* Grid эмодзи */}
      <div className="p-2 overflow-y-auto" style={{ height: search ? 'calc(100% - 52px)' : 'calc(100% - 92px)' }}>
        <div className="grid grid-cols-8 gap-1">
          {filteredEmojis.map((emoji, idx) => (
            <button
              key={idx}
              onClick={() => handleEmojiClick(emoji)}
              className="w-9 h-9 flex items-center justify-center text-2xl hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
        {filteredEmojis.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm">
            Ничего не найдено
          </div>
        )}
      </div>
    </div>
  );
}
