import { useSyncExternalStore } from 'react';

/*
 * Тема оформления: светлая, тёмная или «как в системе».
 *
 * Раньше тёмная тема включалась только настройкой операционной системы
 * (@media prefers-color-scheme), и выбрать её на сайте было нельзя. Теперь
 * выбор хранится в localStorage, а тема — это класс .dark на <html>
 * (см. @custom-variant dark в index.css).
 *
 * Тот же алгоритм продублирован в крошечном скрипте в index.html: он ставит
 * класс до первой отрисовки, иначе при тёмной теме страница на долю секунды
 * вспыхивала бы светлой, пока грузится JavaScript. Ключ и значения в обоих
 * местах должны совпадать.
 */

export const THEME_STORAGE_KEY = 'delo-theme';
export const THEME_PREFERENCES = ['light', 'dark', 'system'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemQuery() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(DARK_QUERY);
}

/** Сохранённый выбор пользователя; по умолчанию — «как в системе». */
export function readThemePreference() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_PREFERENCES.includes(value) ? value : 'system';
  } catch {
    // Safari в приватном режиме и запрет cookies бросают исключение
    return 'system';
  }
}

/** Какая тема на самом деле будет показана: 'light' или 'dark'. */
export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemQuery()?.matches ? 'dark' : 'light';
}

/**
 * Применяет тему к документу. Переходы цветов на время переключения
 * отключаются: у сотен элементов стоит transition-colors, и без этого
 * страница «перетекала» бы из одной темы в другую по кускам.
 */
export function applyTheme(preference, { animate = false } = {}) {
  const resolved = resolveTheme(preference);
  if (typeof document === 'undefined') return resolved;
  const root = document.documentElement;

  let pause = null;
  if (!animate && document.head) {
    pause = document.createElement('style');
    pause.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.appendChild(pause);
  }

  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  if (pause) {
    // Принудительный пересчёт стилей, затем возвращаем переходы
    void window.getComputedStyle(root).opacity;
    window.setTimeout(() => pause.remove(), 0);
  }
  return resolved;
}

/* --- Хранилище для React --------------------------------------------- */

const listeners = new Set();
let snapshot = null;

function emit(preference) {
  snapshot = { preference, resolved: applyTheme(preference) };
  listeners.forEach((listener) => listener());
}

export function getThemeSnapshot() {
  if (!snapshot) {
    const preference = readThemePreference();
    snapshot = { preference, resolved: resolveTheme(preference) };
  }
  return snapshot;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Сохраняет выбор и сразу перекрашивает страницу. */
export function setThemePreference(preference) {
  if (!THEME_PREFERENCES.includes(preference)) return;
  try {
    // «Как в системе» — это отсутствие выбора: ключ просто удаляем
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Не смогли сохранить — тема всё равно сменится до перезагрузки
  }
  emit(preference);
}

let initialized = false;

/**
 * Вызывается один раз при старте приложения: применяет сохранённую тему и
 * следит за сменой темы в системе (для режима «как в системе») и за выбором
 * в соседних вкладках.
 */
export function initTheme() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  emit(readThemePreference());

  const query = systemQuery();
  const onSystemChange = () => {
    if (getThemeSnapshot().preference === 'system') emit('system');
  };
  if (query?.addEventListener) query.addEventListener('change', onSystemChange);
  else if (query?.addListener) query.addListener(onSystemChange);

  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) emit(readThemePreference());
  });
}

/** Для тестов: сбросить состояние модуля. */
export function resetThemeForTests() {
  snapshot = null;
  initialized = false;
  listeners.clear();
}

/**
 * Хук: { preference, resolved, setTheme, toggleTheme }.
 * toggleTheme переключает между светлой и тёмной относительно того, что
 * видно сейчас, — так кнопка в шапке работает и из режима «как в системе».
 */
export function useTheme() {
  const state = useSyncExternalStore(subscribe, getThemeSnapshot, getThemeSnapshot);
  return {
    ...state,
    setTheme: setThemePreference,
    toggleTheme: () => setThemePreference(state.resolved === 'dark' ? 'light' : 'dark'),
  };
}
