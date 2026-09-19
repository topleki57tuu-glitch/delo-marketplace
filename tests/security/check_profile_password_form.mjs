/**
 * Проверка формы смены пароля в профиле — через браузер, а не через API.
 *
 * Запуск (подняты фронтенд на :3000 и бэкенд на :8000):
 *   NODE_PATH="C:/Users/armen/.workbuddy-ai/binaries/node/workspace/node_modules" \
 *     node tests/security/check_profile_password_form.mjs
 *
 * Что доказываем: форму видно, она отказывает на неверном текущем пароле и на
 * несовпадающем повторе, а на верных данных действительно меняет пароль —
 * это подтверждается отдельным входом по новому паролю через API. Проверять
 * только всплывающее сообщение нельзя: тост «Пароль изменён» рисуется по факту
 * ответа 200, но не доказывает, что пароль в базе другой.
 *
 * ВНИМАНИЕ: скрипт на время меняет пароль admin@delo.ru и в конце возвращает
 * исходный (шаг 6). Если прогон прервать между шагами 5 и 6, пароль останется
 * новым — тогда верни доступ через backend/set_password.py.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// playwright стоит не в проекте, а в изолированном окружении ассистента.
// Импорт по имени через NODE_PATH в ESM не работает — резолвим вручную.
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  const fallback = createRequire(
    'C:/Users/armen/.workbuddy-ai/binaries/node/workspace/'
  );
  ({ chromium } = fallback('playwright'));
}

const HERE = dirname(fileURLToPath(import.meta.url));
// Скрипт лежит в tests/security: корень репозитория на два уровня выше.
const ROOT = join(HERE, '..', '..');
const API = 'http://127.0.0.1:8000';
const SITE = 'http://127.0.0.1:3000';
const EMAIL = 'admin@delo.ru';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'OK  ' : 'ПРОВАЛ'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function readPassword() {
  const text = readFileSync(join(ROOT, 'backend', 'demo_password.txt'), 'utf8');
  const m = text.match(/^admin_password\s*=\s*(\S+)/m);
  if (!m) throw new Error('в demo_password.txt нет строки admin_password');
  return m[1];
}

async function apiLogin(email, password) {
  const body = new URLSearchParams({ username: email, password });
  const res = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return { status: res.status, data: null };
  return { status: res.status, data: await res.json() };
}

async function toastTexts(page) {
  return page.$$eval('[role="status"]', (nodes) =>
    nodes.map((n) => n.textContent.trim())
  );
}

async function waitForToast(page, needle, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const texts = await toastTexts(page);
    const hit = texts.find((t) => t.includes(needle));
    if (hit) return hit;
    await page.waitForTimeout(200);
  }
  return null;
}

const currentPassword = readPassword();
const newPassword = `Probe-${Date.now().toString().slice(-8)}x9`;

const session = await apiLogin(EMAIL, currentPassword);
if (!session.data) {
  // 429 здесь — не «неверный пароль», а забитый лимит: check26 намеренно
  // выжигает восемь попыток по admin@delo.ru, и следующий вход отбивается
  // ещё 15 минут. Различаем, чтобы не искать несуществующую проблему.
  const hint =
    session.status === 429
      ? 'лимит попыток по аккаунту уже забит — перезапусти бэкенд'
      : 'проверь demo_password.txt и бэкенд';
  console.error(`не удалось войти текущим паролем (HTTP ${session.status}): ${hint}`);
  process.exit(1);
}
const sessionToken = session.data.access_token;

// Версия playwright из окружения ассистента новее, чем скачанные браузеры:
// пакет просит ревизию 1243, а на диске лежат 1208 и 1223. Поэтому сначала
// пробуем как обычно, а при отсутствии бинарника берём то, что установлено.
function findInstalledShell() {
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  let entries = [];
  try {
    entries = readdirSync(base);
  } catch {
    return null;
  }
  const shells = entries
    .filter((n) => n.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const dir of shells) {
    const exe = join(base, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    if (!String(err.message).includes("Executable doesn't exist")) throw err;
    const exe = findInstalledShell();
    if (!exe) throw err;
    console.log(`[инфо] беру установленный браузер: ${exe}`);
    return chromium.launch({ executablePath: exe });
  }
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Подкладываем сессию в localStorage: форма входа здесь не предмет проверки,
// а прогонять её значило бы тратить попытки лимита на вход.
await page.addInitScript(
  ([token]) => {
    localStorage.setItem(
      'auth',
      JSON.stringify({ state: { token, role: 'customer', user: null, isAuth: true }, version: 0 })
    );
  },
  [sessionToken]
);

console.log('='.repeat(68));
console.log('1. Карточка «Безопасность» есть в профиле');
console.log('='.repeat(68));
await page.goto(`${SITE}/profile`, { waitUntil: 'domcontentloaded' });

// exact: true обязателен. По подстроке «Безопасность» находится ещё и
// заголовок «Безопасность и доверие сервиса «ДЕЛО»», локатор становится
// неоднозначным и Playwright падает — а проглоченное исключение выглядело
// как «карточки нет», хотя она на месте.
const heading = page.getByRole('heading', { name: 'Безопасность', exact: true });
const toggle = page.getByRole('button', { name: 'Сменить пароль' });
let headingVisible = true;
try {
  await heading.waitFor({ state: 'visible', timeout: 20000 });
} catch (err) {
  headingVisible = false;
  const headingCount = await heading.count();
  const toggleCount = await toggle.count();
  console.log(`  заголовков «Безопасность»: ${headingCount}, кнопок «Сменить пароль»: ${toggleCount}`);
  console.log(`  адрес страницы: ${page.url()}`);
  console.log(`  причина: ${String(err.message).split('\n')[0]}`);
}
record('заголовок «Безопасность» виден', headingVisible);
if (!headingVisible) {
  await page.screenshot({ path: join(ROOT, '..', 'visual-check', '27-profile-no-card.png'), fullPage: true });
  await browser.close();
  process.exit(1);
}
record('кнопка «Сменить пароль» видна', (await toggle.count()) === 1);

console.log();
console.log('='.repeat(68));
console.log('2. Форма раскрывается по кнопке');
console.log('='.repeat(68));
await page.getByRole('button', { name: 'Сменить пароль' }).first().click();
const curField = page.getByLabel('Текущий пароль');
const curVisible = await curField
  .waitFor({ state: 'visible', timeout: 5000 })
  .then(() => true)
  .catch(() => false);
record('поле «Текущий пароль» появилось', curVisible);

console.log();
console.log('='.repeat(68));
console.log('3. Повтор нового пароля не совпадает — отказ до запроса');
console.log('='.repeat(68));
await curField.fill(currentPassword);
await page.getByLabel('Новый пароль', { exact: true }).fill(newPassword);
await page.getByLabel('Повторите новый пароль').fill(newPassword + 'опечатка');
await page.getByRole('button', { name: 'Сменить пароль' }).last().click();
const mismatchToast = await waitForToast(page, 'не совпадают');
record('показано «Новый пароль и повтор не совпадают»', Boolean(mismatchToast), mismatchToast || 'тоста нет');

console.log();
console.log('='.repeat(68));
console.log('4. Неверный текущий пароль — отказ от бэкенда');
console.log('='.repeat(68));
await curField.fill('заведомо-неверный-пароль');
await page.getByLabel('Повторите новый пароль').fill(newPassword);
await page.getByRole('button', { name: 'Сменить пароль' }).last().click();
const wrongToast = await waitForToast(page, 'неверно');
record('бэкенд отбил неверный текущий пароль', Boolean(wrongToast), wrongToast || 'тоста нет');

console.log();
console.log('='.repeat(68));
console.log('5. Верные данные — пароль действительно меняется');
console.log('='.repeat(68));
await curField.fill(currentPassword);
await page.getByRole('button', { name: 'Сменить пароль' }).last().click();
const okToast = await waitForToast(page, 'Пароль изменён');
record('показано «Пароль изменён»', Boolean(okToast), okToast || 'тоста нет');
await page.waitForTimeout(500);
await page.screenshot({ path: join(ROOT, '..', 'visual-check', '27-profile-password-changed.png'), fullPage: true });

// Главное доказательство: тост мог бы нарисоваться и при неудаче, поэтому
// проверяем пароль снаружи — отдельным входом через API.
const withNew = await apiLogin(EMAIL, newPassword);
record('вход по НОВОМУ паролю через API', Boolean(withNew.data), `HTTP ${withNew.status}`);
const withOld = await apiLogin(EMAIL, currentPassword);
record('вход по СТАРОМУ паролю отклонён', !withOld.data, `HTTP ${withOld.status}`);

// Возвращаем исходный пароль. Проверка не должна оставлять систему в другом
// состоянии, чем нашла: иначе следующий запуск (или человек) не войдёт тем
// паролем, что записан в demo_password.txt, и будет искать причину.
console.log();
console.log('='.repeat(68));
console.log('6. Состояние возвращено как было');
console.log('='.repeat(68));
const restore = withNew.data
  ? await fetch(`${API}/users/me/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${withNew.data.access_token}`,
      },
      body: JSON.stringify({ current_password: newPassword, new_password: currentPassword }),
    })
  : null;
record('исходный пароль возвращён', Boolean(restore && restore.ok), restore ? `HTTP ${restore.status}` : 'вход новым паролем не удался');
if (restore && restore.ok) {
  const backToOriginal = await apiLogin(EMAIL, currentPassword);
  record(
    'вход исходным паролем снова работает',
    Boolean(backToOriginal.data),
    `HTTP ${backToOriginal.status}`
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`Проверок: ${results.length}, провалено: ${failed.length}`);
failed.forEach((r) => console.log(`  ПРОВАЛ: ${r.name}`));

await browser.close();
process.exit(failed.length ? 1 : 0);
