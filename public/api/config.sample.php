<?php
/**
 * CYBERMOVE — настройки формы заявок.
 * Скопируйте этот файл в config.php (рядом, в папке api/) и заполните. config.php не попадает в git,
 * а .htaccess запрещает его открывать из браузера.
 */
return [
    // Куда слать заявки (можно несколько через запятую)
    'LEADS_EMAIL'      => 'leads@cybermove.example',
    // От кого письмо. Лучше адрес на этом же домене, иначе хостинг может отклонить отправку
    'MAIL_FROM'        => '',
    'MAIL_SUBJECT'     => 'Заявка с сайта CYBERMOVE',

    // Telegram: создайте бота через @BotFather, добавьте его в чат/группу и узнайте chat_id (например, через @userinfobot)
    'TELEGRAM_ENABLED' => true,
    'TELEGRAM_TOKEN'   => '',
    'TELEGRAM_CHAT_ID' => '',

    // Вебхук CRM (если появится): POST JSON с полями name, contact, company, format, message, lang, page, utm
    'WEBHOOK_ENABLED'  => false,
    'WEBHOOK_URL'      => '',
    'WEBHOOK_SECRET'   => '',

    // Антиспам
    'MIN_FILL_SECONDS' => 3,     // минимальное время заполнения формы
    'RATE_LIMIT'       => 5,     // заявок с одного IP…
    'RATE_WINDOW'      => 600,   // …за столько секунд

    // Разрешённые источники (Origin). Пусто — любые. Пример: ['https://cybermove.kz', 'https://www.cybermove.kz']
    'ALLOWED_ORIGINS'  => [],

    // Где хранить журнал заявок и счётчики rate-limit (папка создаётся автоматически, закрыта .htaccess)
    'STORAGE_DIR'      => __DIR__ . '/.leads',
    'LOG_LEADS'        => true,
];
