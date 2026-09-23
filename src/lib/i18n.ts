/**
 * i18n: контент по языкам, маршруты, hreflang.
 * Новый язык: добавить в LANGS (site.config.ts) и папку src/content/<code>/ с теми же файлами.
 */
import { LANGS, DEFAULT_LANG, type LangCode, type LangDef } from '../../site.config';
import { BASE } from './base';

import ruUi from '../content/ru/ui.json';
import ruHome from '../content/ru/home.json';
import ruServices from '../content/ru/services.json';
import ruCases from '../content/ru/cases.json';
import ruAbout from '../content/ru/about.json';
import ruContact from '../content/ru/contact.json';

export type Ui = typeof ruUi;
export type Home = typeof ruHome;
export type ServicesContent = typeof ruServices;
export type Direction = ServicesContent['directions'][number];
export type Service = Direction['services'][number];
export type CasesContent = typeof ruCases;
export type CaseItem = CasesContent['items'][number];
export type About = typeof ruAbout;
export type Contact = typeof ruContact;

export interface Content {
  lang: LangCode;
  def: LangDef;
  ui: Ui;
  home: Home;
  services: ServicesContent;
  cases: CasesContent;
  about: About;
  contact: Contact;
}

// Все JSON всех языков собираются на этапе сборки (eager), чтобы отсутствие файла ловилось сразу.
const modules = import.meta.glob<{ default: unknown }>('../content/*/*.json', { eager: true });

function load<T>(lang: LangCode, file: string, fallback: T): T {
  const key = `../content/${lang}/${file}.json`;
  const mod = modules[key];
  if (!mod) {
    if (lang !== DEFAULT_LANG) return fallback;
    throw new Error(`Нет файла контента ${key}`);
  }
  return mod.default as T;
}

const cache = new Map<LangCode, Content>();

export function getContent(lang: LangCode = DEFAULT_LANG): Content {
  const hit = cache.get(lang);
  if (hit) return hit;
  const def = LANGS.find((l) => l.code === lang);
  if (!def) throw new Error(`Неизвестный язык ${lang}`);
  const c: Content = {
    lang,
    def,
    ui: load(lang, 'ui', ruUi),
    home: load(lang, 'home', ruHome),
    services: load(lang, 'services', ruServices),
    cases: load(lang, 'cases', ruCases),
    about: load(lang, 'about', ruAbout),
    contact: load(lang, 'contact', ruContact),
  };
  cache.set(lang, c);
  return c;
}

/** Путь с языковым префиксом: localePath('en', '/services/') → '/en/services/' */
export function localePath(lang: LangCode, path: string): string {
  const def = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (!def.prefix) return `${BASE}${clean}`;
  return `${BASE}/${def.prefix}${clean === '/' ? '/' : clean}`;
}

/** Параметры getStaticPaths для страниц вида [...lang]/… */
export function langStaticPaths() {
  return LANGS.map((l) => ({
    params: { lang: l.prefix ? l.prefix : undefined },
    props: { lang: l.code },
  }));
}

/** Язык из параметра маршрута [...lang] */
export function langFromParam(param: string | undefined): LangCode {
  if (!param) return DEFAULT_LANG;
  const def = LANGS.find((l) => l.prefix === param);
  return def ? def.code : DEFAULT_LANG;
}

/** Альтернативные версии страницы для hreflang и переключателя */
export function alternates(path: string): Array<{ lang: LangCode; hreflang: string; href: string; label: string }> {
  return LANGS.map((l) => ({
    lang: l.code,
    hreflang: l.hreflang,
    href: localePath(l.code, path),
    label: l.label,
  }));
}

export function findCase(content: Content, id: string): CaseItem | undefined {
  return content.cases.items.find((c) => c.id === id);
}

export function findDirection(content: Content, id: string): Direction | undefined {
  return content.services.directions.find((d) => d.id === id || d.slug === id);
}

/** Услуга по id вместе с направлением */
export function findService(content: Content, id: string): { direction: Direction; service: Service } | undefined {
  for (const d of content.services.directions) {
    const s = d.services.find((x) => x.id === id);
    if (s) return { direction: d, service: s };
  }
  return undefined;
}

export const allLangs = LANGS;
export { DEFAULT_LANG };
export type { LangCode };
