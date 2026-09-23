#!/usr/bin/env node
/**
 * Постеры экранов (BRIEF §8.10): скриншоты канваса на HIGH по каждому экрану → AVIF/WebP в public/posters/,
 * OG-картинки 1200×630 (JPG) и рендеры объектов направлений для шапок внутренних страниц.
 *   node scripts/posters.mjs [base]
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:4330';
const out = 'public/posters';
await mkdir(out, { recursive: true });

// точки сюжета: [имя, query]
const SCREENS = [
  ['s1', 'still&t=6'],
  ['s2', 'still&t=8&screen=1&local=0.45'],
  ['s3', 'still&t=8&screen=2&local=0.5'],
  ['s4', 'still&t=8&screen=3&local=0.14'],
  ['s5', 'still&t=8&screen=4&local=0.5'],
  ['s6', 'still&t=8&screen=5&local=0.78'],
  ['s7', 'still&t=8&screen=6&local=0.6'],
  ['s8', 'still&t=8&screen=7&local=1'],
];
const DIR_OF = { s1: 'core', s2: 'audit', s3: 'systems', s4: 'brand-content', s5: 'traffic', s6: 'tenders-legal', s7: 'growth', s8: 'contact' };
const OG = { 'og-default': 's1', 'og-services': 's3', 'og-cases': 's7', 'og-about': 's1', 'og-contact': 's8', 'og-audit': 's2', 'og-systems': 's3', 'og-brand-content': 's4', 'og-traffic': 's5', 'og-tenders-legal': 's6' };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
async function shot(width, height, query) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`${base}/?${query}&tier=high&poster`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(3500);
  const buf = await page.screenshot({ type: 'png' });
  await ctx.close();
  return buf;
}
for (const [name, query] of SCREENS) {
  const t0 = Date.now();
  const land = await shot(1920, 1080, query);
  await sharp(land).webp({ quality: 78 }).toFile(`${out}/${name}.webp`);
  await sharp(land).avif({ quality: 52 }).toFile(`${out}/${name}.avif`);
  const port = await shot(900, 1600, query);
  await sharp(port).webp({ quality: 76 }).toFile(`${out}/${name}-m.webp`);
  await sharp(port).avif({ quality: 50 }).toFile(`${out}/${name}-m.avif`);
  // рендер объекта направления: правая часть кадра
  await sharp(land).extract({ left: 780, top: 0, width: 1140, height: 1080 }).resize({ width: 900 }).webp({ quality: 74 }).toFile(`${out}/dir-${DIR_OF[name]}.webp`);
  console.log(name, `${Date.now() - t0} ms`);
}
for (const [og, src] of Object.entries(OG)) {
  await sharp(`${out}/${src}.webp`).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82, mozjpeg: true }).toFile(`${out}/${og}.jpg`);
}
await browser.close();
console.log('готово:', out);
