#!/usr/bin/env node
/**
 * Модель движения главной (BRIEF-3 §6.7). Четыре проверки на десктопе (1440×900) и тач-эмуляции (Pixel 7):
 *   (a) флик на тач: 2200 px за 250 мс (и 3600 px — через два экрана) — каждый переход ≥ 1.4 с, переходы последовательны;
 *   (b) колесо на десктопе: 12 шагов по 120 px за 400 мс — то же;
 *   (c) равномерная прокрутка всей страницы — |Δ сглаженного прогресса| за кадр ≤ 0.008;
 *   (d) во время переходов ни одного кадра, где активный экран меняется назад.
 * Каждый кадр читает window.__cm (state.screens, активный экран, dt) и пишет docs/screens/v3/C/scroll-<size>[-suffix].json
 * плюс видео прокрутки (webm) рядом.
 *
 *   node scripts/test-scroll.mjs [--base http://127.0.0.1:4331] [--sizes desktop,mobile] [--tier low] [--no-video] [--nogl] [--suffix name] [--out dir]
 *
 * Под SwiftShader кадры длинные (~100 мс), поэтому Δ нормируется к кадру 60 fps по формуле экспоненциального
 * сглаживания: Δ60 = Δ · (1 − e^(−λ/60)) / (1 − e^(−λ·dt)); лимит скорости (VMAX·dt) от длины кадра не зависит.
 * Режим --nogl (постер вместо WebGL) даёт честные 60 fps и проверяет сам конвейер.
 */
import { chromium, devices } from 'playwright';
import { mkdir, writeFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { base: 'http://127.0.0.1:4331', sizes: ['desktop', 'mobile'], tier: 'low', video: true, out: 'docs/screens/v3/C', nogl: false, suffix: '' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--base') opt.base = args[++i];
  else if (a === '--sizes') opt.sizes = args[++i].split(',');
  else if (a === '--tier') opt.tier = args[++i];
  else if (a === '--no-video') opt.video = false;
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--nogl') opt.nogl = true;
  else if (a === '--suffix') opt.suffix = args[++i];
}
await mkdir(opt.out, { recursive: true });

const MIN_TRANSITION = 1.4;
const MAX_DELTA60 = 0.008;
/** BRIEF-4 §1.5: отставание сглаженного положения от цели при флике через пять экранов */
const MAX_LAG = 1.6;

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });

/** Запись кадров внутри страницы: rAF-цикл читает состояние и складывает в window.__scrollLog */
const RECORDER = `
  window.__scrollLog = [];
  window.__scrollMark = (name) => window.__scrollLog.push({ mark: name, t: performance.now() });
  (function loop(now) {
    const s = window.__cm;
    if (s) window.__scrollLog.push({ t: now, y: window.scrollY, screen: s.screen, screens: Array.from(s.screens), dt: s.frame ? s.frame.dt : null });
    requestAnimationFrame(loop);
  })(performance.now());
`;

/** Переходы между экранами: от первого кадра screens[k] ≥ 0.7 до первого кадра screens[k+1] ≥ 0.3; последовательность: k+1 не входит, пока k < 0.98 */
function transitions(frames) {
  const out = [];
  const n = frames[0]?.screens.length ?? 0;
  for (let k = 0; k + 1 < n; k++) {
    let start = null;
    let firstNext = null;
    let sequential = true;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].screens;
      const b = frames[i].screens;
      if (start === null && a[k] < 0.7 && b[k] >= 0.7) start = frames[i].t;
      if (start !== null) {
        if (firstNext === null && b[k + 1] > 0.02) {
          firstNext = frames[i].t;
          if (b[k] < 0.98) sequential = false;
        }
        if (a[k + 1] < 0.3 && b[k + 1] >= 0.3) {
          out.push({ from: k, to: k + 1, seconds: Number(((frames[i].t - start) / 1000).toFixed(2)), sequential });
          start = null;
          firstNext = null;
          sequential = true;
        }
      }
    }
  }
  return out;
}

function analyze(log, lambda) {
  const frames = log.filter((f) => !f.mark);
  let maxDelta = 0;
  let maxDelta60 = 0;
  let flips = 0;
  let dir = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    // S8 (секция в потоке, local — видимость) в критерий Δ не входит
    for (let k = 0; k < Math.min(7, a.screens.length); k++) {
      const d = Math.abs(b.screens[k] - a.screens[k]);
      if (d > maxDelta) maxDelta = d;
      const dt = Math.max(typeof b.dt === 'number' ? b.dt : 0, (b.t - a.t) / 1000);
      const kk = dt > 0 ? (1 - Math.exp(-lambda / 60)) / (1 - Math.exp(-lambda * dt)) : 1;
      const d60 = d * Math.min(1, kk);
      if (d60 > maxDelta60) maxDelta60 = d60;
    }
    if (b.screen !== a.screen) {
      const nd = Math.sign(b.screen - a.screen);
      if (dir !== 0 && nd !== dir) flips++;
      dir = nd;
    }
  }
  const dts = frames.map((f) => f.dt).filter((d) => typeof d === 'number' && d > 0).sort((a, b) => a - b);
  const p95 = dts.length ? dts[Math.floor(dts.length * 0.95)] : null;
  return { frames: frames.length, maxDelta: Number(maxDelta.toFixed(4)), maxDelta60: Number(maxDelta60.toFixed(4)), screenFlips: flips, transitions: transitions(frames), frameP95Ms: p95 !== null ? Number((p95 * 1000).toFixed(1)) : null };
}

/** ждать, пока сглаженные значения догонят цели (переходы с лимитом скорости занимают секунды) */
async function waitSettled(page, maxMs = 20000) {
  const t0 = Date.now();
  await page.waitForTimeout(300); // событие scroll и цели приходят асинхронно
  let calm = 0;
  while (Date.now() - t0 < maxMs) {
    const gap = await page.evaluate(() => {
      const s = window.__cm;
      let g = 0;
      for (let i = 0; i < s.screens.length; i++) g = Math.max(g, Math.abs(s.screens[i] - s.targets[i]));
      return g;
    });
    calm = gap < 0.002 ? calm + 1 : 0;
    if (calm >= 2) return;
    await page.waitForTimeout(200);
  }
}

async function screenStarts(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const mobile = window.innerWidth < 900;
    const out = [];
    let acc = 0;
    for (const el of document.querySelectorAll('[data-stage] [data-screen]')) {
      const durVh = Number((mobile && el.dataset.durMobile) || el.dataset.dur || 220);
      out.push({ start: acc, dur: (durVh / 100) * vh });
      acc += (durVh / 100) * vh;
    }
    return out;
  });
}

const results = {};
for (const size of opt.sizes) {
  const mobile = size === 'mobile';
  const ctxOpts = mobile ? { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const videoDir = path.join(opt.out, `.video-${size}`);
  const ctx = await browser.newContext({ ...ctxOpts, recordVideo: opt.video ? { dir: videoDir, size: ctxOpts.viewport } : undefined });
  const page = await ctx.newPage();
  page.on('framenavigated', (f) => f === page.mainFrame() && console.warn(size, 'навигация:', f.url()));
  page.on('pageerror', (e) => console.warn(size, 'pageerror:', e.message));
  await page.goto(`${opt.base}/?tier=${opt.tier}${opt.nogl ? '&nogl' : ''}`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(4500); // интро + движок
  await page.evaluate(RECORDER);
  const scr = await screenStarts(page);
  const t0 = Date.now();
  const summary = { size, mode: opt.nogl ? 'nogl' : `webgl-${opt.tier}` };

  // ---------- (a)/(b): резкий флик / очередь колеса из удержания S1 (старт так, чтобы объём прокрутки из §6.7 довёл S2 до удержания)
  const settle = async (ms) => page.waitForTimeout(ms);
  const hold1 = Math.round(scr[0].start + scr[0].dur * (mobile ? 0.45 : 0.66));
  await page.evaluate((y) => window.scrollTo(0, y), hold1);
  await waitSettled(page);
  await settle(600);
  await page.evaluate(() => window.__scrollMark('flick-start'));
  const logBefore = await page.evaluate(() => window.__scrollLog.length);
  // расстояние флика считаем от длительности экрана: «через один экран» и «через два» (у версий разные data-dur)
  const oneScreen = Math.round(scr[1].dur);
  if (mobile) {
    // флик через один экран за ~250 мс: 10 шагов
    const step = Math.round(oneScreen / 10);
    for (let i = 0; i < 10; i++) {
      await page.evaluate((v) => window.scrollBy(0, v), step);
      await page.waitForTimeout(25);
    }
  } else {
    // 12 шагов колеса по 120 px страницы за 400 мс (Lenis wheelMultiplier 0.85 → сырой шаг 141)
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 141);
      await page.waitForTimeout(33);
    }
  }
  await settle(1500);
  await waitSettled(page);
  await settle(600);
  const logAfterFlick = await page.evaluate(() => window.__scrollLog.length);
  const flickFrames = (await page.evaluate(([a, b]) => window.__scrollLog.slice(a, b), [logBefore, logAfterFlick])).filter((f) => !f.mark);
  summary.flick = { px: mobile ? oneScreen : 12 * 141, transitions: transitions(flickFrames), flips: analyze(flickFrames, mobile ? 4.5 : 7).screenFlips };

  // ---------- (a2): флик через два экрана (3600 px) — два последовательных перехода
  if (mobile) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(scr[0].start + scr[0].dur * 0.45));
    await waitSettled(page);
    await settle(600);
    const b0 = await page.evaluate(() => window.__scrollLog.length);
    const step2 = Math.round((oneScreen * 1.8) / 12);
    for (let i = 0; i < 12; i++) {
      await page.evaluate((v) => window.scrollBy(0, v), step2);
      await page.waitForTimeout(22);
    }
    await settle(1500);
    await waitSettled(page);
    await settle(600);
    const b1 = await page.evaluate(() => window.__scrollLog.length);
    const fr = (await page.evaluate(([a, b]) => window.__scrollLog.slice(a, b), [b0, b1])).filter((f) => !f.mark);
    summary.flick2 = { px: Math.round(oneScreen * 1.8), transitions: transitions(fr), flips: analyze(fr, 4.5).screenFlips };
  }

  // ---------- BRIEF-4 §1.5: флик через пять экранов — отставание сглаженного положения от целевого ≤ 1.6 с
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(scr[0].start + scr[0].dur * 0.45));
  await waitSettled(page);
  await settle(600);
  const fiveTarget = Math.round(scr[5].start + scr[5].dur * 0.45);
  const lag = await page.evaluate(
    async ([target, n]) => {
      const s = window.__cm;
      const t0 = performance.now();
      window.scrollTo(0, target);
      // ждём, пока сглаженный прогресс догонит цель по всем экранам
      await new Promise((res) => {
        const tick = () => {
          let gap = 0;
          for (let i = 0; i < s.screens.length; i++) gap = Math.max(gap, Math.abs(s.screens[i] - s.targets[i]));
          if (gap < 0.01 || performance.now() - t0 > 20000) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { seconds: Number(((performance.now() - t0) / 1000).toFixed(2)), screens: n };
    },
    [fiveTarget, 5],
  );
  summary.flick5 = lag;

  // ---------- (c)/(d): равномерная прокрутка всей страницы сверху вниз
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitSettled(page);
  await settle(800);
  const c0 = await page.evaluate(() => window.__scrollLog.length);
  const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (mobile) {
    let y = 0;
    while (y < total) {
      const steps = [...Array(12).fill(30), 22, 16, 10, 6, 3];
      for (const s of steps) {
        y += s;
        await page.evaluate((v) => window.scrollBy(0, v), s);
        await page.waitForTimeout(s >= 30 ? 32 : 40);
      }
      await page.waitForTimeout(350);
    }
  } else {
    let y = 0;
    while (y < total) {
      await page.mouse.wheel(0, 100);
      y += 100;
      await page.waitForTimeout(120);
    }
  }
  await settle(2000);
  const all = await page.evaluate(() => window.__scrollLog || []);
  if (!all.length) console.warn(size, 'лог кадров пуст (страница перезагрузилась?)');
  const uniform = analyze(all.slice(c0), mobile ? 4.5 : 7);
  summary.uniform = uniform;
  summary.scrollMs = Date.now() - t0;
  results[size] = summary;
  const name = `scroll-${size}${opt.suffix ? `-${opt.suffix}` : ''}`;
  await writeFile(path.join(opt.out, `${name}.json`), JSON.stringify({ summary, frames: all }, null, 0));
  console.log(size, JSON.stringify(summary));
  await ctx.close();
  if (opt.video) {
    const files = await readdir(videoDir);
    for (const f of files) await rename(path.join(videoDir, f), path.join(opt.out, `${name}.webm`));
    await rm(videoDir, { recursive: true, force: true });
  }
}
await browser.close();

let ok = true;
for (const [size, s] of Object.entries(results)) {
  const trans = [...s.flick.transitions, ...(s.flick2 ? s.flick2.transitions : [])];
  const transOk = trans.length > 0 && trans.every((t) => t.seconds >= MIN_TRANSITION && t.sequential);
  const flipsOk = s.flick.flips === 0 && (!s.flick2 || s.flick2.flips === 0) && s.uniform.screenFlips === 0;
  const deltaOk = s.uniform.maxDelta60 <= MAX_DELTA60;
  const lagOk = !s.flick5 || s.flick5.seconds <= MAX_LAG;
  const pass = transOk && flipsOk && deltaOk && lagOk;
  if (!pass) ok = false;
  console.log(
    `${size}: ${pass ? 'PASS' : 'FAIL'} — переходы ${trans.map((t) => `${t.from + 1}→${t.to + 1} ${t.seconds}s${t.sequential ? '' : ' (не последовательно)'}`).join(', ') || 'нет'} (≥ ${MIN_TRANSITION} s); ` +
      `Δ60 ${s.uniform.maxDelta60} ≤ ${MAX_DELTA60} [raw ${s.uniform.maxDelta}]; flips ${s.flick.flips}/${s.flick2 ? s.flick2.flips : 0}/${s.uniform.screenFlips} = 0; ` +
      `флик через 5 экранов ${s.flick5 ? s.flick5.seconds : '—'} с ≤ ${MAX_LAG}; кадр p95 ${s.uniform.frameP95Ms} мс`,
  );
}
process.exit(ok ? 0 : 1);
