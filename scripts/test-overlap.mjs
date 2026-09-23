#!/usr/bin/env node
/**
 * Проверка раскладки S7 (BRIEF-V1 §2): на семи размерах экрана смотрим, пересекаются ли карточки ленты
 * со счётчиками и не обрезаны ли карточки низом пина.
 *   node scripts/test-overlap.mjs [--base http://127.0.0.1:4341] [--shots docs/screens/v1/s7] [--ink]
 * Флаг `--ink` включает проверку «нет тёмных пикселей в полосе шапки» — она имеет смысл только
 * для светлой палитры версии 4; в версии 1 фон чёрный, и эта метрика неинформативна.
 */
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const base = get('--base', 'http://127.0.0.1:4341');
const shots = get('--shots', '');
const inkCheck = args.includes('--ink');
const SIZES = [
  { name: '390x664', width: 390, height: 664, mobile: true },
  { name: '375x667', width: 375, height: 667, mobile: true },
  { name: '360x640', width: 360, height: 640, mobile: true },
  { name: '430x932', width: 430, height: 932, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '1280x720', width: 1280, height: 720, mobile: false },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
];

if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
let fails = 0;
for (const s of SIZES) {
  const ctx = await browser.newContext(
    s.mobile
      ? { ...devices['Pixel 7'], viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 }
      : { viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 },
  );
  const page = await ctx.newPage();
  await page.goto(`${base}/?still&t=6&tier=low&screen=6&local=0.62`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    const counters = document.querySelector('[data-counters]');
    const cards = Array.from(document.querySelectorAll('.screen--s7 .card'));
    const cr = rect(counters);
    let worst = 0;
    let clipped = 0;
    const pin = document.querySelector('.screen--s7 .screen__pin');
    const pr = rect(pin);
    for (const c of cards) {
      const b = rect(c);
      if (b.right < 0 || b.left > window.innerWidth) continue; // за кадром по горизонтали
      const overlap = Math.min(b.bottom, cr.bottom) - Math.max(b.top, cr.top);
      const hOverlap = Math.min(b.right, cr.right) - Math.max(b.left, cr.left);
      if (overlap > 0 && hOverlap > 0) worst = Math.max(worst, overlap);
      // карточка целиком в пине по вертикали
      if (b.bottom > pr.bottom + 1) clipped = Math.max(clipped, b.bottom - pr.bottom);
    }
    const firstCard = cards[0] ? rect(cards[0]) : null;
    return { counters: cr, overlapPx: worst, clippedPx: clipped, firstCardLeft: firstCard ? firstCard.left : null, header: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 72 };
  });
  // пиксельная проверка полосы шапки: в ней не должно быть линий сцены (канвас под шапкой = чистый фон)
  const headerInk = !inkCheck ? null : await page.evaluate(async (headerH) => {
    const canvas = document.querySelector('#gl');
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) return null;
    const dpr = canvas.width / window.innerWidth;
    const w = canvas.width;
    const h = Math.max(1, Math.round((headerH - 8) * dpr));
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, canvas.height - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // считаем «тёмные» пиксели: линии туши на бумаге дают резкое падение яркости
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 190) dark++;
    return { dark, total: px.length / 4 };
  }, r.header);
  const line = `${s.name}: наложение карточек на счётчики ${r.overlapPx.toFixed(0)} px, обрезано снизу ${r.clippedPx.toFixed(0)} px, первая карточка x ${r.firstCardLeft === null ? '—' : r.firstCardLeft.toFixed(0)}${headerInk ? `, тёмных пикселей в полосе шапки ${headerInk.dark}` : ''}`;
  const ok = r.overlapPx < 1 && r.clippedPx < 1 && (!headerInk || headerInk.dark < headerInk.total * 0.002);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`);
  if (shots) await page.screenshot({ path: path.join(shots, `s7-${s.name}.png`) });
  await ctx.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
