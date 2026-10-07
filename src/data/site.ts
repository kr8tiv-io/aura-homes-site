/**
 * Public contact details and the form inbox.
 *
 * Matt fills the four values below. Leave a value as '' until it is real.
 * Do not invent an address, a phone number, a channel, or a form id.
 *
 * The domain's MX already points at Hostinger, so a mailbox such as
 * hello@aurahomes.fun can be used once that mailbox exists. Do not set it here
 * until the mailbox is live.
 *
 * formEndpoint:
 * - '' keeps every note on the page. Nothing is sent, and no form claims success.
 * - An https URL (Formspree, Basin, Getform, or the same shape) receives a POST
 *   of the form fields with Accept: application/json. Success shows only on a 2xx.
 *   Web3Forms accepts that POST when its access key is one of the fields. This
 *   site sends the fields the visitor filled. It does not add a key.
 * - A mailto: URL opens a prefilled draft in the visitor's mail app. The draft
 *   is ready to send. The site does not send it. Very long notes can be trimmed
 *   by the mail app.
 * Anything else, including a relative path, is treated as empty. GitHub Pages
 * has no /api/join, so do not point this at a site path.
 */

export const contactEmail = '';

export const contactPhone = '';

export const youtubeUrl = '';

export const formEndpoint = '';

export function httpsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('https://')) return '';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** tel: href, or '' when the value has no digits. */
export function phoneTel(value: string): string {
  const compact = value.trim().replace(/[^\d+]/g, '');
  return compact ? `tel:${compact}` : '';
}

/**
 * Action on the form element itself.
 * https posts, mailto opens a draft, and an empty inbox stays on the page.
 */
export function formAction(endpoint: string = formEndpoint): string {
  const value = endpoint.trim();
  if (value.startsWith('https://')) return value;
  if (value.toLowerCase().startsWith('mailto:')) return value;
  return '#';
}
