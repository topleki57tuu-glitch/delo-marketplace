#!/usr/bin/env node
/**
 * Растровые иконки и превью для соцсетей из SVG-исходников.
 *
 *   public/favicon.svg       -> public/favicon.ico (16, 32, 48)
 *                               public/icons/icon-192.png, icon-512.png
 *   brand/icon-maskable.svg  -> public/icons/maskable-512.png
 *                               public/apple-touch-icon.png (180)
 *   brand/og-image.svg       -> public/og-image.png (1200x630)
 *
 * Готовые PNG и ICO лежат в репозитории, в `npm run build` скрипт не входит:
 * запускать его нужно только после правки SVG.
 *
 *   npm install --no-save @resvg/resvg-wasm@2.6.2
 *   node scripts/build-brand-assets.mjs
 *
 * resvg-wasm — рендерер SVG на WebAssembly: без нативных модулей, результат
 * одинаковый на любой ОС. В зависимости проекта он не добавлен намеренно:
 * нужен раз в несколько месяцев, а не на каждой сборке.
 *
 * Текст в og-image.svg переведён в кривые, поэтому шрифты для рендера
 * не нужны. Чтобы поменять надпись, проще всего сверстать её в браузере
 * шрифтами Unbounded/Manrope и заменить <path> текста.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inRoot = (p) => path.join(root, p);

const PNG_TARGETS = [
  { from: 'public/favicon.svg', to: 'public/icons/icon-192.png', size: 192 },
  { from: 'public/favicon.svg', to: 'public/icons/icon-512.png', size: 512 },
  { from: 'brand/icon-maskable.svg', to: 'public/icons/maskable-512.png', size: 512 },
  { from: 'brand/icon-maskable.svg', to: 'public/apple-touch-icon.png', size: 180 },
  { from: 'brand/og-image.svg', to: 'public/og-image.png', size: 1200 },
];
const ICO_TARGET = { from: 'public/favicon.svg', to: 'public/favicon.ico', sizes: [16, 32, 48] };

async function loadRenderer() {
  let resvg;
  try {
    resvg = await import('@resvg/resvg-wasm');
  } catch {
    throw new Error(
      'не найден @resvg/resvg-wasm. Установите его без записи в package.json:\n' +
        '  npm install --no-save @resvg/resvg-wasm@2.6.2',
    );
  }
  const require = createRequire(import.meta.url);
  await resvg.initWasm(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

  return (svg, width) => {
    const renderer = new resvg.Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { loadSystemFonts: false },
    });
    const image = renderer.render();
    const png = Buffer.from(image.asPng());
    image.free();
    renderer.free();
    return png;
  };
}

// ICO с PNG внутри (формат Windows Vista+): понимают все современные
// браузеры, а файл в разы меньше классического BMP-варианта.
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

async function write(relPath, data) {
  const file = inRoot(relPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  console.log(`  ${relPath.padEnd(32)} ${(data.length / 1024).toFixed(1)} КБ`);
}

async function main() {
  const render = await loadRenderer();
  const sources = new Map();
  const svg = async (relPath) => {
    if (!sources.has(relPath)) sources.set(relPath, await readFile(inRoot(relPath), 'utf8'));
    return sources.get(relPath);
  };

  console.log('Брендовые ассеты:');
  for (const { from, to, size } of PNG_TARGETS) {
    await write(to, render(await svg(from), size));
  }

  const icoSource = await svg(ICO_TARGET.from);
  const images = ICO_TARGET.sizes.map((size) => ({ size, png: render(icoSource, size) }));
  await write(ICO_TARGET.to, buildIco(images));
}

main().catch((error) => {
  console.error(`build-brand-assets: ${error.message}`);
  process.exit(1);
});
