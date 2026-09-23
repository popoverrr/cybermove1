/**
 * Сценарий главной: скролл (Lenis + ScrollTrigger), прогресс экранов → state, курсор, подписи орбит,
 * появление текста (SplitText), ленивая загрузка three-чанка, постер и фолбэки.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { state, SCREEN_IDS, setHover } from './state';
import { initRows, initDrawer, initAnchors, syncTheme } from './home-ui';
import { updateGrowth, initRail, updateRail, initPreloader } from './home-extra';
import { initForms } from './form';
import { initAudio } from './audio';
import type { Engine } from '../webgl/boot';

gsap.registerPlugin(ScrollTrigger, SplitText);

const q = new URLSearchParams(location.search);
const STILL = q.has('still');
const FORCE_FALLBACK = q.has('nogl');
const PROGRESS = q.get('progress');
const SCREEN = q.get('screen');
const LOCAL = q.get('local');
const T = q.get('t');
const HOVER = q.get('hover');
const POSTER = q.has('poster');

let engine: Engine | null = null;
let lenis: Lenis | null = null;
/** идёт программный скролл (Rail, якоря, клик по орбите) — snap не вмешивается */
let autoScrolling = false;
let autoTimer = 0;

function supportsWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    return Boolean(gl);
  } catch {
    return false;
  }
}

/* ---------- прогресс экранов ---------- */
interface ScreenDef {
  el: HTMLElement;
  pin: HTMLElement | null;
  /** начало и длительность в px (пересчитываются при ресайзе) */
  start: number;
  dur: number;
  enterEnd: number;
  exitStart: number;
  inFlow: boolean;
}
const screens: ScreenDef[] = [];
let stageWrap: HTMLElement | null = null;

function layoutScreens() {
  const vh = window.innerHeight;
  const mobile = window.innerWidth < 900;
  let acc = 0;
  for (const s of screens) {
    if (s.inFlow) continue;
    const durVh = Number((mobile && s.el.dataset.durMobile) || s.el.dataset.dur || 160);
    s.start = acc;
    s.dur = (durVh / 100) * vh;
    acc += s.dur;
  }
  if (stageWrap) stageWrap.style.height = `${acc + vh}px`;
  // экраны в потоке (S8): вход, когда верх секции доходит до низа окна
  for (const s of screens) {
    if (!s.inFlow) continue;
    s.start = s.el.offsetTop - vh;
    s.dur = vh;
  }
}

function measure() {
  const vh = window.innerHeight;
  const y = window.scrollY;
  const total = document.documentElement.scrollHeight - vh;
  state.progress = total > 0 ? Math.min(1, Math.max(0, y / total)) : 0;
  let active = 0;
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const raw = (y - s.start) / Math.max(s.dur, 1);
    const local = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    state.screens[i] = local;
    if (raw > 0) active = i;
    const enter = s.enterEnd > 0 ? Math.min(1, local / s.enterEnd) : 1;
    const exit = s.exitStart < 1 ? Math.max(0, (local - s.exitStart) / (1 - s.exitStart)) : 0;
    s.el.style.setProperty('--enter', enter.toFixed(4));
    s.el.style.setProperty('--exit', exit.toFixed(4));
  }
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const isActive = i === active || (i === active + 1 && state.screens[active] > screens[active].exitStart && !s.inFlow);
    s.el.classList.toggle('is-active', isActive);
  }
  const prev = document.body.dataset.screen;
  document.body.dataset.screen = String(active);
  if (prev !== String(active)) document.dispatchEvent(new CustomEvent('cm:screenchange', { detail: active }));
  const a = screens[active];
  const exitT = a ? Math.max(0, Math.min(1, (state.screens[active] - a.exitStart) / (1 - a.exitStart))) : 0;
  syncTheme(themes, active, exitT);
  updateRail(active, state.progress);
  updatePoster();
  const growthIdx = screens.findIndex((x) => x.el.id === 'growth');
  if (growthIdx >= 0) updateGrowth(state.screens[growthIdx], state.reduced);
}
const themes: string[] = [];
function currentScreen() {
  let a = 0;
  for (let i = 0; i < screens.length; i++) if (state.screens[i] > 0) a = i;
  return a;
}

/* ---------- скролл ---------- */
function initScroll() {
  const fine = matchMedia('(pointer: fine)').matches;
  if (fine && !state.reduced && !STILL) {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true, syncTouch: false, autoRaf: true });
    lenis.on('scroll', () => {
      ScrollTrigger.update();
      measure();
    });
    gsap.ticker.lagSmoothing(0);
    (window as unknown as { __cmLenis: Lenis }).__cmLenis = lenis;
    // Страховка: если первый rAF Lenis не сработал (встроенные/скрытые вкладки), запускаем цикл вручную
    const kick = () => {
      const l = lenis as unknown as { time: number; raf: (t: number) => void };
      if (l.time === 0) l.raf(performance.now());
    };
    setTimeout(kick, 800);
    window.addEventListener('load', () => setTimeout(kick, 200), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(kick, 100);
    });
  } else {
    window.addEventListener('scroll', measure, { passive: true });
  }
  window.addEventListener(
    'resize',
    () => {
      layoutScreens();
      measure();
    },
    { passive: true },
  );
  measure();
}

/** Мягкий snap к экранам: после остановки скролла доезжаем до ближайшей «полки» */
function initSnap() {
  if (!lenis || state.reduced) return;
  let timer = 0;
  let lastY = window.scrollY;
  const snapTargets = () => {
    const pts: number[] = [];
    screens.forEach((s, i) => {
      if (s.inFlow) {
        pts.push(s.start + s.dur);
        return;
      }
      pts.push(s.start + s.dur * (i === 0 ? 0.0 : 0.02)); // вход
      pts.push(s.start + s.dur * (i === 0 ? 0.22 : 0.42)); // удержание
    });
    return pts;
  };
  lenis.on('scroll', ({ scroll, velocity }: { scroll: number; velocity: number }) => {
    clearTimeout(timer);
    lastY = scroll;
    if (Math.abs(velocity) > 0.5) return;
    timer = window.setTimeout(() => {
      if (document.body.classList.contains('drawer-open') || autoScrolling) return;
      const pts = snapTargets();
      let best = -1;
      let bestD = window.innerHeight * 0.18;
      for (const p of pts) {
        const d = Math.abs(p - lastY);
        if (d < bestD && d > 2) {
          bestD = d;
          best = p;
        }
      }
      if (best >= 0) lenis!.scrollTo(best, { duration: 0.9, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
    }, 260);
  });
}

/* ---------- курсор в state ---------- */
function initPointer() {
  const p = state.pointer;
  window.addEventListener(
    'pointermove',
    (e) => {
      p.x = e.clientX;
      p.y = e.clientY;
      p.nx = (e.clientX / window.innerWidth) * 2 - 1;
      p.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      p.active = true;
    },
    { passive: true },
  );
  document.addEventListener('mouseleave', () => (p.active = false));
  if (matchMedia('(pointer: coarse)').matches) p.active = false;
}

/* ---------- подписи орбит (HTML-лейблы, привязанные к 3D-точкам) ---------- */
function initOrbitLabels() {
  const labels = Array.from(document.querySelectorAll<HTMLElement>('[data-orbit-label]'));
  if (!labels.length) return;
  const targets = labels.map((l) => Number(l.dataset.orbitLabel));
  const loop = () => {
    const hov = state.orbitHover;
    labels.forEach((el, i) => {
      const info = state.orbitLabels[targets[i]];
      if (!info) return;
      const vis = info.visible > 0.5;
      const show = vis && hov === targets[i];
      el.style.transform = `translate3d(${info.x.toFixed(1)}px, ${info.y.toFixed(1)}px, 0)`;
      el.classList.toggle('is-visible', show);
      el.classList.toggle('is-hover', hov === targets[i]);
    });
    document.body.classList.toggle('orbit-hover', hov >= 0 && state.screen === 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // клик по орбите → экран направления
  window.addEventListener('click', (e) => {
    if (state.orbitHover < 0 || state.screen !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select, label')) return;
    scrollToScreen(state.orbitHover + 1);
  });
  labels.forEach((el, i) => el.addEventListener('click', () => scrollToScreen(targets[i] + 1)));
}

export function scrollToScreen(index: number, hold = true) {
  const s = screens[index];
  if (!s) return;
  const y = s.inFlow ? s.start + s.dur : s.start + (hold ? s.dur * (index === 0 ? 0.22 : 0.42) : 0);
  autoScrolling = true;
  clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => (autoScrolling = false), 1800);
  if (lenis) lenis.scrollTo(y, { duration: 1.4, easing: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), onComplete: () => (autoScrolling = false) });
  else window.scrollTo({ top: y, behavior: state.reduced ? 'auto' : 'smooth' });
}

/* ---------- текст первого экрана ---------- */
let heroStarted = false;
function initHeroText(delay: number) {
  if (heroStarted) return;
  heroStarted = true;
  const h1 = document.querySelector<HTMLElement>('[data-hero-title]');
  const lead = document.querySelector<HTMLElement>('[data-hero-lead]');
  const ctas = document.querySelectorAll<HTMLElement>('[data-hero-cta] > *');
  const micro = document.querySelectorAll<HTMLElement>('[data-hero-micro]');
  const ticker = document.querySelector<HTMLElement>('[data-hero-ticker]');
  if (!h1) return;

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
  if (state.reduced) {
    gsap.set([h1, lead, ctas, micro, ticker], { autoAlpha: 1, y: 0 });
    return;
  }
  const split = new SplitText(h1, { type: 'lines', linesClass: 'line', mask: 'lines' });
  gsap.set(h1, { autoAlpha: 1 });
  tl.from(split.lines, { yPercent: 110, duration: 1.25, stagger: 0.07 }, 0);
  if (lead) tl.fromTo(lead, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 1.0 }, 0.55);
  if (ctas.length) tl.fromTo(ctas, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.08 }, 0.8);
  if (micro.length) tl.fromTo(micro, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, stagger: 0.05 }, 0.3);
  if (ticker) tl.fromTo(ticker, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9 }, 1.1);

  if (STILL) {
    const t = T !== null ? Number(T) : 4;
    tl.progress(1).pause();
    tl.seek(Math.max(0, t - delay));
    if (t - delay <= 0) tl.progress(0);
  } else {
    gsap.delayedCall(delay, () => tl.play());
  }
}

/* ---------- постер / фолбэк: статичные постеры экранов с кроссфейдом ---------- */
let posterLayers: HTMLElement[] = [];
let posterCurrent = '';
function showFallback(reason: string) {
  document.body.classList.add('gl-fallback');
  document.body.dataset.glFallback = reason;
  const host = document.querySelector<HTMLElement>('[data-poster]');
  if (!host) return;
  posterLayers = [0, 1].map(() => {
    const l = document.createElement('div');
    l.className = 'gl-poster__layer';
    host.appendChild(l);
    return l;
  });
  updatePoster(true);
}
function updatePoster(force = false) {
  if (!posterLayers.length) return;
  const active = currentScreen();
  const mobile = window.innerWidth < 900 && window.innerHeight > window.innerWidth;
  const name = `s${active + 1}${mobile ? '-m' : ''}`;
  if (name === posterCurrent && !force) return;
  posterCurrent = name;
  const on = posterLayers.find((l) => !l.classList.contains('is-on')) || posterLayers[0];
  const off = posterLayers.find((l) => l !== on)!;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  on.style.backgroundImage = `url(${base}/posters/${name}.webp)`;
  on.style.backgroundImage = `image-set(url(${base}/posters/${name}.avif) type("image/avif"), url(${base}/posters/${name}.webp) type("image/webp"))`;
  if (!on.style.backgroundImage) on.style.backgroundImage = `url(${base}/posters/${name}.webp)`;
  on.classList.add('is-on');
  off.classList.remove('is-on');
}

async function loadEngine(canvas: HTMLCanvasElement) {
  try {
    const mod = await import('../webgl/boot');
    engine = mod.boot(canvas, () => {
      document.body.classList.add('gl-ready');
    });
    canvas.dataset.tier = engine.tier.name;
  } catch (err) {
    console.error('[cybermove] WebGL init failed', err);
    showFallback('error');
  }
}

/* ---------- ?progress: поставить страницу в точку ---------- */
function applyProgressParam() {
  if (PROGRESS === null && SCREEN === null) return;
  let y = 0;
  if (SCREEN !== null) {
    // ?screen=2&local=0.4 — точка внутри экрана
    const s = screens[Number(SCREEN)];
    if (!s) return;
    y = Math.round(s.start + s.dur * Math.min(1, Math.max(0, Number(LOCAL ?? 0.4))));
  } else {
    const p = Math.min(1, Math.max(0, Number(PROGRESS)));
    const total = document.documentElement.scrollHeight - window.innerHeight;
    y = Math.round(p * total);
  }
  if (lenis) lenis.scrollTo(y, { immediate: true });
  window.scrollTo(0, y);
  measure();
}

export function initHome() {
  state.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (POSTER) document.body.classList.add('is-poster'); // только канвас — для генерации постеров
  stageWrap = document.querySelector<HTMLElement>('[data-stage-wrap]');
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-screen]'))) {
    const first = screens.length === 0;
    screens.push({
      el,
      pin: el.querySelector('.screen__pin'),
      start: 0,
      dur: 1,
      enterEnd: first ? 0 : Number(el.dataset.enter || 0.12),
      exitStart: Number(el.dataset.exit || (first ? 0.55 : 0.86)),
      inFlow: !el.closest('[data-stage]'),
    });
  }
  layoutScreens();
  themes.push(...screens.map((s) => s.el.dataset.theme || 'black'));
  initRows();
  initDrawer();
  initAnchors();
  initRail((i) => scrollToScreen(i));
  initPreloader(STILL);
  initForms();
  initAudio();
  const canvas = document.querySelector<HTMLCanvasElement>('#gl');
  // якоря #audit и т.п. → плавный скролл к экрану
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href')!.slice(1);
    const idx = screens.findIndex((s) => s.el.id === id);
    if (idx < 0) return;
    e.preventDefault();
    scrollToScreen(idx);
  });

  initPointer();
  initScroll();
  initSnap();
  initOrbitLabels();

  const canGl = canvas && supportsWebGL2() && !state.reduced && !FORCE_FALLBACK;
  if (!canGl) {
    showFallback(state.reduced ? 'reduced-motion' : 'no-webgl2');
    initHeroText(0.2);
  } else {
    // текст появляется синхронно со сборкой ядра (~1.1 с после первого кадра сцены)
    state.events.on('ready', () => initHeroText(1.05));
    const start = () => loadEngine(canvas!);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', () => setTimeout(start, 60), { once: true });
    // LCP — заголовок: не ждём движок дольше 1.4 с
    setTimeout(() => initHeroText(0), 1400);
  }

  // ?progress — после раскладки
  requestAnimationFrame(() => {
    applyProgressParam();
    setTimeout(applyProgressParam, 300);
  });

  if (HOVER) {
    // отладка: ?hover=<id услуги> — активная строка и реакция сцены
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-service="${HOVER}"]`)?.closest<HTMLElement>('[data-row]');
      row?.classList.add('is-active');
      setHover(HOVER);
    }, 400);
  }
  document.body.classList.add('home-ready');
  (window as unknown as { __cmScrollTo: typeof scrollToScreen }).__cmScrollTo = scrollToScreen;
}
