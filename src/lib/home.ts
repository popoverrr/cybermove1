/**
 * Сценарий главной версии 1 с моделью прокрутки версии 4 (BRIEF-V1 §2): «время решает, скролл выбирает».
 * Один цикл (gsap.ticker): lenis.raf → цели из скролла → сглаживание с лимитом скорости и очередью экранов →
 * DOM (только изменившееся) → engine.frame(). Сцены версии 1 не тронуты: они читают тот же state.screens[i],
 * что и раньше, только теперь сглаженный. Snap убран, ScrollTrigger не используется.
 */
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { state, setHover } from './state';
import { initRows, initDrawer, initAnchors, syncTheme } from './home-ui';
import { measureGrowth, updateGrowth, initRail, updateRail, initPreloader } from './home-extra';
import { initForms } from './form';
import { initAudio } from './audio';
import { initHints } from './home-hints';
import type { Engine } from '../webgl/boot';

gsap.registerPlugin(SplitText);

const q = new URLSearchParams(location.search);
const STILL = q.has('still');
const FORCE_FALLBACK = q.has('nogl');
const PROGRESS = q.get('progress');
const SCREEN = q.get('screen');
const LOCAL = q.get('local');
const T = q.get('t');
const HOVER = q.get('hover');
const POSTER = q.has('poster');
const STATS = q.has('stats');

/** пороги твинов текста экрана (BRIEF-V1 §2) */
const TEXT_IN = 0.08;
const TEXT_OUT = 0.78;
const COARSE = matchMedia('(pointer: coarse)').matches;
/** сглаживание λ и лимит скорости (единиц прогресса экрана в секунду): переход ≥ 1.4 с при любой прокрутке */
const LAMBDA = COARSE ? 4.5 : 7;
const VMAX = COARSE ? 0.35 : 0.42;
/** гистерезис смены активного экрана */
const HYST = COARSE ? 0.06 : 0.03;
/** сколько прогресса целевого экрана идёт обычным лимитом после догона (остальное пролистывается) */
const TAIL = COARSE ? 0.22 : 0.3;

let engine: Engine | null = null;
let lenis: Lenis | null = null;
/** идёт программный скролл (Rail, якоря, клик по орбите) — лимит скорости не действует */
let autoScrolling = false;
let autoTimer = 0;
let engineDone = false;

function supportsWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2', { failIfMajorPerformanceCaveat: false }));
  } catch {
    return false;
  }
}

/* ---------- экраны ---------- */
interface ScreenDef {
  el: HTMLElement;
  pin: HTMLElement | null;
  /** начало и длительность в px (пересчитываются только в layoutScreens) */
  start: number;
  dur: number;
  enterEnd: number;
  exitStart: number;
  inFlow: boolean;
  enterVar: number;
  exitVar: number;
  active: boolean;
  textIn: boolean;
  textOut: boolean;
}
const screens: ScreenDef[] = [];
const themes: string[] = [];
let stageWrap: HTMLElement | null = null;
let active = 0;
let layoutW = 0;
let layoutPortrait = false;
let layoutVh = 0;
let growthIdx = -1;
let totalScroll = 1;
let themeKey = '';
let railKey = '';
let scrollYNow = 0;
let stageEnd = 0;
let rushFwd = false;
let rushBack = false;

function layoutScreens(force = false) {
  const w = window.innerWidth;
  const portrait = window.innerHeight > w;
  // тач: адресная строка меняет только высоту — раскладку не трогаем (иначе прогресс прыгает при скролле)
  if (!force && COARSE && layoutVh && w === layoutW && portrait === layoutPortrait) return;
  layoutW = w;
  layoutPortrait = portrait;
  layoutVh = window.innerHeight;
  const vh = layoutVh;
  const mobile = w < 900;
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
  stageEnd = acc + vh;
  measureGrowth();
  totalScroll = document.documentElement.scrollHeight - vh;
}

/** Скролл пишет только цели */
function measureTargets() {
  const y = window.scrollY;
  scrollYNow = y;
  state.targetProgress = totalScroll > 0 ? Math.min(1, Math.max(0, y / totalScroll)) : 0;
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const raw = (y - s.start) / Math.max(s.dur, 1);
    state.targets[i] = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  }
}

function snapToTargets() {
  state.screens.set(state.targets);
  state.progress = state.targetProgress;
  active = pickActive(true);
  applyFrame(0, true);
}

function pickActive(instant = false): number {
  const s = state.screens;
  if (instant) {
    let a = 0;
    for (let i = 0; i < screens.length; i++) if (s[i] > 0) a = i;
    return a;
  }
  let a = active;
  while (a + 1 < screens.length && s[a + 1] > HYST) a++;
  while (a > 0 && s[a] < HYST * 0.15) a--;
  return a;
}

/**
 * Сглаживание с лимитом скорости и очередью экранов: двигается активный экран, следующие ждут, пока он
 * дойдёт до 1, предыдущие — пока он вернётся к 0. Прыжок дальше двух экранов включает режим догона:
 * промежуточные пролистываются почти мгновенно, последние 0.3 прогресса целевого идут обычным лимитом,
 * поэтому отставание от скролла не превышает 1.6 с.
 */
function smoothStep(dt: number): boolean {
  const s = state.screens;
  const t = state.targets;
  let moving = false;
  let far = 0;
  for (let i = 0; i < screens.length; i++) if (t[i] > 0.001 && i > far) far = i;
  let near = screens.length - 1;
  for (let i = screens.length - 1; i >= 0; i--) if (t[i] < 0.999 && i < near) near = i;
  if (far > active + 2) rushFwd = true;
  if (near < active - 2) rushBack = true;
  if (rushFwd && s[far] >= t[far] - TAIL) rushFwd = false;
  if (rushBack && s[near] <= t[near] + TAIL) rushBack = false;

  for (let i = 0; i < screens.length; i++) {
    const cur = s[i];
    let target = t[i];
    // очередь: экран входит, только когда все экраны до него дошли до 1 (и наоборот при движении назад)
    if (i > active) {
      for (let j = active; j < i; j++) {
        if (s[j] < 0.985) {
          target = Math.min(target, cur);
          break;
        }
      }
    } else if (i < active) {
      for (let j = i + 1; j <= active; j++) {
        if (s[j] > 0.015) {
          target = Math.max(target, cur);
          break;
        }
      }
    }
    const rush = (rushFwd && i <= far && cur < target - TAIL) || (rushFwd && i < far) || (rushBack && i >= near && cur > target + TAIL) || (rushBack && i > near);
    if (Math.abs(target - cur) < (rush ? 0.02 : 0.0004)) {
      if (cur !== target) s[i] = target;
      continue;
    }
    let step = (target - cur) * (1 - Math.exp(-LAMBDA * dt));
    const limit = autoScrolling ? Infinity : VMAX * (rush ? 16 : 1) * dt;
    if (rush) step = target - cur;
    if (Math.abs(step) > limit) step = Math.sign(step) * limit;
    s[i] = cur + step;
    moving = true;
  }
  // за пределами стейджа прогресс экранов не «доигрывает» под потоковыми секциями
  const past = scrollYNow > stageEnd - layoutVh * 0.2;
  const before = scrollYNow < screens[0].start;
  if (past || before) {
    const v = past ? 1 : 0;
    for (let i = 0; i < screens.length; i++) {
      if (screens[i].inFlow) continue;
      if (s[i] !== v) {
        s[i] = v;
        moving = true;
      }
    }
  }
  if (Math.abs(state.targetProgress - state.progress) < 0.0004) state.progress = state.targetProgress;
  else state.progress += (state.targetProgress - state.progress) * (1 - Math.exp(-LAMBDA * dt));
  return moving;
}

/* ---------- единый кадр ---------- */
let frameDirty = true;
let fpsCount = 0;
let fpsAt = 0;
let fpsNow = 0;
let statsEl: HTMLElement | null = null;

function tick(_time: number, deltaMs: number) {
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
  state.frame.dt = dt;
  state.frame.t = now;
  if (lenis) lenis.raf(now);
  const moving = smoothStep(dt);
  const next = pickActive();
  if (next !== active) {
    active = next;
    frameDirty = true;
  }
  if (moving || frameDirty) applyFrame(dt, false);
  if (engine && !engineDone) {
    if (!engine.frame(now)) engineDone = true;
  }
  fpsCount++;
  if (now - fpsAt >= 500) {
    fpsNow = Math.round((fpsCount * 1000) / (now - fpsAt));
    fpsCount = 0;
    fpsAt = now;
    if (statsEl) {
      const e = engine;
      statsEl.textContent = `${fpsNow} FPS · ${e ? e.stats.frameMs.toFixed(1) : '—'} MS · ${e ? e.tier.name.toUpperCase() : 'NO GL'} · DPR ${(e ? e.renderer.getPixelRatio() : window.devicePixelRatio).toFixed(2)} · CALLS ${e ? e.stats.calls : 0} · S${active + 1} ${state.screens[active].toFixed(2)}`;
    }
  }
}

function applyFrame(dt: number, instant: boolean) {
  frameDirty = false;
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const local = state.screens[i];
    const near = i === active || i === active + 1 || i === active - 1;
    if (near) {
      const enter = s.enterEnd > 0 ? Math.min(1, local / s.enterEnd) : 1;
      const exit = s.exitStart < 1 ? Math.max(0, (local - s.exitStart) / (1 - s.exitStart)) : 0;
      if (Math.abs(enter - s.enterVar) > 0.004 || instant) {
        s.enterVar = enter;
        s.el.style.setProperty('--enter', enter.toFixed(3));
      }
      if (Math.abs(exit - s.exitVar) > 0.004 || instant) {
        s.exitVar = exit;
        s.el.style.setProperty('--exit', exit.toFixed(3));
      }
    }
    const isActive = i === active || (i === active + 1 && state.screens[active] > screens[active].exitStart && !s.inFlow);
    if (isActive !== s.active) {
      s.active = isActive;
      s.el.classList.toggle('is-active', isActive);
    }
    updateText(s, i, local, dt);
  }
  const prev = document.body.dataset.screen;
  const cur = String(active);
  if (prev !== cur) {
    document.body.dataset.screen = cur;
    state.screen = active;
    document.dispatchEvent(new CustomEvent('cm:screenchange', { detail: active }));
  }
  state.screen = active;
  const a = screens[active];
  const exitT = a ? Math.max(0, Math.min(1, (state.screens[active] - a.exitStart) / (1 - a.exitStart))) : 0;
  const tk = `${active}|${exitT.toFixed(2)}`;
  if (tk !== themeKey) {
    themeKey = tk;
    syncTheme(themes, active, exitT);
  }
  const rk = `${active}|${state.progress.toFixed(3)}`;
  if (rk !== railKey) {
    railKey = rk;
    updateRail(active, state.progress);
  }
  if (growthIdx >= 0) updateGrowth(state.screens[growthIdx], state.reduced);
  updatePoster();
}

/* ---------- пороговые твины текста экрана (движение версии 1: вход снизу 36px, выход вверх 48/64px) ---------- */
function updateText(s: ScreenDef, i: number, local: number, dt: number) {
  const pin = s.pin;
  if (!pin || s.inFlow) return;
  const first = i === 0;
  const instant = dt === 0 || state.reduced;
  const wantIn = first ? true : s.textIn ? local > TEXT_IN - 0.04 : local >= TEXT_IN;
  const wantOut = s.textOut ? local > TEXT_OUT - 0.04 : local >= TEXT_OUT;
  if (wantIn !== s.textIn) {
    s.textIn = wantIn;
    if (!first) {
      gsap.killTweensOf(pin);
      if (wantIn) gsap.fromTo(pin, { autoAlpha: 0, y: 36 }, { autoAlpha: 1, y: 0, duration: instant ? 0 : 0.9, ease: 'expo.out', overwrite: true });
      else gsap.to(pin, { autoAlpha: 0, y: 36, duration: instant ? 0 : 0.5, ease: 'power2.out', overwrite: true });
    }
  }
  if (wantOut !== s.textOut) {
    s.textOut = wantOut;
    gsap.killTweensOf(pin);
    if (wantOut) gsap.to(pin, { autoAlpha: 0, y: first ? -64 : -48, duration: instant ? 0 : 0.6, ease: 'power2.inOut', overwrite: true });
    else gsap.to(pin, { autoAlpha: 1, y: 0, duration: instant ? 0 : 0.7, ease: 'expo.out', overwrite: true });
  }
}

/* ---------- скролл ---------- */
function initScroll() {
  const fine = matchMedia('(pointer: fine)').matches;
  if (fine && !state.reduced && !STILL) {
    lenis = new Lenis({ lerp: 0.075, wheelMultiplier: 0.85, smoothWheel: true, syncTouch: false, autoRaf: false });
    lenis.on('scroll', measureTargets);
    (window as unknown as { __cmLenis: Lenis }).__cmLenis = lenis;
  }
  window.addEventListener('scroll', measureTargets, { passive: true });
  window.addEventListener(
    'resize',
    () => {
      layoutScreens();
      measureTargets();
      frameDirty = true;
    },
    { passive: true },
  );
  measureTargets();
  snapToTargets();
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add(tick);
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
  if (COARSE) p.active = false;
}

/* ---------- подписи орбит (HTML-лейблы, привязанные к 3D-точкам) ---------- */
function initOrbitLabels() {
  const labels = Array.from(document.querySelectorAll<HTMLElement>('[data-orbit-label]'));
  if (!labels.length) return;
  const targets = labels.map((l) => Number(l.dataset.orbitLabel));
  // подписи обновляются в том же тикере, что и сцена
  gsap.ticker.add(() => {
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
  });
  // клик по орбите → экран направления
  window.addEventListener('click', (e) => {
    if (state.orbitHover < 0 || state.screen !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select, label')) return;
    scrollToScreen(state.orbitHover + 1);
  });
  labels.forEach((el, i) => el.addEventListener('click', () => scrollToScreen(targets[i] + 1)));
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Автоскролл к экрану: 1.8 с, во время него лимит скорости не действует */
export function scrollToScreen(index: number, hold = true) {
  const s = screens[index];
  if (!s) return;
  const y = s.inFlow ? s.start + s.dur : s.start + (hold ? s.dur * (index === 0 ? 0.22 : 0.42) : 0);
  if (state.reduced) {
    window.scrollTo(0, y);
    return;
  }
  autoScrolling = true;
  clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => (autoScrolling = false), 2000);
  if (lenis) lenis.scrollTo(y, { duration: 1.8, easing: easeInOutQuad, onComplete: () => (autoScrolling = false) });
  else {
    const from = { y: window.scrollY };
    gsap.to(from, { y, duration: 1.8, ease: 'power2.inOut', overwrite: true, onUpdate: () => window.scrollTo(0, from.y), onComplete: () => (autoScrolling = false) });
  }
}

/* ---------- текст первого экрана (SplitText версии 1) ---------- */
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
  const mobile = layoutW < 900 && layoutPortrait;
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
    // кадры рисует единый тикер страницы (tick), собственный rAF движка не запускаем
    engine = mod.create(canvas, () => document.body.classList.add('gl-ready'));
    canvas.dataset.tier = engine.tier.name;
  } catch (err) {
    console.error('[cybermove] WebGL init failed', err);
    showFallback('error');
  }
}

/* ---------- ?progress / ?screen: поставить страницу в точку ---------- */
function applyProgressParam() {
  if (PROGRESS === null && SCREEN === null) return;
  let y = 0;
  if (SCREEN !== null) {
    const s = screens[Number(SCREEN)];
    if (!s) return;
    y = Math.round(s.start + s.dur * Math.min(1, Math.max(0, Number(LOCAL ?? 0.4))));
  } else {
    y = Math.round(Math.min(1, Math.max(0, Number(PROGRESS))) * totalScroll);
  }
  if (lenis) lenis.scrollTo(y, { immediate: true });
  window.scrollTo(0, y);
  measureTargets();
  snapToTargets();
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
      enterVar: -1,
      exitVar: -1,
      active: false,
      textIn: first,
      textOut: false,
    });
  }
  growthIdx = screens.findIndex((s) => s.el.id === 'growth');
  layoutScreens(true);
  themes.push(...screens.map((s) => s.el.dataset.theme || 'black'));
  // экраны со второго начинают скрытыми: текст появляется пороговым твином
  if (!state.reduced) {
    for (let i = 1; i < screens.length; i++) {
      const p = screens[i].pin;
      if (p && !screens[i].inFlow) gsap.set(p, { autoAlpha: 0, y: 36 });
    }
  }
  initRows();
  initDrawer();
  initAnchors();
  initRail((i) => scrollToScreen(i));
  initPreloader(STILL);
  initForms();
  initAudio();
  if (STATS) {
    statsEl = document.createElement('p');
    statsEl.className = 'stats t-micro';
    document.body.appendChild(statsEl);
  }
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
  initHints(state.reduced);
  (window as unknown as { __cmScrollTo: typeof scrollToScreen }).__cmScrollTo = scrollToScreen;
}
