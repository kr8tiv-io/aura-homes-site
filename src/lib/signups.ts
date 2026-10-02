import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SHELLS = ['room', 'glass', 'resort', 'farm', 'water', 'unsure'] as const;
export type Shell = (typeof SHELLS)[number];
export type JoinKind = 'list' | 'preorder';
export type MailState = 'waiting' | 'pending' | 'error';

export type Signup = {
  at: string;
  kind: JoinKind;
  email: string;
  name: string;
  shell: Shell | '';
  note: string;
  list: boolean;
  mailchimp: MailState;
};

const FILE = join(process.cwd(), 'data', 'signups.jsonl');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const hits = new Map<string, number[]>();

function env(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function mailchimpConfig(): { key: string; audience: string; server: string } | null {
  const key = env('MAILCHIMP_API_KEY');
  const audience = env('MAILCHIMP_AUDIENCE_ID');
  const server = env('MAILCHIMP_SERVER') || (key.includes('-') ? key.split('-').pop() || '' : '');
  if (!key || !audience || !/^([a-z]{2,4}\d{1,3})$/.test(server)) return null;
  return { key, audience, server };
}

function clean(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 8) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export async function readSignups(): Promise<Signup[]> {
  try {
    const raw = await readFile(FILE, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Signup);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveSignup(row: Signup, already: boolean) {
  if (already) return;
  await mkdir(join(process.cwd(), 'data'), { recursive: true });
  await appendFile(FILE, `${JSON.stringify(row)}\n`, 'utf8');
}

function tagsFor(row: Pick<Signup, 'kind' | 'shell' | 'list'>): string[] {
  if (row.kind === 'list') return ['list'];
  const tags = ['preorder'];
  if (row.shell) tags.push(row.shell);
  if (row.list) tags.push('list');
  return tags;
}

export async function pushMailchimp(row: Pick<Signup, 'email' | 'name' | 'kind' | 'shell' | 'list'>): Promise<MailState> {
  const cfg = mailchimpConfig();
  if (!cfg) return 'waiting';
  const email = row.email.toLowerCase();
  const hash = createHash('md5').update(email).digest('hex');
  const parts = row.name.trim().split(/\s+/);
  const first = parts.shift() || '';
  const last = parts.join(' ');
  const auth = Buffer.from(`aura:${cfg.key}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
  try {
    const member = await fetch(`https://${cfg.server}.api.mailchimp.com/3.0/lists/${cfg.audience}/members/${hash}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        email_address: email,
        status_if_new: 'pending',
        merge_fields: { FNAME: first, LNAME: last },
      }),
    });
    if (!member.ok) {
      const detail = await member.text();
      console.error('mailchimp member', member.status, detail.slice(0, 280));
      return 'error';
    }
    const tagged = await fetch(`https://${cfg.server}.api.mailchimp.com/3.0/lists/${cfg.audience}/members/${hash}/tags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tags: tagsFor(row).map((name) => ({ name, status: 'active' as const })),
      }),
    });
    if (!tagged.ok) {
      const detail = await tagged.text();
      console.error('mailchimp tags', tagged.status, detail.slice(0, 280));
    }
    return 'pending';
  } catch (err) {
    console.error('mailchimp', err instanceof Error ? err.message : 'request failed');
    return 'error';
  }
}

export async function acceptJoin(input: {
  kind: string;
  email: string;
  name: string;
  shell: string;
  note: string;
  list: boolean;
  consent: boolean;
  company: string;
}): Promise<{ ok: true; message: string } | { ok: false; status: number; message: string }> {
  if (input.company) {
    return { ok: true, message: 'You are on the list.' };
  }
  const kind: JoinKind | null = input.kind === 'list' || input.kind === 'preorder' ? input.kind : null;
  const email = clean(input.email, 120).toLowerCase();
  const name = clean(input.name, 80);
  const note = clean(input.note, 500);
  const shell = (SHELLS as readonly string[]).includes(input.shell) ? (input.shell as Shell) : '';
  if (!kind) return { ok: false, status: 400, message: 'Choose the list, or a pre-order.' };
  if (!name) return { ok: false, status: 400, message: 'Add your name, so we know who to write.' };
  if (!EMAIL.test(email)) return { ok: false, status: 400, message: 'Add an email we can write to.' };
  if (kind === 'preorder' && !shell) return { ok: false, status: 400, message: 'Choose a room, or say you are not sure yet.' };
  if (kind === 'list' && !input.consent) {
    return { ok: false, status: 400, message: 'Tick the line that says yes, so we know you want the films and the offers.' };
  }

  const rows = await readSignups();
  const already = rows.some((row) => row.email === email && row.kind === kind);
  const onList = kind === 'list' || input.list;
  const row: Signup = {
    at: new Date().toISOString(),
    kind,
    email,
    name,
    shell: kind === 'preorder' ? shell : '',
    note: kind === 'preorder' ? note : '',
    list: onList,
    mailchimp: 'waiting',
  };
  row.mailchimp = await pushMailchimp(row);
  await saveSignup(row, already);
  return { ok: true, message: reply(kind, already, onList, row.mailchimp) };
}

function reply(kind: JoinKind, already: boolean, onList: boolean, mailchimp: MailState): string {
  const confirm = mailchimp === 'pending' ? ' Open the confirm note when it arrives, or the place does not stick.' : '';
  if (kind === 'preorder') {
    const base = already
      ? 'Your place was already held. We still have your name.'
      : 'Your place is held. We will write about that room before it is offered widely. No payment was taken.';
    const extra = !already && onList ? ' You are also first in line for the films, the releases, and the offers.' : '';
    return `${base}${extra}${confirm}`;
  }
  const base = already
    ? 'You are already first in line.'
    : 'You are first in line. The latest YouTube films, product releases, announcements, and the offers and perks kept for this list come to you before they go anywhere else.';
  return `${base}${confirm}`;
}
