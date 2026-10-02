import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const file = join(root, 'data', 'signups.jsonl');

function loadEnv(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[name]) process.env[name] = value;
  }
}

function tagsFor(row) {
  if (row.kind === 'list') return ['list'];
  const tags = ['preorder'];
  if (row.shell) tags.push(row.shell);
  if (row.list) tags.push('list');
  return tags;
}

try {
  loadEnv(await readFile(join(root, '.env'), 'utf8'));
} catch {
  /* .env is optional when the variables are already in the environment */
}

const key = (process.env.MAILCHIMP_API_KEY || '').trim();
const audience = (process.env.MAILCHIMP_AUDIENCE_ID || '').trim();
const server = ((process.env.MAILCHIMP_SERVER || '').trim() || (key.includes('-') ? key.split('-').pop() : '')).trim();
if (!key || !audience || !server) {
  console.error('Set MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID in .env, then run this again.');
  process.exit(1);
}

const raw = await readFile(file, 'utf8').catch((err) => {
  if (err.code === 'ENOENT') return '';
  throw err;
});
const rows = raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const auth = Buffer.from(`aura:${key}`).toString('base64');
const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
let sent = 0;
let failed = 0;

for (const row of rows) {
  if (row.mailchimp === 'pending') continue;
  const email = String(row.email || '').toLowerCase();
  const hash = createHash('md5').update(email).digest('hex');
  const parts = String(row.name || '').trim().split(/\s+/);
  const first = parts.shift() || '';
  const member = await fetch(`https://${server}.api.mailchimp.com/3.0/lists/${audience}/members/${hash}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'pending',
      merge_fields: { FNAME: first, LNAME: parts.join(' ') },
    }),
  });
  if (!member.ok) {
    row.mailchimp = 'error';
    failed += 1;
    console.error(email, member.status, (await member.text()).slice(0, 180));
    continue;
  }
  await fetch(`https://${server}.api.mailchimp.com/3.0/lists/${audience}/members/${hash}/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tags: tagsFor(row).map((name) => ({ name, status: 'active' })) }),
  });
  row.mailchimp = 'pending';
  sent += 1;
}

const body = rows.map((row) => JSON.stringify(row)).join('\n');
await writeFile(file, body ? `${body}\n` : '', 'utf8');
console.log(`Sent ${sent}. Failed ${failed}. Waiting ${rows.filter((row) => row.mailchimp !== 'pending').length}.`);
