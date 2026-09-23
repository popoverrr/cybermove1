/**
 * Дополнительная логика главной: счётчики и лента кейсов S7 (по прогрессу), Rail (прогресс, клики,
 * клавиатура), прелоадер (≤ 1.5 с), пульс ядра от аудио.
 */
import { state, SCREEN_IDS } from './state';

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/* ---------- S7: счётчики и лента по локальному прогрессу ---------- */
export function updateGrowth(local: number, reduced: boolean) {
  const counters = document.querySelectorAll<HTMLElement>('[data-count]');
  const k = reduced ? 1 : smooth((local - 0.04) / 0.36);
  counters.forEach((el) => {
    const target = Number(el.dataset.count || 0);
    const v = Math.round(target * k);
    if (el.textContent !== String(v)) el.textContent = String(v);
  });
  const ribbon = document.querySelector<HTMLElement>('[data-ribbon]');
  if (ribbon) {
    const wrap = ribbon.parentElement as HTMLElement;
    const max = Math.max(0, ribbon.scrollWidth - wrap.clientWidth + 48);
    const t = reduced ? 0 : smooth((local - 0.3) / 0.55);
    ribbon.style.transform = `translate3d(${(-max * t).toFixed(1)}px, 0, 0)`;
  }
}

/* ---------- Rail ---------- */
const STAGE_OF_SCREEN = ['CHAOS', 'CORE', 'SYSTEM', 'SYSTEM', 'SYSTEM', 'SYSTEM', 'GROWTH', 'GROWTH'];

export function initRail(scrollTo: (i: number) => void) {
  const rail = document.querySelector<HTMLElement>('[data-rail]');
  if (!rail) return;
  const btns = Array.from(rail.querySelectorAll<HTMLButtonElement>('[data-rail-go]'));
  btns.forEach((b) => b.addEventListener('click', () => scrollTo(Number(b.dataset.railGo))));
  rail.addEventListener('keydown', (e) => {
    const idx = btns.findIndex((b) => b === document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = Math.min(btns.length - 1, idx + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = btns.length - 1;
    if (next >= 0) {
      e.preventDefault();
      btns[next].focus();
      scrollTo(next);
    }
  });
}

export function updateRail(active: number, progress: number) {
  const rail = document.querySelector<HTMLElement>('[data-rail]');
  if (!rail) return;
  const bar = rail.querySelector<HTMLElement>('[data-rail-progress]');
  const n = SCREEN_IDS.length;
  // прогресс по шкале: позиция активного экрана + локальный прогресс внутри него
  const local = state.screens[active] ?? 0;
  const p = Math.min(1, (active + Math.min(local, 0.999)) / (n - 1));
  if (bar) {
    if (matchMedia('(max-width: 899px), (max-height: 560px)').matches) bar.style.width = `${(progress * 100).toFixed(2)}%`;
    else bar.style.height = `${(p * 100).toFixed(2)}%`;
  }
  rail.querySelectorAll<HTMLButtonElement>('[data-rail-go]').forEach((b, i) => {
    if (i === active) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
  const stage = STAGE_OF_SCREEN[active];
  rail.querySelectorAll<HTMLElement>('[data-rail-stage]').forEach((el) => el.classList.toggle('is-active', el.dataset.railStage === stage));
}

/* ---------- Прелоадер ---------- */
export function initPreloader(still: boolean) {
  const el = document.querySelector<HTMLElement>('[data-preloader]');
  if (!el) return;
  const count = el.querySelector<HTMLElement>('[data-preloader-count]');
  const bar = el.querySelector<HTMLElement>('[data-preloader-bar]');
  const start = performance.now();
  const MAX = 1500;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (count) count.textContent = '100';
    if (bar) bar.style.width = '100%';
    window.setTimeout(() => el.classList.add('is-done'), 120);
    document.body.classList.add('loaded');
  };
  if (new URLSearchParams(location.search).has('preloader')) {
    // отладка: заморозить прелоадер на 62 %
    if (count) count.textContent = '62';
    if (bar) bar.style.width = '62%';
    return;
  }
  if (still || state.reduced) {
    finish();
    return;
  }
  const tick = () => {
    if (done) return;
    const t = Math.min(1, (performance.now() - start) / MAX);
    // счётчик идёт быстро в начале и притормаживает к концу, но всегда завершается к MAX
    const v = Math.round(100 * (1 - Math.pow(1 - t, 2.2)));
    if (count) count.textContent = String(v).padStart(2, '0');
    if (bar) bar.style.width = `${v}%`;
    if (t >= 1) finish();
    else window.setTimeout(tick, 33);
  };
  tick();
  // если сцена готова раньше — завершаем раньше, но не быстрее 500 мс
  state.events.on('ready', () => {
    const elapsed = performance.now() - start;
    window.setTimeout(finish, Math.max(0, 500 - elapsed));
  });
}
