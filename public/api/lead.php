<?php
/**
 * CYBERMOVE — приём заявок с формы (BRIEF §12).
 *
 * Принимает POST JSON: name, contact, company, format, message, lang, page, utm, ts, elapsed, website (honeypot).
 * Валидация, honeypot, минимальное время заполнения, rate-limit по IP на файлах.
 * Доставка: письмо (LEADS_EMAIL), Telegram (Bot API через curl), опциональный вебхук CRM.
 * Каналы независимы: сбой одного не ломает остальные. Настройки — в config.php (см. config.sample.php).
 *
 * Ответ: JSON {"ok": true} или {"ok": false, "error": "..."}.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'method']);
}

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    respond(500, ['ok' => false, 'error' => 'config_missing']);
}
/** @var array<string,mixed> $config */
$config = require $configPath;

$defaults = [
    'LEADS_EMAIL'      => '',
    'MAIL_FROM'        => '',
    'MAIL_SUBJECT'     => 'Заявка с сайта CYBERMOVE',
    'TELEGRAM_ENABLED' => false,
    'TELEGRAM_TOKEN'   => '',
    'TELEGRAM_CHAT_ID' => '',
    'WEBHOOK_ENABLED'  => false,
    'WEBHOOK_URL'      => '',
    'WEBHOOK_SECRET'   => '',
    'MIN_FILL_SECONDS' => 3,
    'RATE_LIMIT'       => 5,
    'RATE_WINDOW'      => 600,
    'ALLOWED_ORIGINS'  => [],
    'STORAGE_DIR'      => __DIR__ . '/.leads',
    'LOG_LEADS'        => true,
];
$config = array_merge($defaults, $config);

// --- Origin (защита от чужих сайтов), если задан список
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (!empty($config['ALLOWED_ORIGINS']) && $origin !== '' && !in_array($origin, $config['ALLOWED_ORIGINS'], true)) {
    respond(403, ['ok' => false, 'error' => 'origin']);
}

// --- Тело запроса: JSON или обычная форма
$raw = file_get_contents('php://input') ?: '';
$data = [];
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if (stripos($contentType, 'application/json') !== false) {
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        respond(400, ['ok' => false, 'error' => 'json']);
    }
    $data = $decoded;
} else {
    $data = $_POST;
}

$field = static function (string $key, int $max) use ($data): string {
    $v = $data[$key] ?? '';
    if (!is_string($v)) {
        $v = is_scalar($v) ? (string) $v : '';
    }
    $v = trim($v);
    // без управляющих символов, кроме переводов строк
    $v = preg_replace('/[^\P{C}\n\r\t]+/u', '', $v) ?? '';
    return mb_substr($v, 0, $max);
};

$name     = $field('name', 120);
$contact  = $field('contact', 160);
$company  = $field('company', 200);
$format   = $field('format', 40);
$message  = $field('message', 4000);
$lang     = $field('lang', 8);
$page     = $field('page', 300);
$utm      = $field('utm', 600);
$honeypot = $field('website', 200);
$elapsed  = (int) ($data['elapsed'] ?? 0);
$ts       = (int) ($data['ts'] ?? 0);

// --- honeypot: боты заполняют скрытое поле
if ($honeypot !== '') {
    // отвечаем «успехом», чтобы не подсказывать
    respond(200, ['ok' => true]);
}

// --- минимальное время заполнения
$minSeconds = (int) $config['MIN_FILL_SECONDS'];
$sinceTs = $ts > 0 ? (int) round((microtime(true) * 1000 - $ts) / 1000) : $elapsed;
if ($minSeconds > 0 && max($elapsed, $sinceTs) < $minSeconds) {
    respond(429, ['ok' => false, 'error' => 'too_fast']);
}

// --- валидация
if (mb_strlen($name) < 2) {
    respond(422, ['ok' => false, 'error' => 'name']);
}
$contactOk = preg_match('/[+\d][\d\s().-]{6,}/', $contact)
    || preg_match('/^@?[a-z0-9_]{4,}$/i', $contact)
    || filter_var($contact, FILTER_VALIDATE_EMAIL);
if (!$contactOk) {
    respond(422, ['ok' => false, 'error' => 'contact']);
}
$formats = [
    'audit'  => ['ru' => 'Аудит и roadmap', 'en' => 'Audit & roadmap'],
    'launch' => ['ru' => 'Запуск проекта', 'en' => 'Project launch'],
    'growth' => ['ru' => 'Партнёрство по росту', 'en' => 'Growth partnership'],
    'other'  => ['ru' => 'Другое', 'en' => 'Other'],
];
if (!isset($formats[$format])) {
    $format = 'other';
}
$formatLabel = $formats[$format]['ru'] . ($lang === 'en' ? ' / ' . $formats[$format]['en'] : '');

// --- rate-limit по IP на файлах
$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'));
$ip = trim(explode(',', (string) $ip)[0]);
$storage = rtrim((string) $config['STORAGE_DIR'], '/');
if (!is_dir($storage)) {
    @mkdir($storage, 0700, true);
}
$rateFile = $storage . '/rate_' . hash('sha256', $ip) . '.json';
$now = time();
$window = (int) $config['RATE_WINDOW'];
$limit = (int) $config['RATE_LIMIT'];
$hits = [];
if (is_file($rateFile)) {
    $hits = json_decode((string) file_get_contents($rateFile), true) ?: [];
}
$hits = array_values(array_filter($hits, static fn($t) => is_int($t) && $t > $now - $window));
if ($limit > 0 && count($hits) >= $limit) {
    respond(429, ['ok' => false, 'error' => 'rate_limit']);
}
$hits[] = $now;
@file_put_contents($rateFile, json_encode($hits), LOCK_EX);

// --- текст заявки
$lines = [
    'Имя: ' . $name,
    'Контакт: ' . $contact,
    'Компания / сайт: ' . ($company !== '' ? $company : '—'),
    'Формат: ' . $formatLabel,
    'Сообщение: ' . ($message !== '' ? $message : '—'),
    '',
    'Язык: ' . ($lang !== '' ? $lang : 'ru'),
    'Страница: ' . ($page !== '' ? $page : '/'),
    'UTM: ' . ($utm !== '' ? $utm : '—'),
    'IP: ' . $ip,
    'Время: ' . date('Y-m-d H:i:s'),
];
$text = implode("\n", $lines);

$results = ['mail' => null, 'telegram' => null, 'webhook' => null];

// --- письмо
if ($config['LEADS_EMAIL'] !== '') {
    $to = (string) $config['LEADS_EMAIL'];
    $host = $_SERVER['SERVER_NAME'] ?? 'localhost';
    $from = $config['MAIL_FROM'] !== '' ? (string) $config['MAIL_FROM'] : 'no-reply@' . preg_replace('/^www\./', '', $host);
    $subject = (string) $config['MAIL_SUBJECT'] . ' — ' . $name;
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = [
        'From: CYBERMOVE <' . $from . '>',
        'Reply-To: ' . $from,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: cybermove-lead',
    ];
    try {
        $results['mail'] = @mail($to, $encodedSubject, $text, implode("\r\n", $headers), '-f' . $from);
    } catch (Throwable $e) {
        $results['mail'] = false;
    }
}

// --- Telegram
if ($config['TELEGRAM_ENABLED'] && $config['TELEGRAM_TOKEN'] !== '' && $config['TELEGRAM_CHAT_ID'] !== '' && function_exists('curl_init')) {
    $tg = "🔹 Заявка CYBERMOVE\n\n" . $text;
    $ch = curl_init('https://api.telegram.org/bot' . $config['TELEGRAM_TOKEN'] . '/sendMessage');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_POSTFIELDS     => http_build_query([
            'chat_id'                  => $config['TELEGRAM_CHAT_ID'],
            'text'                     => $tg,
            'disable_web_page_preview' => 'true',
        ]),
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $results['telegram'] = $resp !== false && $code === 200;
}

// --- вебхук CRM
if ($config['WEBHOOK_ENABLED'] && $config['WEBHOOK_URL'] !== '' && function_exists('curl_init')) {
    $payload = json_encode([
        'name' => $name, 'contact' => $contact, 'company' => $company, 'format' => $format,
        'message' => $message, 'lang' => $lang, 'page' => $page, 'utm' => $utm, 'ip' => $ip,
        'created_at' => date('c'), 'source' => 'cybermove-site',
    ], JSON_UNESCAPED_UNICODE);
    $headers = ['Content-Type: application/json'];
    if ($config['WEBHOOK_SECRET'] !== '') {
        $headers[] = 'X-Signature: ' . hash_hmac('sha256', (string) $payload, (string) $config['WEBHOOK_SECRET']);
    }
    $ch = curl_init((string) $config['WEBHOOK_URL']);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $payload,
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $results['webhook'] = $resp !== false && $code >= 200 && $code < 300;
}

// --- локальный журнал (страховка, если каналы недоступны)
if ($config['LOG_LEADS']) {
    $logLine = date('c') . "\t" . json_encode([
        'name' => $name, 'contact' => $contact, 'company' => $company, 'format' => $format,
        'message' => $message, 'lang' => $lang, 'page' => $page, 'utm' => $utm, 'ip' => $ip, 'delivery' => $results,
    ], JSON_UNESCAPED_UNICODE) . "\n";
    @file_put_contents($storage . '/leads.log', $logLine, FILE_APPEND | LOCK_EX);
}

$anyChannel = array_filter($results, static fn($r) => $r !== null);
$delivered = in_array(true, $anyChannel, true);
// Если ни один канал не настроен — считаем успехом (заявка в журнале); если настроены и все упали — ошибка
if (count($anyChannel) > 0 && !$delivered) {
    respond(502, ['ok' => false, 'error' => 'delivery']);
}

respond(200, ['ok' => true]);
