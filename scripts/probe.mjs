#!/usr/bin/env node
/**
 * Диагностика страницы через Playwright + SwiftShader: ошибки консоли и состояние движка/сценария.
 *   node scripts/probe.mjs "http://127.0.0.1:4330/?still&t=4&screen=2&local=0.45" [--mobile] [--wait 4000] [--eval "<js>"]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http'));
const get = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const mobile = args.includes('--mobile');
const wait = Number(get('--wait', 4000));
const extra = get('--eval', '');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] });
const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = [];
page.on('pageerror', (e) => log.push(`PAGEERROR ${e.message}\n${e.stack || ''}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') log.push(`${m.type().toUpperCase()} ${m.text()}`);
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(wait);
const info = await page.evaluate(async (extra) => {
  const e = window.__cmEngine;
  const s = window.__cm;
  const out = {
    engine: Boolean(e),
    tier: e?.tier?.name,
    stats: e?.stats,
    glReady: document.body.classList.contains('gl-ready'),
    fallback: document.body.dataset.glFallback,
    screen: document.body.dataset.screen,
    theme: document.documentElement.dataset.theme,
    status: document.querySelector('[data-status]')?.textContent,
    screens: s ? Array.from(s.screens).map((v) => Number(v.toFixed(3))) : null,
    targets: s ? Array.from(s.targets).map((v) => Number(v.toFixed(3))) : null,
    anchors: s ? Object.entries(s.anchors).filter(([, a]) => a.visible > 0.05).map(([k, a]) => `${k} ${a.x.toFixed(0)},${a.y.toFixed(0)} v${a.visible.toFixed(2)}${a.hot > 0.5 ? ' hot' : ''}`) : null,
    preloader: document.querySelector('[data-preloader]')?.className,
    preloaderStyle: (() => {
      const el = document.querySelector('[data-preloader]');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return `${cs.opacity} ${cs.visibility} ${cs.display}`;
    })(),
    canvasStyle: (() => {
      const el = document.querySelector('#gl');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return `${cs.opacity} ${cs.visibility} ${el.width}x${el.height} still=${el.dataset.still || ''}`;
    })(),
  };
  if (extra) {
    try {
      out.extra = await Promise.resolve(new Function(`return (${extra})`)());
    } catch (err) {
      out.extra = `ERR ${err.message}`;
    }
  }
  return out;
}, extra);
const shot = get('--shot', '');
if (shot) {
  await page.screenshot({ path: shot, animations: 'disabled', caret: 'hide' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot.replace(/\.png$/, '-b.png') });
}
console.log(JSON.stringify(info, null, 1));
if (log.length) console.log('--- console ---\n' + log.join('\n'));
await browser.close();
