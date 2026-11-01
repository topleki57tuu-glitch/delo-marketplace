/**
 * Перезагрузка страницы, когда после деплоя не нашёлся чанк.
 *
 * Страницы грузятся лениво (React.lazy в App.jsx), а каждый деплой собирает
 * образ заново — чанков старой сборки на сервере больше нет. Вкладка,
 * открытая до деплоя, держит старый index.html и при переходе на ещё не
 * открытую страницу просит несуществующий файл. Пользователь видел экран
 * «Что-то пошло не так». Одна перезагрузка берёт свежий index.html (nginx
 * отдаёт его с no-cache, см. frontend/nginx.conf), и переход проходит.
 *
 * Vite сообщает о такой ошибке событием vite:preloadError. Перезагружаем не
 * чаще раза в минуту и только при наличии сети: если чанк недоступен по
 * другой причине, бесконечной перезагрузки не будет — сработает ErrorBoundary.
 */
const STORAGE_KEY = 'delo:chunk-reload-at';
export const RELOAD_COOLDOWN_MS = 60_000;

export function shouldReload(storage, now = Date.now()) {
  try {
    const last = Number(storage.getItem(STORAGE_KEY)) || 0;
    if (now - last < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(STORAGE_KEY, String(now));
    return true;
  } catch {
    // Хранилище недоступно — не сможем отличить первую попытку от цикла.
    return false;
  }
}

export function installChunkReload(win = window) {
  win.addEventListener('vite:preloadError', () => {
    if (win.navigator?.onLine === false) return;
    if (shouldReload(win.sessionStorage)) win.location.reload();
  });
}
