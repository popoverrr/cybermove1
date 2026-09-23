// Локальный тест lead.php через php -S (node scripts/test-lead.mjs [путь к php.exe])
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, unlinkSync, readFileSync, rmSync } from 'node:fs';

const php = process.argv[2] || 'php';
const port = 8099;
const cfg = 'public/api/config.php';
const hadCfg = existsSync(cfg);
if (!hadCfg) {
  writeFileSync(cfg, `<?php return ['LEADS_EMAIL' => '', 'TELEGRAM_ENABLED' => false, 'MIN_FILL_SECONDS' => 3, 'RATE_LIMIT' => 3, 'RATE_WINDOW' => 60, 'STORAGE_DIR' => __DIR__ . '/.leads-test'];\n`);
}
const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'public'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

async function post(body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/lead.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const base = { name: 'Тест Тестов', contact: '+7 701 825 10 28', company: 'ООО Тест', format: 'audit', message: 'Проверка формы', lang: 'ru', page: '/', utm: '', elapsed: 12 };
const results = [];
results.push(['GET → 405', (await fetch(`http://127.0.0.1:${port}/api/lead.php`)).status]);
results.push(['валидная заявка', await post(base)]);
results.push(['honeypot → 200 ok (тихо)', await post({ ...base, website: 'spam' })]);
results.push(['слишком быстро → 429', await post({ ...base, elapsed: 1 })]);
results.push(['без имени → 422', await post({ ...base, name: 'A' })]);
results.push(['плохой контакт → 422', await post({ ...base, contact: 'abc' })]);
results.push(['2-я валидная', await post(base)]);
results.push(['3-я валидная (лимит 3)', await post(base)]);
results.push(['4-я → 429 rate_limit', await post(base)]);
results.push(['config.php закрыт → 403/404', (await fetch(`http://127.0.0.1:${port}/api/config.sample.php`)).status]);
for (const [label, r] of results) console.log(label.padEnd(34), JSON.stringify(r));
const log = 'public/api/.leads-test/leads.log';
console.log('журнал:', existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length + ' записей' : 'нет');
server.kill();
if (!hadCfg) unlinkSync(cfg);
rmSync('public/api/.leads-test', { recursive: true, force: true });
