import type { APIRoute } from 'astro';
import { acceptJoin, limited } from '../../lib/signups';

export const prerender = false;

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return Response.json({ ok: false, message: 'Send that from this site.' }, { status: 403 });
      }
    } catch {
      return Response.json({ ok: false, message: 'Send that from this site.' }, { status: 403 });
    }
  }
  if (limited(clientAddress || 'local')) {
    return Response.json(
      { ok: false, message: 'We have your last note. Give it a minute, then try again.' },
      { status: 429 },
    );
  }

  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return Response.json({ ok: false, message: 'We could not read that. Try again.' }, { status: 400 });
  }

  const result = await acceptJoin({
    kind: field(data, 'kind'),
    email: field(data, 'email'),
    name: field(data, 'name'),
    shell: field(data, 'shell'),
    note: field(data, 'note'),
    list: field(data, 'list') === 'yes',
    consent: field(data, 'consent') === 'yes',
    company: field(data, 'company'),
  });

  if (!result.ok) return Response.json({ ok: false, message: result.message }, { status: result.status });

  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  if (!wantsJson) {
    const kind = field(data, 'kind') === 'preorder' ? 'preorder' : 'list';
    return Response.redirect(new URL(`/?joined=${kind}#${kind}`, request.url), 303);
  }
  return Response.json({ ok: true, message: result.message });
};
