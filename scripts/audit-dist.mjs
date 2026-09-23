#!/usr/bin/env node
/**
 * Аудит бюджетов (BRIEF §14): размеры бандлов dist/ (raw / gzip), стартовый JS без three-чанка,
 * передача главной (все ресурсы страницы, gzip-оценка), результат — docs/perf.md.
 *   node scripts/audit-dist.mjs [base=http://127.0.0.1:4331]
 * Перед запуском: npm run build и preview-сервер (cybermove-preview).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4331';
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const gz = (buf) => gzipSync(buf, { level: 6 }).length;

// ---------- бандлы
const assets = readdirSync('dist/_astro').filter((f) => /\.(js|css)$/.test(f)).map((f) => {
  const buf = readFileSync(`dist/_astro/${f}`);
  return { file: f, raw: buf.length, gzip: gz(buf) };
});
assets.sort((a, b) => b.gzip - a.gzip);
const isThree = (f) => /^(three|debug|shapes\.worker)/.test(f);
const startupJs = assets.filter((a) => a.file.endsWith('.js') && !isThree(a.file));
const startupJsGzip = startupJs.reduce((s, a) => s + a.gzip, 0);

// ---------- передача главной: реальные запросы
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
async function measure(path, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const items = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!url.startsWith(base)) return;
      const body = await res.body();
      const type = res.headers()['content-type'] || '';
      const compressible = /text|javascript|json|svg|xml/.test(type);
      items.push({ url: url.replace(base, ''), raw: body.length, transfer: compressible ? gz(body) : body.length, type: type.split(';')[0] });
    } catch {}
  });
  const t0 = Date.now();
  await page.addInitScript(() => {
    window.__lcp = null;
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp = { t: e.startTime, el: e.element ? e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.className ? '.' + String(e.element.className).split(' ')[0] : '') : null };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(4000);
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), lcp: window.__lcp ? Math.round(window.__lcp.t) : null, lcpEl: window.__lcp ? window.__lcp.el : null, cls: +window.__cls.toFixed(4) };
  });
  await ctx.close();
  const total = items.reduce((s, i) => s + i.transfer, 0);
  const byType = {};
  for (const i of items) {
    const k = /font/.test(i.type) || i.url.endsWith('.woff2') ? 'fonts' : /javascript/.test(i.type) ? 'js' : /css/.test(i.type) ? 'css' : /html/.test(i.type) ? 'html' : /image/.test(i.type) ? 'images' : 'other';
    byType[k] = (byType[k] || 0) + i.transfer;
  }
  return { items, total, byType, timing, wall: Date.now() - t0 };
}
const home = await measure('/');
const homeMobile = await measure('/', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const inner = await measure('/services/systems/');
await browser.close();

const lines = [];
lines.push('# Замеры производительности (Фаза 5)', '', `Дата: ${new Date().toISOString().slice(0, 10)}. Измерено на превью dist/ (Playwright, Chromium + SwiftShader; передача — gzip-оценка тела ответа уровня 6).`, '');
lines.push('## Бандлы dist/_astro', '', '| Файл | Raw | Gzip |', '|---|---|---|');
for (const a of assets) lines.push(`| ${a.file} | ${kb(a.raw)} | ${kb(a.gzip)} |`);
lines.push('', `**Стартовый JS без three-чанка (gzip): ${kb(startupJsGzip)}** — бюджет 150 KB.`, '');
const fmtByType = (m) => Object.entries(m.byType).map(([k, v]) => `${k} ${kb(v)}`).join(', ');
lines.push('## Передача страниц (все ресурсы, gzip-оценка)', '');
lines.push(`- Главная 1440×900: **${kb(home.total)}** (${fmtByType(home)}) — бюджет 2.5 MB без аудио. LCP-элемент: ${home.timing.lcpEl}, LCP ${home.timing.lcp} мс (SwiftShader), CLS ${home.timing.cls}.`);
lines.push(`- Главная 390×844 (mobile): **${kb(homeMobile.total)}** (${fmtByType(homeMobile)}). LCP ${homeMobile.timing.lcp} мс, CLS ${homeMobile.timing.cls}.`);
lines.push(`- /services/systems/: **${kb(inner.total)}** (${fmtByType(inner)}). LCP ${inner.timing.lcp} мс, CLS ${inner.timing.cls}.`, '');
lines.push('## Запросы главной (десктоп)', '', '| Ресурс | Raw | Передача |', '|---|---|---|');
for (const i of home.items.sort((a, b) => b.transfer - a.transfer)) lines.push(`| ${i.url} | ${kb(i.raw)} | ${kb(i.transfer)} |`);
writeFileSync('docs/perf.md', lines.join('\n') + '\n');
console.log(lines.slice(0, 4).join('\n'));
console.log(`startup JS gzip: ${kb(startupJsGzip)}; home total: ${kb(home.total)}; mobile: ${kb(homeMobile.total)}; inner: ${kb(inner.total)}`);
console.log('LCP home:', home.timing, '\nLCP mobile:', homeMobile.timing);
