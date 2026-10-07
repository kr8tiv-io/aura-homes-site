/**
 * One submit path for the quote, contact, and join forms.
 * Success is a 2xx from an https inbox, or a mailto draft the visitor still sends.
 * An empty inbox keeps the typed note and does not claim it was received.
 */

import { formEndpoint } from '../data/site';

export const heldLine = 'Our inbox opens soon. Your note is still here, so nothing is lost.';

export const draftLine = 'Your draft is ready to send.';

export const endpoint = formEndpoint;

export type SubmitOutcome =
  | { ok: true; via: 'https' }
  | { ok: true; via: 'mailto'; href: string }
  | { ok: false; via: 'held' }
  | { ok: false; via: 'honeypot' }
  | { ok: false; via: 'error' };

export function honeypotFilled(form: HTMLFormElement, name = 'company'): boolean {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement && el.value.trim() !== '';
}

export function readField(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? '';
  if (el instanceof HTMLTextAreaElement) return el.value.trim();
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked ? 'yes' : '';
    return el.value.trim();
  }
  return '';
}

export function mailDraftHref(
  mailto: string,
  subject: string,
  fields: ReadonlyArray<readonly [string, string]>,
): string {
  const lines = fields.map(([label, value]) => `${label}: ${value}`);
  const base = mailto.trim();
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

/** Opens the draft. data-mail-draft holds the href for a moment so a check can read it. */
export function openMailDraft(href: string) {
  document.documentElement.setAttribute('data-mail-draft', href);
  window.location.href = href;
}

export async function submitNote(options: {
  endpoint?: string;
  form: HTMLFormElement;
  subject: string;
  fields: ReadonlyArray<readonly [string, string]>;
}): Promise<SubmitOutcome> {
  if (honeypotFilled(options.form)) return { ok: false, via: 'honeypot' };

  const target = (options.endpoint ?? endpoint).trim();
  if (target.toLowerCase().startsWith('mailto:')) {
    const href = mailDraftHref(target, options.subject, options.fields);
    openMailDraft(href);
    return { ok: true, via: 'mailto', href };
  }

  if (target.startsWith('https://')) {
    try {
      const body = new FormData(options.form);
      body.delete('company');
      const res = await fetch(target, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return { ok: false, via: 'error' };
      return { ok: true, via: 'https' };
    } catch {
      return { ok: false, via: 'error' };
    }
  }

  return { ok: false, via: 'held' };
}

/** Bring a confirmation into view below the fixed bar. Leaves it alone when it is already clear. */
export function scrollClearOfHeader(target: HTMLElement) {
  const bar = document.querySelector<HTMLElement>('.site-nav');
  const barHeight = bar ? bar.getBoundingClientRect().height : 56;
  const clearance = Math.round(barHeight + 28);
  const rect = target.getBoundingClientRect();
  const inView = rect.top >= clearance && rect.bottom <= window.innerHeight - 12;
  if (inView) return;

  window.__lenis?.resize();
  if (window.__lenis) {
    window.__lenis.scrollTo(target, { offset: -clearance, immediate: true, force: true });
    return;
  }
  const top = window.scrollY + rect.top - clearance;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
}
