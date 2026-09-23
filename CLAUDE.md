# CYBERMOVE — контекст для Claude Code

Сайт консалтинговой компании CYBERMOVE (Cyber Move Consulting). Полное ТЗ: `docs/BRIEF.md`. Тексты: `docs/CONTENT.md`.
Если сессия начата заново или контекст сжат: прочитай `docs/BRIEF.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md` и продолжай с первого незакрытого пункта `PROGRESS.md`. Закрытое не переделывай.

## Стек

- Astro 7 (static, `build.format: 'directory'`, `trailingSlash: 'always'`), TypeScript.
- Three.js 0.186 без обёрток, GLSL через `onBeforeCompile`; postprocessing (pmndrs); GSAP 3.15 (ScrollTrigger, SplitText); Lenis.
- Свой CSS на custom properties: `src/styles/tokens.css`, `base.css`, `typography.css`. Без Tailwind, без UI-китов, без иконочных паков.
- Шрифты self-hosted (Fontsource): Inter Tight (основной), Unbounded (широкий акцент), JetBrains Mono (микрометки).
- Форма: `public/api/lead.php` (PHP 8+, настройки в `public/api/config.php`, в git только `config.sample.php`).
- Хостинг: Plesk shared, Apache + PHP, без Node на сервере. Деплой: `docs/DEPLOY.md`.

## Команды

```
npm run dev          # dev-сервер (в этом окружении: preview_start "cybermove-dev", порт 4330)
npm run build        # боевая сборка в dist/ (страницы /dev/* исключены)
npm run build:labs   # сборка с лабораториями /dev/*
# превью GitHub Pages: CYBERMOVE_BASE=/<репо>/ CYBERMOVE_SITE=https://<логин>.github.io PUBLIC_PREVIEW=1 npm run build (см. docs/DEPLOY.md)
npm run preview      # предпросмотр dist/ (preview_start "cybermove-preview", порт 4331)
npm run check        # astro check
python scripts/build-logo.py [--active a|b|c]   # пересобрать логотип и favicon
node scripts/shots.mjs --out docs/screens/<фаза> --base http://127.0.0.1:4330 "/path:name" ...   # скриншоты Playwright (SwiftShader)
```

PHP локально: портативный `php.exe` (см. `docs/DECISIONS.md`), `php -l public/api/lead.php`.

## Структура

```
site.config.ts          параметры сайта (URL, языки, WhatsApp, аналитика, счётчики)
src/content/{ru,en}/    ui, home, services, cases, about, contact — JSON, источник правды по текстам
src/lib/                i18n, seo, analytics, site (общий клиентский код), home (сценарий главной)
src/webgl/              Engine, Environment, Story, scenes/, objects/, shaders/, backgrounds/
src/components/         секции и UI; labs/ — лаборатории /dev/*
src/pages/[...lang]/    маршруты: ru в корне, en в /en/
public/api/             lead.php, config.sample.php, .htaccess
docs/                   BRIEF, CONTENT, PROGRESS, DECISIONS, TODO-CONTENT, DEPLOY, REPORT, screens/
```

## Правила

- Все тексты из `docs/CONTENT.md`; чего нет — `[PLACEHOLDER]` и запись в `docs/TODO-CONTENT.md`. Цифры не выдумывать.
- Русские заголовки, английский только в микрометках.
- Один акцент: синий. Запрещены фиолетовые градиенты, glassmorphism, тени-облака, скругления 16px+, эмодзи, стоковые иконки.
- Все открытые решения — одной строкой в `docs/DECISIONS.md`. После каждой фазы — коммит и отметка в `docs/PROGRESS.md`.
- Параметры отладки главной: `?progress=0.37`, `?still`, `?tier=high|mid|low`, `?debug`.
- В Bash-хередоках на этой машине ломаются `\\` — файлы с бэкслэшами писать через Write.
