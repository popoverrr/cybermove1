#!/usr/bin/env node
/**
 * Подсказки (BRIEF-4 §4): карточка языка при первом визите, её отсутствие при повторном и в служебных
 * режимах, клавиатура (Tab/Enter/Esc), запуск музыки по выбору языка, подсказка «листайте вниз».
 *   node scripts/test-hints.mjs [--base http://127.0.0.1:4341] [--shots docs/screens/v4]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const base = get('--base', 'http://127.0.0.1:4341');
const shots = get('--shots', '');
if (shots) await mkdir(shots, { recursive: true });
let fails = 0;
const check = (ok, text) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`);
};

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] });

async function fresh(url = `${base}/?tier=low`) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(3500);
  return { ctx, page };
}

const boxState = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('[data-langbox]');
    const hint = document.querySelector('[data-scroll-hint]');
    return {
      boxVisible: Boolean(box) && !box.hasAttribute('hidden') && box.classList.contains('is-on'),
      focus: document.activeElement?.getAttribute('data-lang-choice') ?? document.activeElement?.tagName,
      hintVisible: Boolean(hint) && !hint.hasAttribute('hidden'),
      stored: localStorage.getItem('cm_lang'),
      audio: Boolean(window.__cmAudio?.playing),
    };
  });

// ---------- 1. первый визит: карточка есть, фокус на языке браузера (ru), подсказки прокрутки ещё нет
{
  const { ctx, page } = await fresh();
  const s = await boxState(page);
  check(s.boxVisible, `первый визит: карточка языка показана (фокус ${s.focus})`);
  check(s.focus === 'ru', `фокус на языке браузера: ${s.focus}`);
  if (shots) await page.screenshot({ path: path.join(shots, 'langbox--desktop.png') });
  // Tab ходит по двум строкам, Enter выбирает
  await page.keyboard.press('Tab');
  const focus2 = await page.evaluate(() => document.activeElement?.getAttribute('data-lang-choice'));
  check(focus2 === 'en', `Tab переводит на второй язык: ${focus2}`);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const after = await boxState(page);
  check(!after.boxVisible && after.stored === 'ru', `выбор ru: карточка закрыта, cm_lang=${after.stored}`);
  check(after.audio === true, `выбор языка запустил музыку: ${after.audio}`);
  await page.waitForTimeout(2200);
  const hint = await page.evaluate(() => {
    const el = document.querySelector('[data-scroll-hint]');
    return { visible: Boolean(el) && !el.hasAttribute('hidden') && el.classList.contains('is-on'), text: el?.textContent?.trim() };
  });
  check(hint.visible, `подсказка прокрутки появилась после карточки: «${hint.text}»`);
  if (shots) await page.screenshot({ path: path.join(shots, 'scroll-hint--desktop.png') });
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(1200);
  const gone = await page.evaluate(() => document.querySelector('[data-scroll-hint]')?.classList.contains('is-off'));
  check(gone === true, `подсказка исчезает после прокрутки: ${gone}`);
  // повторный визит в том же профиле
  await page.goto(`${base}/?tier=low`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const second = await boxState(page);
  check(!second.boxVisible, `повторный визит: карточки нет (cm_lang=${second.stored})`);
  check(!second.hintVisible, 'подсказка прокрутки во второй раз не показывается (сессия)');
  await ctx.close();
}

// ---------- 2. Esc оставляет текущий язык
{
  const { ctx, page } = await fresh();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const s = await boxState(page);
  check(!s.boxVisible && s.stored === 'ru', `Esc закрывает карточку и запоминает текущий язык (${s.stored})`);
  await ctx.close();
}

// ---------- 3. служебные режимы: карточки нет
{
  const { ctx, page } = await fresh(`${base}/?still&t=6&tier=low&screen=0&local=0.45`);
  const s = await boxState(page);
  check(!s.boxVisible && !s.hintVisible, 'в режиме скриншотов (?screen, ?still) карточки и подсказки нет');
  await ctx.close();
}

// ---------- 4. английский браузер: выбор EN ведёт на /en/
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${base}/?tier=low`, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(3500);
  const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-lang-choice'));
  check(focus === 'en', `английский браузер: фокус на English (${focus})`);
  // Enter на ссылке в headless не всегда активирует её — проверяем переход кликом
  await page.click('[data-lang-choice="en"]');
  await page.waitForTimeout(2500);
  const url = page.url();
  check(url.includes('/en/'), `выбор English ведёт на /en/: ${url}`);
  await ctx.close();
}

await browser.close();
process.exit(fails ? 1 : 0);
