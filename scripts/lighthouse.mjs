#!/usr/bin/env node
/**
 * Lighthouse через Playwright-Chromium (SwiftShader): node scripts/lighthouse.mjs [base] [path] [mobile]
 * Результат: docs/lighthouse-<имя>.json и краткий вывод. Под программным рендером Performance занижен.
 */
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import { writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:4341';
// путь без ведущего слэша (в Git Bash аргумент «/» превращается в путь к Git); "home" = /
const rawPath = process.argv[3] || 'home';
const path = rawPath === 'home' ? '/' : '/' + rawPath.replace(/^\/+/, '');
const mobile = process.argv[4] === 'mobile';
const port = 9333;
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
try {
  const result = await lighthouse(`${base}${path}`, {
    port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    formFactor: mobile ? 'mobile' : 'desktop',
    screenEmulation: mobile ? { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false } : { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
    throttlingMethod: 'simulate',
  });
  const lhr = result.lhr;
  const name = (path === '/' ? 'home' : path.replace(/\W+/g, '-').replace(/^-|-$/g, '')) + (mobile ? '-mobile' : '-desktop');
  writeFileSync(`docs/lighthouse-${name}.json`, JSON.stringify(lhr, null, 1));
  const scores = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]));
  const a = lhr.audits;
  const pick = (k) => a[k]?.displayValue ?? '—';
  console.log(name, scores);
  console.log('FCP', pick('first-contentful-paint'), '| LCP', pick('largest-contentful-paint'), '| CLS', pick('cumulative-layout-shift'), '| TBT', pick('total-blocking-time'), '| SI', pick('speed-index'));
  const lcpNode = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet;
  console.log('LCP element:', (lcpNode || '').slice(0, 140));
  const fails = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === 'binary').map((x) => x.id);
  console.log('failing binary audits:', fails.join(', ') || 'none');
} finally {
  await browser.close();
}
