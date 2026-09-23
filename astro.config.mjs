// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL, LANGS, DEFAULT_LANG } from './site.config.ts';

const LABS = process.env.CYBERMOVE_LABS === '1';

// Превью на GitHub Pages: CYBERMOVE_SITE=https://<логин>.github.io CYBERMOVE_BASE=/<репозиторий>/ (см. .github/workflows/pages.yml)
const SITE = process.env.CYBERMOVE_SITE || SITE_URL;
const BASE = process.env.CYBERMOVE_BASE || '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  devToolbar: { enabled: false },
  trailingSlash: 'always',
  build: {
    format: 'directory',
    assets: '_astro',
    inlineStylesheets: 'auto',
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: DEFAULT_LANG,
        locales: Object.fromEntries(LANGS.map((l) => [l.code, l.hreflang])),
      },
      filter: (page) => !page.includes('/404') && !page.includes('/dev/'),
    }),
  ],
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  vite: {
    define: {
      __CYBERMOVE_LABS__: JSON.stringify(LABS),
    },
    build: {
      // Скрипты всегда внешние, шрифты не превращаются в data: URI.
      assetsInlineLimit: 0,
      cssCodeSplit: true,
      // Vite 8 = Rolldown: группы чанков через advancedChunks (manualChunks-совместимость сливала
      // state.ts с чанком Tweakpane, и three-чанк тянул панель отладки на каждую страницу).
      rolldownOptions: {
        output: {
          advancedChunks: {
            groups: [
              // Хелпер динамических импортов Vite — отдельно, иначе утянет тяжёлый чанк в статический граф
              { name: 'preload', test: /vite[\/]dist[\/]client[\/]modulepreload|preload-helper/, priority: 200 },
              // Общее состояние DOM↔WebGL и аналитика — отдельный маленький чанк
              { name: 'state', test: /[\/]src[\/]lib[\/](state|analytics)\.ts/, priority: 150 },
              // Панель отладки (Tweakpane) — ленивый чанк, только при ?debug
              { name: 'debug', test: /node_modules[\\/](tweakpane|@tweakpane)[\\/]|[\\/]src[\\/]webgl[\\/]debug/, priority: 100 },
              // Лёгкий фон внутренних страниц и GLSL-строки — без three
              { name: 'litebg', test: /[\\/]src[\\/]webgl[\\/](backgrounds[\\/](lite-bg|bgShader)|shaders[\\/]noise)/, priority: 90 },
              // Весь 3D — отдельный чанк, грузится динамически после первой отрисовки
              { name: 'three', test: /node_modules[\\/](three|postprocessing)[\\/]|[\\/]src[\\/]webgl[\\/]/, priority: 80 },
              { name: 'motion', test: /node_modules[\\/](gsap|lenis)[\\/]/, priority: 70 },
            ],
          },
        },
      },
    },
  },
});
