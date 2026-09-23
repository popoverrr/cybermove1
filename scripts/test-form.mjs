// Прогон формы главной в Playwright: мок-успех и мок-ошибка, скриншоты состояний
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:4330';
const out = process.argv[3] || 'docs/screens/phase3';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
async function run(name, query) {
  const page = await ctx.newPage();
  await page.goto(`${base}/?still&t=8&screen=7&local=1${query}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2500);
  const form = page.locator('#lead-home');
  // пустая отправка → ошибки валидации
  await form.locator('[data-submit]').click();
  await page.waitForTimeout(300);
  const invalid = await form.locator('.field.is-invalid').count();
  await form.locator('[name="name"]').fill('Тест Тестов');
  await form.locator('[name="contact"]').fill('+7 701 825 10 28');
  await form.locator('[name="company"]').fill('cybermove.example');
  await form.locator('label.pill').nth(2).click();
  await form.locator('[name="message"]').fill('Проверка отправки формы с главной.');
  await form.locator('[data-submit]').click();
  await page.waitForTimeout(1600);
  const success = await form.locator('.lead__msg--success').isVisible();
  const error = await form.locator('.lead__msg--error').isVisible();
  await page.screenshot({ path: `${out}/form-${name}--desktop.png` });
  console.log(name, { invalidFieldsOnEmptySubmit: invalid, success, error });
  await page.close();
}
await run('success', '');
await run('error', '&mockfail');
await browser.close();
