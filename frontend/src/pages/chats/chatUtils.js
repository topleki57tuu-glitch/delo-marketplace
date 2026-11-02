// Справочники и форматирование для раздела «Сообщения»: статусы чатов,
// фильтры, время сообщений, быстрые фразы и звук входящего сообщения.
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import format from 'date-fns/format';
import isToday from 'date-fns/isToday';
import isYesterday from 'date-fns/isYesterday';
import ru from 'date-fns/locale/ru';
import { parseServerDate } from '../../utils/format.js';

export const CHAT_STATUS = {
  open: { label: 'Открыт', cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  in_progress: { label: 'В работе', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  disputed: { label: 'Спор', cls: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  completed: { label: 'Завершён', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  cancelled: { label: 'Отменён', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

export const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'В работе' },
  { id: 'completed', label: 'Завершённые' },
];

export const isDesktop = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches;

// Форматирование времени для чата
export function formatMessageTime(dateStr) {
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
export function formatRelativeTime(dateStr) {
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

// Быстрые фразы — свои у каждой стороны сделки: раньше заказчику предлагались
// фразы исполнителя («Приступаю к выполнению работы!»).
export const QUICK_TEMPLATES = {
  specialist: [
    'Здравствуйте! Готов обсудить детали задачи.',
    'Подскажите, пожалуйста, какие сроки для вас в приоритете?',
    'Уточните, пожалуйста, есть ли готовое ТЗ или примеры?',
    'Всё понятно, приступаю к выполнению работы!',
    'Отправил предварительные результаты на согласование.',
  ],
  customer: [
    'Здравствуйте! Когда сможете приступить?',
    'Сколько времени займёт работа?',
    'Нужно ли что-то подготовить с моей стороны?',
    'Пришлите, пожалуйста, промежуточный результат.',
    'Спасибо, всё отлично! Принимаю работу.',
  ],
};

// Один AudioContext на вкладку. Раньше на каждое входящее сообщение
// создавался новый и не закрывался: браузеры ограничивают их число, и в
// долгой переписке создание начинало падать (а с ним — обработка сообщения).
let audioContext = null;

export function playNotificationSound() {
  // Простой beep звук (можно заменить на загрузку audio файла)
  const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtx) return;
  try {
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioCtx();
    // Без жеста пользователя контекст может стартовать «на паузе».
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

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
  } catch {
    // Звук — украшение: без него переписка работает так же.
  }
}
