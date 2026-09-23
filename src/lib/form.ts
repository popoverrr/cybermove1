/**
 * Отправка формы заявки: валидация, honeypot, время заполнения, UTM, состояния (отправка / успех / ошибка).
 * В dev без PHP — мок (успех через 800 мс; ?mockfail — ошибка). События: lead_submit, formSuccess (сцена).
 */
import { state } from './state';
import { track } from './analytics';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function readUtm(): string {
  try {
    const q = new URLSearchParams(location.search);
    const found: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = q.get(k);
      if (v) found[k] = v.slice(0, 120);
    }
    if (Object.keys(found).length) {
      sessionStorage.setItem('cm_utm', JSON.stringify(found));
      return JSON.stringify(found);
    }
    return sessionStorage.getItem('cm_utm') || '';
  } catch {
    return '';
  }
}

function setInvalid(form: HTMLFormElement, name: string, invalid: boolean) {
  const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  const field = input?.closest('.field');
  field?.classList.toggle('is-invalid', invalid);
  input?.setAttribute('aria-invalid', String(invalid));
}

function validate(form: HTMLFormElement): boolean {
  const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
  const contact = form.querySelector<HTMLInputElement>('[name="contact"]')!;
  const okName = name.value.trim().length >= 2;
  const c = contact.value.trim();
  // телефон, WhatsApp, Telegram (@ник) или e-mail
  const okContact = /[+\d][\d\s().-]{6,}/.test(c) || /^@?[a-z0-9_]{4,}$/i.test(c) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
  setInvalid(form, 'name', !okName);
  setInvalid(form, 'contact', !okContact);
  if (!okName) name.focus();
  else if (!okContact) contact.focus();
  return okName && okContact;
}

function show(form: HTMLFormElement, which: 'sending' | 'success' | 'error' | null) {
  form.querySelectorAll<HTMLElement>('.lead__msg').forEach((m) => (m.hidden = true));
  form.classList.toggle('is-sending', which === 'sending');
  form.classList.toggle('is-done', which === 'success');
  if (which) {
    const el = form.querySelector<HTMLElement>(`.lead__msg--${which}`);
    if (el) {
      el.hidden = false;
      if (which !== 'sending') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

async function send(form: HTMLFormElement, payload: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const q = new URLSearchParams(location.search);
  const mock = import.meta.env.DEV || import.meta.env.PUBLIC_PREVIEW === '1' || q.has('mock') || q.has('mockfail');
  if (mock) {
    await new Promise((r) => setTimeout(r, 800));
    if (q.has('mockfail')) return { ok: false, error: 'mock' };
    return { ok: true };
  }
  const res = await fetch(form.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
  });
  let data: { ok?: boolean; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* не JSON — считаем ошибкой */
  }
  return { ok: res.ok && data.ok === true, error: data.error };
}

export function initForms() {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('[data-lead-form]'));
  const utm = readUtm();
  forms.forEach((form) => {
    const started = Date.now();
    form.querySelector<HTMLInputElement>('[data-page]')!.value = location.pathname;
    form.querySelector<HTMLInputElement>('[data-utm]')!.value = utm;
    form.querySelector<HTMLInputElement>('[data-ts]')!.value = String(started);

    form.querySelectorAll<HTMLInputElement>('input, textarea').forEach((el) => {
      el.addEventListener('focus', () => {
        state.formFocus = true;
        state.events.emit('formFocus', true);
      });
      el.addEventListener('blur', () => {
        state.formFocus = false;
        state.events.emit('formFocus', false);
      });
      el.addEventListener('input', () => {
        const field = el.closest('.field');
        if (field?.classList.contains('is-invalid')) field.classList.remove('is-invalid');
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate(form)) return;
      const fd = new FormData(form);
      const payload: Record<string, string> = {};
      fd.forEach((v, k) => (payload[k] = String(v)));
      payload.elapsed = String(Math.round((Date.now() - started) / 1000));
      show(form, 'sending');
      try {
        const r = await send(form, payload);
        if (r.ok) {
          show(form, 'success');
          state.events.emit('formSuccess', undefined);
          track('lead_submit', { format: payload.format, page: location.pathname });
        } else {
          show(form, 'error');
        }
      } catch {
        show(form, 'error');
      }
    });
  });
}
