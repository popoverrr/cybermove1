/**
 * Подсказки главной (BRIEF-4 §4): «Листайте вниз» и карточка выбора языка при первом визите.
 * Карточка показывается только клиентским кодом (в HTML её нет для поисковиков), не показывается
 * в служебных режимах скриншотов и при повторных визитах; выбор языка запускает музыку и ведёт на
 * ту же страницу другого языка. Подсказка прокрутки стартует после закрытия карточки.
 */
import { state } from './state';
import { startAudio } from './audio';

const LANG_KEY = 'cm_lang';
const HINT_KEY = 'cm_hint';

const q = new URLSearchParams(location.search);
/** служебные режимы: скриншоты, постеры, отладка сцен */
const SERVICE = q.has('screen') || q.has('progress') || q.has('poster') || q.has('still');

function initScrollHint(reduced: boolean) {
  const el = document.querySelector<HTMLElement>('[data-scroll-hint]');
  if (!el || SERVICE) return;
  try {
    if (sessionStorage.getItem(HINT_KEY) === '1') return;
  } catch {}
  el.hidden = false;
  let shown = false;
  let done = false;
  const hide = () => {
    if (done || !shown) return;
    done = true;
    el.classList.remove('is-on');
    el.classList.add('is-off');
    window.setTimeout(() => (el.hidden = true), 600);
    try {
      sessionStorage.setItem(HINT_KEY, '1');
    } catch {}
    off();
  };
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', ' ', 'PageDown', 'PageUp'].includes(e.key)) hide();
  };
  const onScrollTick = () => {
    if (state.progress > 0.02) hide();
  };
  const off = () => {
    window.removeEventListener('wheel', hide);
    window.removeEventListener('touchmove', hide);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScrollTick);
  };
  window.setTimeout(() => {
    if (done) return;
    shown = true;
    el.classList.add('is-on');
    window.addEventListener('wheel', hide, { passive: true, once: true });
    window.addEventListener('touchmove', hide, { passive: true, once: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollTick, { passive: true });
    if (reduced) window.setTimeout(hide, 6000);
  }, 1200);
}

export function initHints(reduced: boolean) {
  const box = document.querySelector<HTMLElement>('[data-langbox]');
  const pageLang = document.documentElement.lang;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {}

  if (!box || SERVICE || stored) {
    initScrollHint(reduced);
    return;
  }

  const card = box.querySelector<HTMLElement>('[data-langbox-card]')!;
  const rows = Array.from(box.querySelectorAll<HTMLAnchorElement>('[data-lang-choice]'));
  const prefers = (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const preferred = rows.find((r) => r.dataset.langChoice === prefers) || rows[0];

  const close = (then?: () => void) => {
    box.classList.remove('is-on');
    box.classList.add('is-off');
    document.removeEventListener('keydown', onKeydown, true);
    window.setTimeout(() => {
      box.hidden = true;
      then?.();
      initScrollHint(reduced);
    }, 420);
  };

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      remember(pageLang);
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // ловушка фокуса: карточка — единственное, что доступно
    const focusables = rows;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !card.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !card.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  const remember = (lang: string) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
  };

  rows.forEach((row) => {
    row.addEventListener('click', (e) => {
      const chosen = row.dataset.langChoice!;
      remember(chosen);
      // выбор языка — это жест: запускаем музыку до навигации (она продолжится с той же позиции)
      startAudio();
      if (chosen === pageLang) {
        e.preventDefault();
        close();
      }
      // иначе — обычный переход по ссылке на ту же страницу другого языка
    });
  });

  box.querySelector<HTMLElement>('[data-langbox-scrim]')?.addEventListener('click', () => {
    remember(pageLang);
    close();
  });

  box.hidden = false;
  requestAnimationFrame(() => {
    box.classList.add('is-on');
    preferred?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', onKeydown, true);
}
