/** SEO: title/description, canonical, hreflang, Open Graph, JSON-LD. */
import { SITE_URL, SITE_NAME, SITE_LEGAL_NAME, LANGS, DEFAULT_LANG, WHATSAPP_NUMBER, GEOGRAPHY, type LangCode } from '../../site.config';
import { alternates, localePath } from './i18n';
import { BASE } from './base';

export interface HeadMeta {
  lang: LangCode;
  /** путь без языкового префикса, с завершающим слэшем: '/', '/services/audit/' */
  path: string;
  title: string;
  description: string;
  /** абсолютный или корневой путь к OG-картинке */
  ogImage?: string;
  ogType?: 'website' | 'article';
  noindex?: boolean;
}

/** Абсолютный URL: домен из конфига Astro (`site`; в превью на Pages — github.io) + базовый путь */
export function absolute(path: string): string {
  const site = (import.meta.env.SITE || SITE_URL).replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  // localePath уже содержит BASE — не дублируем
  return p.startsWith(`${BASE}/`) || (BASE && p === BASE) ? `${site}${p}` : `${site}${BASE}${p}`;
}

export function canonical(lang: LangCode, path: string): string {
  return absolute(localePath(lang, path));
}

export function hreflangLinks(path: string): Array<{ hreflang: string; href: string }> {
  const links = alternates(path).map((a) => ({ hreflang: a.hreflang, href: absolute(a.href) }));
  links.push({ hreflang: 'x-default', href: absolute(localePath(DEFAULT_LANG, path)) });
  return links;
}

export function ogLocale(lang: LangCode): string {
  return LANGS.find((l) => l.code === lang)?.locale ?? 'ru_RU';
}

/* ---------- JSON-LD ---------- */

export function organizationLd(lang: LangCode) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: absolute('/'),
    logo: absolute('/icon-512.png'),
    slogan: lang === 'ru' ? 'Мы двигаем бизнес вперёд.' : 'We move business forward.',
    telephone: WHATSAPP_NUMBER,
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: WHATSAPP_NUMBER,
        contactType: 'sales',
        availableLanguage: ['ru', 'en'],
      },
    ],
    areaServed: GEOGRAPHY.map((city) => ({ '@type': 'City', name: city })),
  };
}

export function websiteLd(lang: LangCode) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: absolute(localePath(lang, '/')),
    name: SITE_NAME,
    inLanguage: lang,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function breadcrumbLd(lang: LangCode, items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: canonical(lang, it.path),
    })),
  };
}

export function serviceLd(
  lang: LangCode,
  opts: { name: string; description: string; path: string; services: Array<{ name: string; description: string; anchor: string }> },
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: opts.name,
    description: opts.description,
    url: canonical(lang, opts.path),
    provider: { '@id': `${SITE_URL}/#organization` },
    areaServed: GEOGRAPHY.map((city) => ({ '@type': 'City', name: city })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: opts.name,
      itemListElement: opts.services.map((s) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: s.name,
          description: s.description,
          url: `${canonical(lang, opts.path)}#${s.anchor}`,
        },
      })),
    },
  };
}
