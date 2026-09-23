#!/usr/bin/env node
/**
 * Гейт B (BRIEF-2 §9): прыжки раскладки на мобильном. Эмуляция телефона, скролл в середину экрана S3,
 * затем высота окна меняется на 60px (появление/скрытие адресной строки) — сглаженный прогресс активного
 * экрана не должен измениться больше чем на 0.01.
 *   node scripts/test-vh.mjs [base]
 */
import { chromium, devices } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4341';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${base}/?tier=low&nogl`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => ({ y: window.scrollY, screen: window.__cm.screen, local: window.__cm.screens[window.__cm.screen], target: window.__cm.targets[window.__cm.screen] }));
// в середину S3: три экрана по прогрессу
// середина четвёртого экрана считается по реальной раскладке (длительности у версий разные)
await page.evaluate(() => {
  const vh = window.innerHeight;
  const mobile = window.innerWidth < 900;
  let acc = 0;
  const els = Array.from(document.querySelectorAll('[data-stage] [data-screen]'));
  for (let i = 0; i < els.length; i++) {
    const d = Number((mobile && els[i].dataset.durMobile) || els[i].dataset.dur || 160);
    const dur = (d / 100) * vh;
    if (i === 3) {
      window.scrollTo(0, Math.round(acc + dur * 0.5));
      return;
    }
    acc += dur;
  }
});
// ждём, пока сглаженный прогресс догонит цель: иначе за «прыжок раскладки» принимается обычное сглаживание
for (let i = 0; i < 120; i++) {
  const gap = await page.evaluate(() => {
    const s = window.__cm;
    let g = 0;
    for (let k = 0; k < s.screens.length; k++) g = Math.max(g, Math.abs(s.screens[k] - s.targets[k]));
    return g;
  });
  if (gap < 0.002) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(400);
const before = await read();
console.log(`старт: экран ${before.screen}, local ${before.local.toFixed(4)}`);
let worst = 0;
for (const h of [784, 844, 784, 844]) {
  await page.setViewportSize({ width: 390, height: h });
  await page.waitForTimeout(400);
  const now = await read();
  const d = now.screen === before.screen ? Math.abs(now.local - before.local) : 1;
  worst = Math.max(worst, d);
  console.log(`height ${h}: screen ${now.screen} local ${now.local.toFixed(4)} (Δ ${d.toFixed(4)}) scrollY ${now.y}`);
}
await browser.close();
const ok = worst <= 0.01;
console.log(`${ok ? 'PASS' : 'FAIL'}: max Δ прогресса при смене высоты окна ${worst.toFixed(4)} ≤ 0.01`);
process.exit(ok ? 0 : 1);
