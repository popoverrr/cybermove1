/**
 * Базовый путь сайта. На хостинге сайт живёт в корне (BASE = ''), в превью на GitHub Pages — в подпапке
 * вида /cybermove/ (задаётся переменной CYBERMOVE_BASE при сборке, см. .github/workflows/pages.yml).
 */
export const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

/** withBase('/posters/x.webp') → '/posters/x.webp' на хостинге, '/cybermove/posters/x.webp' в превью */
export function withBase(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${clean}`;
}

/** Режим превью (GitHub Pages): noindex и форма без отправки */
export const PREVIEW = import.meta.env.PUBLIC_PREVIEW === '1';
