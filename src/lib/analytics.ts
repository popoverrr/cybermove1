/**
 * Аналитика: слоты GA4 / Meta Pixel / TikTok Pixel. Включаются ID в site.config.ts.
 * События: lead_submit, whatsapp_click, service_open (открытие Drawer услуги).
 */
import { ANALYTICS } from '../../site.config';

type Params = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    ttq?: { track: (event: string, params?: Params) => void; page?: () => void };
  }
}

let loaded = false;

function loadScript(src: string, onload?: () => void) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  if (onload) s.onload = onload;
  document.head.appendChild(s);
}

/** Подключает счётчики, у которых задан ID. Вызывается после первой отрисовки, чтобы не мешать LCP. */
export function initAnalytics() {
  if (loaded) return;
  loaded = true;

  if (ANALYTICS.ga4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS.ga4, { anonymize_ip: true });
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS.ga4)}`);
  }

  if (ANALYTICS.metaPixel) {
    const w = window as unknown as { fbq?: any; _fbq?: any };
    if (!w.fbq) {
      const n: any = (w.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      });
      w._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      loadScript('https://connect.facebook.net/en_US/fbevents.js');
    }
    window.fbq!('init', ANALYTICS.metaPixel);
    window.fbq!('track', 'PageView');
  }

  if (ANALYTICS.tiktokPixel) {
    const w = window as unknown as { ttq?: any; TiktokAnalyticsObject?: string };
    w.TiktokAnalyticsObject = 'ttq';
    const ttq: any = (w.ttq = w.ttq || []);
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
    ttq.setAndDefer = function (t: any, e: string) {
      t[e] = function () {
        t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (const m of ttq.methods) ttq.setAndDefer(ttq, m);
    ttq.load = function (id: string) {
      ttq._i = ttq._i || {};
      ttq._i[id] = [];
      ttq._t = ttq._t || {};
      ttq._t[id] = +new Date();
      ttq._o = ttq._o || {};
      loadScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${id}&lib=ttq`);
    };
    ttq.load(ANALYTICS.tiktokPixel);
    ttq.page();
  }
}

/** Единая точка событий. Безопасна, если счётчики выключены. */
export function track(event: 'lead_submit' | 'whatsapp_click' | 'service_open', params: Params = {}) {
  try {
    window.gtag?.('event', event, params);
    if (window.fbq) {
      const fbName = event === 'lead_submit' ? 'Lead' : event === 'whatsapp_click' ? 'Contact' : 'ViewContent';
      window.fbq('track', fbName, params);
    }
    if (window.ttq?.track) {
      const ttName = event === 'lead_submit' ? 'SubmitForm' : event === 'whatsapp_click' ? 'Contact' : 'ViewContent';
      window.ttq.track(ttName, params);
    }
  } catch {
    /* аналитика не должна ломать сайт */
  }
}
