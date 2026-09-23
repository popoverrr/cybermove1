#!/usr/bin/env node
/**
 * Звук (BRIEF-4 §2): три прогона в Chromium —
 *   1) профиль с разрешённым автозапуском: музыка стартует без клика, до старта нет запросов к /audio/;
 *   2) чистый профиль (автозапуск заблокирован): стартует с первого клика, скролл не считается жестом;
 *   3) выключение запоминается (`cm_audio=0`) и позиция переносится между страницами (`cm_audio_pos`).
 *   node scripts/test-audio.mjs [--base http://127.0.0.1:4341]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://127.0.0.1:4341';
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (ok, text) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`);
};

async function open(browser, { block = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const audioReqs = [];
  page.on('request', (r) => {
    if (r.url().includes('/audio/')) audioReqs.push(r.url().split('/').pop());
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}/?tier=low`, { waitUntil: 'networkidle', timeout: 180000 });
  return { ctx, page, audioReqs, errors, block };
}

const state = (page) =>
  page.evaluate(() => {
    const btn = document.querySelector('[data-audio-toggle]');
    return {
      pressed: btn?.getAttribute('aria-pressed'),
      hidden: btn?.hasAttribute('hidden') ?? true,
      stored: localStorage.getItem('cm_audio'),
      pos: sessionStorage.getItem('cm_audio_pos'),
      playing: Boolean(window.__cmAudio?.playing),
      last: window.__cmAudio?.last,
      time: Math.round(window.__cmAudio?.time ?? 0),
    };
  });

// ---------- 1. автозапуск разрешён политикой профиля
{
  const browser = await chromium.launch({ headless: true, args: [...GL, '--autoplay-policy=no-user-gesture-required'] });
  const { page, audioReqs } = await open(browser);
  await page.waitForTimeout(4000);
  const s = await state(page);
  check(s.playing === true && s.pressed === 'true', `автозапуск без клика: играет ${s.playing}, кнопка ${s.pressed}`);
  check(audioReqs.length > 0, `трек запрошен: ${audioReqs.join(', ') || 'нет'}`);
  await browser.close();
}

// ---------- 2. чистый профиль: блокировка автозапуска, старт по жесту; до старта нет запросов к /audio/
{
  const browser = await chromium.launch({ headless: true, args: [...GL, '--autoplay-policy=document-user-activation-required'] });
  const { page, audioReqs, errors } = await open(browser);
  await page.waitForTimeout(2500);
  const before = await state(page);
  const reqsBefore = audioReqs.length;
  check(before.playing === false, `без жеста музыки нет: playing ${before.playing}`);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1200);
  const afterScroll = await state(page);
  check(afterScroll.playing === false, `скролл активацией не считается: playing ${afterScroll.playing}`);
  await page.mouse.click(640, 700);
  await page.waitForTimeout(2500);
  const after = await state(page);
  check(after.playing === true && after.pressed === 'true', `после клика играет: ${after.playing}, кнопка ${after.pressed} (${after.last})`);
  check(errors.length === 0, `без ошибок в консоли (${errors.slice(0, 2).join(' | ') || '—'})`);
  console.log(`   запросов к /audio/ до жеста: ${reqsBefore}, после: ${audioReqs.length} (${audioReqs.join(', ')})`);
  await browser.close();
}

// ---------- 3. выключение запоминается, позиция переносится между страницами
{
  const browser = await chromium.launch({ headless: true, args: [...GL, '--autoplay-policy=no-user-gesture-required'] });
  const { ctx, page } = await open(browser);
  await page.waitForTimeout(5000);
  const pos1 = (await state(page)).pos;
  // переход по ссылке в той же вкладке — так ходит пользователь (в отдельной вкладке браузер глушит второй контекст)
  const page2 = page;
  await page2.goto(`${base}/about/`, { waitUntil: 'networkidle', timeout: 120000 });
  await page2.waitForTimeout(3000);
  const s2 = await page2.evaluate(() => ({
    playing: Boolean(window.__cmAudio?.playing),
    time: Math.round(window.__cmAudio?.time ?? 0),
    hasBtn: Boolean(document.querySelector('[data-audio-toggle]')),
  }));
  check(s2.hasBtn && s2.playing, `на внутренней странице кнопка есть и музыка идёт (t=${s2.time}s, позиция с главной ${pos1 ? Math.round(Number(pos1)) : '—'}s)`);
  await page2.click('[data-audio-toggle]');
  await page2.waitForTimeout(1500);
  const off = await page2.evaluate(() => ({ stored: localStorage.getItem('cm_audio'), playing: Boolean(window.__cmAudio?.playing) }));
  check(off.stored === '0', `выключение записано: cm_audio=${off.stored}`);
  const page3 = page2;
  await page3.goto(`${base}/?tier=low`, { waitUntil: 'networkidle', timeout: 120000 });
  await page3.waitForTimeout(3000);
  const s3 = await page3.evaluate(() => Boolean(window.__cmAudio?.playing));
  check(s3 === false, `после выключения автозапуска нет: playing ${s3}`);
  await browser.close();
}

process.exit(fails ? 1 : 0);
