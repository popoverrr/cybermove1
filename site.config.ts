/**
 * Параметры сайта CYBERMOVE. Всё, что заказчик может поменять без правки кода, — здесь.
 * Параметры формы (почта, Telegram, вебхук) — в public/api/config.php (см. config.sample.php).
 */

export const SITE_URL = 'https://cybermove.example'; // боевой домен появится позже
export const SITE_NAME = 'CYBERMOVE';
export const SITE_LEGAL_NAME = 'Cyber Move Consulting';

export type LangCode = 'ru' | 'en';

export interface LangDef {
  code: LangCode;
  /** префикс маршрута: '' для языка по умолчанию, 'en' для /en/ */
  prefix: string;
  hreflang: string;
  /** подпись в переключателе */
  label: string;
  /** locale для Intl / og:locale */
  locale: string;
}

export const LANGS: readonly LangDef[] = [
  { code: 'ru', prefix: '', hreflang: 'ru', label: 'RU', locale: 'ru_RU' },
  { code: 'en', prefix: 'en', hreflang: 'en', label: 'EN', locale: 'en_US' },
] as const;

export const DEFAULT_LANG: LangCode = 'ru';

export const WHATSAPP_NUMBER = '+7 701 825 10 28';
export const WHATSAPP_URL = 'https://wa.me/77018251028';

/** Если файла нет — кнопка звука скрыта. Положите трек в public/audio/ambient.mp3 и поставьте true. */
export const AUDIO_TRACK: string | null = null; // 'audio/ambient.mp3'

/** Аналитика: пустая строка = выключено. */
export const ANALYTICS = {
  ga4: '', // 'G-XXXXXXXXXX'
  metaPixel: '', // '123456789012345'
  tiktokPixel: '', // 'XXXXXXXXXXXXXXXXXX'
};

/** Куда уходит форма. Относительный путь от корня сайта. */
export const LEAD_ENDPOINT = '/api/lead.php';

/** Счётчики экрана «Рост» (реальные, с текущего сайта). */
export const COUNTERS = {
  projects: 34,
  cities: 13,
  industries: 7,
  yearsWithUsyk: 6,
};

export const GEOGRAPHY = [
  'Bielefeld', 'Paris', 'Barcelona', 'Prague', 'Milan', 'Kyiv', 'Odesa',
  'Almaty', 'Astana', 'Shymkent', 'Shanghai', 'Tokyo', 'Bali',
];

export const TICKER = [
  'USYK', 'Ukrainian Fashion Week', 'INTERTOP', 'BRSM-NAFTA', 'HYDROSTA', 'ТПК',
  'Українське радіо', 'MAHARADJ', 'Good Market', 'Morris Group',
];
