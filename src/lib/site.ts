/**
 * Общий клиентский код всех страниц: курсор, магнитные кнопки, меню, аналитика.
 * Главная подключает свой сценарий отдельно (lib/home.ts).
 */
import { initAnalytics, track } from './analytics';

const finePointer = () => window.matchMedia('(pointer: fine)').matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Курсор: кольцо с mix-blend-mode: difference ---------- */
function initCursor() {
  if (!finePointer() || reducedMotion()) return;
  const ring = document.querySelector<HTMLElement>('.cursor__ring');
  if (!ring) return;
  document.body.classList.add('has-cursor');

  let x = -100;
  let y = -100;
  let tx = x;
  let ty = y;
  let raf = 0;

  const loop = () => {
    x += (tx - x) * 0.35;
    y += (ty - y) * 0.35;
    ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    raf = requestAnimationFrame(loop);
  };

  window.addEventListener(
    'pointermove',
    (e) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(loop);
    },
    { passive: true },
  );
  document.addEventListener('mouseleave', () => ring.classList.add('is-hidden'));
  document.addEventListener('mouseenter', () => ring.classList.remove('is-hidden'));

  const interactive = 'a, button, [role="button"], input, select, textarea, label, [data-cursor]';
  document.addEventListener('pointerover', (e) => {
    const t = (e.target as Element | null)?.closest(interactive);
    ring.classList.toggle('is-active', Boolean(t));
  });
}

/* ---------- Магнитные кнопки ---------- */
function initMagnetic() {
  if (!finePointer() || reducedMotion()) return;
  const els = document.querySelectorAll<HTMLElement>('[data-magnetic]');
  els.forEach((el) => {
    const strength = Number(el.dataset.magnetic || 0.35);
    let raf = 0;
    let dx = 0;
    let dy = 0;
    let cx = 0;
    let cy = 0;
    const apply = () => {
      cx += (dx - cx) * 0.2;
      cy += (dy - cy) * 0.2;
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      raf = Math.abs(cx - dx) + Math.abs(cy - dy) > 0.1 ? requestAnimationFrame(apply) : 0;
    };
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      dx = (e.clientX - (r.left + r.width / 2)) * strength;
      dy = (e.clientY - (r.top + r.height / 2)) * strength;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    el.addEventListener('pointerleave', () => {
      dx = 0;
      dy = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    });
  });
}

/* ---------- Мобильное меню ---------- */
function initMenu() {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!btn || !menu) return;
  const setOpen = (open: boolean) => {
    document.body.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    if (open) {
      menu.querySelector<HTMLElement>('a, button')?.focus();
    }
  };
  btn.addEventListener('click', () => setOpen(!document.body.classList.contains('menu-open')));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
      setOpen(false);
      btn.focus();
    }
  });
}

/* ---------- Шапка: сжатие при скролле ---------- */
function initHeader() {
  const header = document.querySelector<HTMLElement>('.header');
  if (!header) return;
  let last = 0;
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 24);
    last = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ---------- WhatsApp клики ---------- */
function initWhatsApp() {
  document.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me"]').forEach((a) => {
    a.addEventListener('click', () => track('whatsapp_click', { page: location.pathname }));
  });
}

export function initSite() {
  initCursor();
  initMagnetic();
  initMenu();
  initHeader();
  initWhatsApp();
  if (document.body.dataset.analytics === '1') {
    const start = () => initAnalytics();
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 2500);
  }
}
