#!/usr/bin/env node
/**
 * Скриншоты через Playwright + Chromium с программным WebGL (SwiftShader).
 *
 *   node scripts/shots.mjs --out docs/screens/phase1 --base http://127.0.0.1:4321 \
 *        "/?progress=0.1&still&tier=high:s1-intro" "/dev/logo/:logo" --sizes desktop,mobile --full
 *
 * Каждый аргумент-путь: "<url-path>[:<имя файла>]". Размеры: desktop 1440×900, mobile 390×844.
 * --full — скриншот всей страницы. --wait N — дополнительная пауза (мс) после загрузки (по умолчанию 1200).
 * --dark/--light — эмуляция prefers-color-scheme; --reduced — prefers-reduced-motion: reduce; --nowebgl — отключить WebGL.
 */
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { out: 'docs/screens/tmp', base: 'http://127.0.0.1:4321', sizes: ['desktop', 'mobile'], full: false, wait: 1200, reduced: false, nowebgl: false, scale: 1, browser: 'chromium' };
const targets = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--base') opt.base = args[++i];
  else if (a === '--sizes') opt.sizes = args[++i].split(',');
  else if (a === '--full') opt.full = true;
  else if (a === '--wait') opt.wait = Number(args[++i]);
  else if (a === '--reduced') opt.reduced = true;
  else if (a === '--nowebgl') opt.nowebgl = true;
  else if (a === '--scale') opt.scale = Number(args[++i]);
  else if (a === '--browser') opt.browser = args[++i];
  else targets.push(a);
}

const SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 1024, height: 1366 },
};

const gpuArgs = opt.nowebgl
  ? ['--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

async function main() {
  await mkdir(opt.out, { recursive: true });
  const engine = opt.browser === 'firefox' ? (await import('playwright')).firefox : opt.browser === 'webkit' ? (await import('playwright')).webkit : chromium;
  const browser = await engine.launch({ headless: true, args: engine === chromium ? gpuArgs : [] });
  try {
    for (const size of opt.sizes) {
      const vp = SIZES[size];
      if (!vp) throw new Error(`Неизвестный размер ${size}`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor ?? opt.scale,
        isMobile: vp.isMobile ?? false,
        hasTouch: vp.hasTouch ?? false,
        reducedMotion: opt.reduced ? 'reduce' : 'no-preference',
        colorScheme: 'dark',
        locale: 'ru-RU',
      });
      for (const t of targets) {
        const idx = t.lastIndexOf(':');
        const hasName = idx > 0 && !t.slice(idx + 1).includes('/') && !t.slice(idx + 1).includes('=');
        const url = hasName ? t.slice(0, idx) : t;
        const name = hasName ? t.slice(idx + 1) : url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        const full = opt.base.replace(/\/$/, '') + url;
        const t0 = Date.now();
        await page.goto(full, { waitUntil: 'networkidle', timeout: 120000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(opt.wait);
        const file = path.join(opt.out, `${name}--${size}.png`);
        await page.screenshot({ path: file, fullPage: opt.full, animations: 'disabled', caret: 'hide' });
        console.log(`${file}  (${Date.now() - t0} ms)${errors.length ? `  ERRORS: ${errors.join(' | ').slice(0, 400)}` : ''}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
