#!/usr/bin/env node
/**
 * Время кадра на мобильной эмуляции с троттлингом CPU ×4 (BRIEF-3 §7): прокрутка главной свайпами, каждый кадр
 * читает window.__cm.frame.dt (или интервал rAF), считает p50/p95/p99 и долю кадров > 16.7 мс.
 * Под SwiftShader абсолютные числа завышены — сравнивать «до/после» (docs/screens/v3/frame-*.json).
 *   node scripts/test-frame.mjs [--base http://127.0.0.1:4341] [--tier low] [--cpu 4] [--suffix name] [--desktop]
 */
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { base: 'http://127.0.0.1:4341', tier: 'low', cpu: 4, suffix: '', out: 'docs/screens/v3', desktop: false, nogl: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--base') opt.base = args[++i];
  else if (a === '--tier') opt.tier = args[++i];
  else if (a === '--cpu') opt.cpu = Number(args[++i]);
  else if (a === '--suffix') opt.suffix = args[++i];
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--desktop') opt.desktop = true;
  else if (a === '--nogl') opt.nogl = true;
}
await mkdir(opt.out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext(opt.desktop ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.cpu });
await page.goto(`${opt.base}/?tier=${opt.tier}${opt.nogl ? '&nogl' : ''}`, { waitUntil: 'networkidle', timeout: 240000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  (function loop(now) {
    const s = window.__cm;
    window.__frames.push({ t: now, raf: now - last, dt: s && s.frame ? s.frame.dt * 1000 : null, screen: s ? s.screen : -1 });
    last = now;
    requestAnimationFrame(loop);
  })(performance.now());
});
const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
let y = 0;
while (y < total) {
  const steps = [...Array(10).fill(36), 24, 16, 10, 6];
  for (const s of steps) {
    y += s;
    await page.evaluate((v) => window.scrollBy(0, v), s);
    await page.waitForTimeout(32);
  }
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1000);
const frames = await page.evaluate(() => window.__frames.slice(5));
await browser.close();

const rafs = frames.map((f) => f.raf).sort((a, b) => a - b);
const q = (p) => rafs[Math.min(rafs.length - 1, Math.floor(rafs.length * p))];
const summary = {
  mode: `${opt.desktop ? 'desktop' : 'mobile'} cpu×${opt.cpu} tier ${opt.tier}`,
  frames: rafs.length,
  p50Ms: Number(q(0.5).toFixed(1)),
  p95Ms: Number(q(0.95).toFixed(1)),
  p99Ms: Number(q(0.99).toFixed(1)),
  over16Pct: Number(((rafs.filter((r) => r > 16.7).length / rafs.length) * 100).toFixed(1)),
  over33Pct: Number(((rafs.filter((r) => r > 33.4).length / rafs.length) * 100).toFixed(1)),
};
const name = `frame-${opt.desktop ? 'desktop' : 'mobile'}${opt.suffix ? `-${opt.suffix}` : ''}.json`;
await writeFile(path.join(opt.out, name), JSON.stringify({ summary, frames }, null, 0));
console.log(JSON.stringify(summary));
