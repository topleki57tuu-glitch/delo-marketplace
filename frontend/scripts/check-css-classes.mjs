#!/usr/bin/env node
/**
 * Проверяет, что у каждого класса из className есть правило в собранном CSS.
 *
 * Зачем. Коммит ec1271f переписал index.css со светлой палитрой и вместе
 * с блоком тёмных токенов выкинул @utility glass и одиннадцать токенов цвета.
 * В разметке они остались — 16 мест с glass и ~170 с text-ink, text-muted,
 * border-border и прочими. Tailwind в такой ситуации не падает и ничего не
 * пишет в лог: он просто не генерирует правило, потому что не знает такого
 * класса. Класс в разметке есть, правила нет, ошибки нет нигде.
 *
 * Сборка проходила, vitest 20/20 проходил, и дефект жил до скриншота от
 * пользователя: панель уведомлений оказалась полностью прозрачной, текст
 * накладывался на текст страницы. Это тот же класс отказа, что потерянный
 * платёж — внешняя система свою часть сделала, наше состояние за ней не
 * последовало, и ни одна проверка об этом не сообщила.
 *
 * Что делает скрипт. Берёт собранный CSS и все className из src, и для
 * каждого класса ищет селектор. Не нашёл — печатает класс, файл и строку
 * и выходит с кодом 1.
 *
 * Известные пропуски (старый долг в CSS страниц товаров) лежат в
 * css-baseline.json и CI не валят — падает только новый пропуск.
 * Перезаписать baseline текущим состоянием: --update.
 *
 * Запускать ПОСЛЕ сборки: npm run build && node scripts/check-css-classes.mjs
 *
 * Каталог с CSS можно задать первым аргументом или через CSS_DIR — нужно,
 * когда сборка идёт не в dist (например, при отладке в отдельный каталог).
 *
 * Почему по собранному CSS, а не по index.css. Источник правды — то, что
 * реально уехало в браузер. Проверка по исходнику пропустила бы ровно этот
 * случай: в index.css класс glass тоже отсутствовал, но заметить это можно
 * было только сопоставив два файла вручную.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CSS_DIR = process.argv[2] || process.env.CSS_DIR || 'dist/assets';
const SRC_DIR = 'src';
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

/** Каталоги, которые не наш код. */
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist', 'dist-check', '.git']);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (!SKIP_DIRS.has(entry)) walk(full, out);
        } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Заменяет подстановки в шаблонной строке на их содержимое.
 *
 *   `avatar avatar-${size}`                    → `avatar avatar- `
 *   `${active ? 'text-accent' : 'text-muted'}` → ` text-accent text-muted`
 *
 * Нужно, чтобы имена переменных не принимались за классы: `${size}` — это
 * выражение, а не класс, и без чистки проверка ругалась бы на size, cat,
 * categoryFilter и прочие имена из кода.
 *
 * Кавычки внутри подстановки сохраняем — там как раз лежат классы. Текст
 * без кавычек заменяем пробелом: иначе `bg-${color}-500` склеивается в
 * несуществующий `bg--500`, и проверка ругается на собственную склейку.
 */
function stripSimpleInterpolations(text) {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== '$' || text[i + 1] !== '{') {
            out += text[i];
            continue;
        }
        let depth = 0;
        let end = i + 1;
        for (; end < text.length; end += 1) {
            if (text[end] === '{') depth += 1;
            else if (text[end] === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        const inner = text.slice(i + 2, end);
        const literals = inner.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g);
        out += literals ? ` ${literals.join(' ')} ` : ' ';
        i = end;
    }
    return out;
}

/**
 * Достаёт строковые литералы из значений className.
 *
 * Разбираем только содержимое кавычек и шаблонов, а не выражение целиком:
 * иначе в классы попадут имена переменных и функций, и проверка начнёт
 * ругаться на clsx, cn, styles и прочее, что классом не является.
 */
function extractClassLiterals(source) {
    const literals = [];
    const attr = /className\s*=\s*/g;
    let match;

    while ((match = attr.exec(source)) !== null) {
        const start = attr.lastIndex;
        const ch = source[start];

        if (ch === '"' || ch === "'" || ch === '`') {
            const end = source.indexOf(ch, start + 1);
            if (end > start) {
                let text = source.slice(start + 1, end);
                if (ch === '`') text = stripSimpleInterpolations(text);
                literals.push({ text, at: start });
            }
            attr.lastIndex = start + 1;
            continue;
        }

        if (ch !== '{') continue;

        // Значение в фигурных скобках: ищем парную закрывающую, считая
        // вложенность — внутри бывают шаблоны с ${...}.
        let depth = 0;
        let end = start;
        for (; end < source.length; end += 1) {
            if (source[end] === '{') depth += 1;
            else if (source[end] === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        const expression = source.slice(start + 1, end);

        // Из выражения берём только строковые и шаблонные литералы.
        const literal = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
        let inner;
        while ((inner = literal.exec(expression)) !== null) {
            // Литерал сразу после ( , или = — это аргумент вызова или
            // значение свойства, а не класс: navLinkClass('/tasks'),
            // styles['card']. Маршруты и ключи объектов классом не являются.
            const before = expression.slice(0, inner.index).replace(/\s+$/, '').slice(-1);
            if (before === '(' || before === ',' || before === '=' || before === '[') continue;

            let text = inner[2];
            if (inner[1] === '`') text = stripSimpleInterpolations(text);
            literals.push({ text, at: start + 1 + inner.index });
        }
        attr.lastIndex = end + 1;
    }

    return literals;
}

function lineOf(source, index) {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i += 1) {
        if (source[i] === '\n') line += 1;
    }
    return line;
}

/** CSS без экранирования: .hover\:bg-x → .hover:bg-x, чтобы сравнение было прямым. */
function readBundleCss() {
    let css = '';
    let files = 0;
    for (const entry of readdirSync(CSS_DIR)) {
        if (!entry.endsWith('.css')) continue;
        css += readFileSync(join(CSS_DIR, entry), 'utf8');
        files += 1;
    }
    if (files === 0) {
        console.error(`В ${CSS_DIR} нет ни одного .css — сначала соберите фронтенд (npm run build).`);
        process.exit(1);
    }
    return css.replace(/\\/g, '');
}

/** Селектор есть, если после имени класса не идёт продолжение имени. */
function hasSelector(css, token) {
    const needle = `.${token}`;
    let from = 0;
    for (;;) {
        const at = css.indexOf(needle, from);
        if (at === -1) return false;
        const next = css[at + needle.length];
        if (next === undefined || !/[a-zA-Z0-9_\-]/.test(next)) return true;
        from = at + 1;
    }
}

const css = readBundleCss();

const missing = new Map();
let checked = 0;

for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const { text, at } of extractClassLiterals(source)) {
        for (const raw of text.split(/\s+/)) {
            const token = raw.trim();
            if (!token) continue;
            // Токен без единой буквы — это ':' или '?' от тернарника, не класс.
            if (!/[a-zA-Z]/.test(token)) continue;
            // Неразобранная подстановка и обрывок вида `avatar-${size}` → avatar-.
            if (token.includes('${') || token.endsWith('-')) continue;
            if (!/^[a-zA-Z0-9!\-[\]/.%:#_]+$/.test(token)) continue;

            checked += 1;
            if (hasSelector(css, token)) continue;

            if (!missing.has(token)) missing.set(token, []);
            const where = missing.get(token);
            if (where.length < 3) {
                where.push(`${relative('.', file)}:${lineOf(source, at)}`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Baseline.
//
// Полная проверка находит и старый долг: в CSS страниц товаров есть классы,
// которых нет в разметке, и наоборот. Он не связан с палитрой и не должен
// валить CI — иначе проверку отключат в первый же день.
//
// Поэтому известные пропуски лежат в css-baseline.json, а падает только
// НОВЫЙ пропуск. Флаг --update перезаписывает baseline текущим состоянием.
// ---------------------------------------------------------------------------
const BASELINE_PATH = 'scripts/css-baseline.json';
const updateBaseline = process.argv.includes('--update');

let baseline = new Set();
try {
    baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}

if (updateBaseline) {
    const sorted = [...missing.keys()].sort();
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`Baseline обновлён: ${sorted.length} известных пропусков в ${BASELINE_PATH}`);
    process.exit(0);
}

const regressions = [...missing.keys()].filter(token => !baseline.has(token));
const stale = [...baseline].filter(token => !missing.has(token));

if (stale.length > 0) {
    console.log(`Baseline: ${stale.length} записей больше не воспроизводятся — можно убрать (--update):`);
    console.log(`  ${stale.join(', ')}`);
}

if (regressions.length === 0) {
    console.log(`CSS: все ${checked} классов из className есть в бандле (известных пропусков: ${baseline.size})`);
    process.exit(0);
}

console.error(`\nCSS: классов из className без правила в бандле — ${regressions.length}.\n`);
console.error('Класс в разметке есть, селектора нет. Tailwind такой класс не знает');
console.error('и молча не генерирует правило: сборка и тесты этого не видят.');
console.error('Именно так панель уведомлений оказалась прозрачной.\n');

for (const token of regressions.sort()) {
    console.error(`  ${token}`);
    for (const place of missing.get(token)) console.error(`      ${place}`);
}

console.error('\nЛибо опечатка, либо класс удалён из index.css (@theme/@utility),');
console.error('либо для него не установлен плагин. Если пропуск намеренный —');
console.error('внесите его в css-baseline.json через: node scripts/check-css-classes.mjs --update');
process.exit(1);
