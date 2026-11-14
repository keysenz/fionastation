import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3456';
const OUT = new URL('./evidence/commission/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:3911';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'verify-admin-secret';
const MANAGER = '111111111111111111';
const results = [];
const sentQuote = c => c.quote;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
// NOTE: `failures` makes that many first posts answer 500 from the browser side, to prove the retry
// reuses the inquiry id. Every other post reaches the real server.
const newPage = async (failures = 0) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const sent = [];
  const replies = [];
  let external = 0;
  let left = failures;
  page.on('request', r => { if (r.method() === 'POST' && !r.url().startsWith(BASE)) external++; });
  page.on('response', async r => {
    if (r.url().endsWith('/api/inquiry') && r.request().method() === 'POST') replies.push({ status: r.status(), body: await r.text().catch(() => '') });
  });
  await page.route('**/api/inquiry', async route => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    if (left > 0) { left--; return route.fulfill({ status: 500, body: 'boom' }); }
    return route.continue();
  });
  return { page, sent, replies, external: () => external };
};
const admin = async (method, path, body, { secret = ADMIN_SECRET, acting = MANAGER } = {}) => {
  const res = await fetch(`${ADMIN}${path}`, {
    method,
    headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(acting ? { 'X-Acting-Discord-Id': acting } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const created = {};
const trackingLink = async (page, kind) => {
  const link = page.getByRole('link', { name: 'Track your commission' });
  await link.waitFor();
  const href = await link.getAttribute('href');
  created[kind] = { href, id: href.split('/')[2].split('?')[0], token: new URL(href, BASE).searchParams.get('t') };
  return href;
};
const settle = (page) => page.waitForTimeout(200);
const next = async (page) => { await page.getByRole('button', { name: 'Next' }).click(); await settle(page); };
const quote = async (page) => { await settle(page); return page.getByLabel('Price estimate').innerText(); };
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

{
  const { page, sent, replies } = await newPage(1);
  await page.goto(`${BASE}/hire`);
  await page.getByRole('link', { name: 'Paopoa Studio' }).waitFor();
  await next(page);
  check('hire: Next blocked on empty step', await page.getByText('Some answers need another look').isVisible());
  await page.getByLabel('Your name').fill('Mika');
  await page.getByLabel('Contact (Discord or email)').fill('mika#0001');
  await next(page);
  await page.getByText('Commercial', { exact: true }).last().click();
  await page.getByText('Short', { exact: true }).last().click();
  check('hire: quote Commercial Short', (await quote(page)).includes('Rp300.000') && (await quote(page)).includes('$60'), (await quote(page)).replace(/\n/g, ' | '));
  await shot(page, 'hire-1-quote-short');
  await page.getByRole('radiogroup', { name: 'Song length' }).getByText('Full song').click();
  check('hire: quote updates to Commercial Full', (await quote(page)).includes('Rp600.000') && (await quote(page)).includes('$120'));
  await shot(page, 'hire-2-quote-full');
  await next(page);
  await page.getByLabel('Song details').fill('Homura, 4:30');
  await next(page);
  await next(page);
  check('hire: agreement required', await page.getByText('Tick this to continue.').isVisible());
  await page.getByRole('checkbox').check();
  await settle(page);
  await next(page);
  check('hire: review shows answers and quote', (await page.locator('main').innerText()).includes('Homura, 4:30') && (await quote(page)).includes('Rp600.000'));
  await shot(page, 'hire-3-review');
  await page.getByRole('button', { name: 'Back' }).click();
  check('hire: Back keeps answers', await page.getByRole('checkbox').isChecked());
  await next(page);
  await page.getByRole('button', { name: 'Send inquiry' }).click();
  await page.getByText("Couldn't send").waitFor();
  check('hire: 500 shows error and keeps draft', (await page.locator('main').innerText()).includes('Homura, 4:30'));
  await shot(page, 'hire-4-failed');
  await page.getByRole('button', { name: 'Send inquiry' }).click();
  await page.getByText('Sent! Talk soon.').waitFor();
  await trackingLink(page, 'voice');
  await shot(page, 'hire-5-sent');
  const [a, b] = sent;
  check('hire: payload shape', a.kind === 'voice' && typeof a.id === 'string' && a.fields.name === 'Mika' && a.quote._tag === 'Priced' && a.quote.total.idr === 600000 && a.quote.total.usd === 120 && a.quote.deposit === null, JSON.stringify(a));
  check('hire: same id on retry', sent.length === 2 && a.id === b.id, `${a.id} ${b.id}`);
  check('hire: id is a uuid', /^[0-9a-f-]{36}$/.test(a.id));
  check('hire: server answered 201 with a tracking link for that id', replies.at(-1)?.status === 201 && created.voice.id === a.id && /^\/commission\/[0-9a-f-]{36}\?t=[\w-]+$/.test(created.voice.href), JSON.stringify(replies));
  check('hire: Sent screen shows the link', await page.getByText('Save this link').isVisible());
}

{
  const { page, sent, replies, external } = await newPage();
  await page.goto(`${BASE}/studio`);
  await page.getByLabel('Your name').fill('Mika');
  await page.getByLabel('Contact (Discord or email)').fill('mika#0001');
  await next(page);
  await page.getByLabel('Song and original artist').fill('Gurenge - LiSA');
  await page.getByLabel('Vocal and instrumental or karaoke files link').fill('nope');
  await next(page);
  check('studio: bad link blocked', await page.getByText('Use a full link that starts with https://').isVisible());
  await page.getByLabel('Vocal and instrumental or karaoke files link').fill('https://drive.example.com/x');
  await next(page);
  await page.getByText('Full Production', { exact: true }).last().click();
  await page.getByText('Short', { exact: true }).last().click();
  const q0 = await quote(page);
  check('studio: Full Short = Rp100.000 / $20', q0.includes('Rp100.000') && q0.includes('$20'), q0.replace(/\n/g, ' | '));
  await shot(page, 'studio-1-base');
  await page.getByLabel('Number of vocal tracks').selectOption('5');
  const q1 = await quote(page);
  check('studio: 5 tracks adds 2 extra', q1.includes('Rp150.000') && q1.includes('$30'), q1.replace(/\n/g, ' | '));
  await page.getByText('Complex adlibs').click();
  const q2 = await quote(page);
  check('studio: complex adlibs added', q2.includes('Rp300.000'), q2.replace(/\n/g, ' | '));
  await page.getByText('Standard', { exact: true }).last().click();
  const q3 = await quote(page);
  check('studio: Standard 5 tracks + complex adlibs, deposit', q3.includes('Rp450.000') && q3.includes('$90') && /deposit.*Rp225\.000/.test(q3), q3.replace(/\n/g, ' | '));
  await shot(page, 'studio-2-deposit');
  await next(page);
  await page.getByRole('radiogroup', { name: 'Deadline' }).getByText('Rush').click();
  const q4 = await quote(page);
  check('studio: rush +50%', q4.includes('Rp675.000'), q4.replace(/\n/g, ' | '));
  await page.getByText('This is my first commission').click();
  const q5 = await quote(page);
  check('studio: intro 25% off', q5.includes('Rp506.250') && q5.includes('$101.25'), q5.replace(/\n/g, ' | '));
  await shot(page, 'studio-3-modifiers');
  await next(page);
  await page.getByLabel('Reference and notes').fill('Ref attached');
  await page.getByRole('checkbox').check();
  await next(page);
  await shot(page, 'studio-4-review');
  check('studio: review shows quote and answers', (await quote(page)).includes('Rp506.250') && (await page.locator('main').innerText()).includes('Gurenge - LiSA'));
  await page.getByRole('button', { name: 'Send inquiry' }).click();
  await page.getByText('Sent! Talk soon.').waitFor();
  await trackingLink(page, 'studio');
  await shot(page, 'studio-6-sent');
  check('studio: server answered 201', replies.at(-1)?.status === 201, JSON.stringify(replies));
  check('studio: payload', sent[0].kind === 'studio' && sent[0].quote.total.idr === 506250 && sent[0].quote.deposit.idr === 253125, JSON.stringify(sent[0].quote));
  check('studio: no POST left the origin', external() === 0);
  const long = await newPage();
  await long.page.goto(`${BASE}/studio`);
  await long.page.getByLabel('Your name').fill('a'); await long.page.getByLabel('Contact (Discord or email)').fill('b'); await next(long.page);
  await long.page.getByLabel('Song and original artist').fill('s'); await long.page.getByLabel('Vocal and instrumental or karaoke files link').fill('https://a.example.com'); await next(long.page);
  await long.page.getByText('Full Production', { exact: true }).last().click();
  await long.page.getByText('Long', { exact: true }).last().click();
  check('studio: Long is by case', (await quote(long.page)).includes('Priced by case'));
  await shot(long.page, 'studio-5-long');
}

{
  const { page, sent, replies } = await newPage();
  await page.goto(`${BASE}/endorse`);
  check('endorse: no quote card', (await page.getByLabel('Price estimate').count()) === 0);
  await page.getByLabel('Brand or company').fill('Acme');
  await page.getByLabel('Contact person and email').fill('Ann, ann@acme.test');
  await next(page);
  await next(page);
  check('endorse: channel required', await page.getByText('Pick at least one channel.').isVisible());
  await page.getByText('YouTube', { exact: true }).click();
  await page.getByLabel('Budget range').selectOption('$300 – $700');
  await next(page);
  await page.getByLabel('Campaign details').fill('Launch stream');
  await next(page);
  await shot(page, 'endorse-1-review');
  await page.getByRole('button', { name: 'Send inquiry' }).click();
  await page.getByText('Sent! Talk soon.').waitFor();
  await trackingLink(page, 'endorse');
  check('endorse: server answered 201', replies.at(-1)?.status === 201, JSON.stringify(replies));
  check('endorse: payload', sent[0].kind === 'endorse' && sent[0].quote === null && sent[0].fields.channels === 'YouTube' && sent[0].fields.budget === '$300 – $700', JSON.stringify(sent[0]));
}

{
  const { page } = await newPage();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/studio`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('studio: no horizontal scroll at 390px', !overflow);
  await shot(page, 'studio-mobile');
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Hire Fio' }).first().click();
  check('radio header links to /hire', page.url().endsWith('/hire'));
  for (const p of ['hire', 'studio', 'endorse']) {
    const res = await page.goto(`${BASE}/${p}`);
    check(`server serves /${p} shell`, res.status() === 200);
  }
}

{
  const { voice, studio, endorse } = created;
  check('three forms produced three tracking links', Boolean(voice && studio && endorse) && new Set([voice.id, studio.id, endorse.id]).size === 3);

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const timeline = () => page.getByLabel('Status history').locator('li');
  const open = async () => { await page.goto(`${BASE}${voice.href}`); await page.getByRole('heading', { name: 'Your commission' }).waitFor(); await page.getByLabel('Status history').waitFor(); };

  await open();
  const first = await page.locator('main').innerText();
  check('track: kind, date and Received status', first.includes("Fio's voice, sent") && /UTC/.test(first) && first.includes('Received'), first.replace(/\n/g, ' | '));
  check('track: one timeline entry', (await timeline().count()) === 1);
  check('track: no name or contact shown', !/Mika|mika#0001/.test(first));
  await shot(page, 'track-1-received');

  const bad = await ctx.newPage();
  await bad.goto(`${BASE}/commission/${voice.id}?t=${voice.token.slice(0, -1)}${voice.token.endsWith('A') ? 'B' : 'A'}`);
  await bad.getByText("can't find a commission").waitFor();
  check('track: a wrong token shows the unknown screen', true);
  await bad.screenshot({ path: `${OUT}track-2-wrong-token.png`, fullPage: true });
  await bad.goto(`${BASE}/commission/${voice.id}`);
  await bad.getByText("can't find a commission").waitFor();
  check('track: a link with no token shows the unknown screen', true);
  await bad.goto(`${BASE}/commission/6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0099?t=${voice.token}`);
  await bad.getByText("can't find a commission").waitFor();
  check('track: an unknown id shows the same unknown screen', true);
  const shellRes = await bad.goto(`${BASE}/commission/not-a-uuid`);
  check('track: a non-UUID path is a 404 page', shellRes.status() === 404);

  const noSecret = await admin('GET', '/admin/commissions/unposted', undefined, { secret: '' });
  const wrongSecret = await admin('GET', '/admin/commissions/unposted', undefined, { secret: 'nope' });
  check('admin: no secret and a wrong secret answer 403', noSecret.status === 403 && wrongSecret.status === 403);
  const publicAdmin = await fetch(`${BASE}/admin/commissions/unposted`, { headers: { Authorization: `Bearer ${ADMIN_SECRET}` } });
  check('admin: the public listener does not serve /admin', publicAdmin.status === 404);

  const listed = await admin('GET', '/admin/commissions/unposted');
  const mine = listed.body.filter(c => [voice.id, studio.id, endorse.id].includes(c.id));
  check('admin: unposted lists all three, oldest first', listed.status === 200 && mine.length === 3 && mine.map(c => c.id).join() === [voice.id, studio.id, endorse.id].join(), mine.map(c => `${c.kind}:${c.status}`).join());
  const [v, st, en] = mine;
  check('admin: voice keeps its fields and the server price', v.fields.name === 'Mika' && v.quote.total.idr === 600000 && v.next.join() === 'quoted,declined', JSON.stringify(v.quote));
  check('admin: studio server price matches the browser (506250, deposit 253125)', st.quote._tag === 'Priced' && st.quote.total.idr === 506250 && st.quote.deposit.idr === 253125, JSON.stringify(st.quote));
  check('admin: endorse has no quote', en.quote === null && en.fields.brand === 'Acme');
  check('admin: createdAt is RFC3339', mine.every(c => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(c.createdAt)));

  const posted = await admin('POST', `/admin/commissions/${voice.id}/posted`, { channelId: '222222222222222222', messageId: '333333333333333333' });
  const postedAgain = await admin('POST', `/admin/commissions/${voice.id}/posted`, { channelId: '222222222222222222', messageId: '333333333333333333' });
  const postedOther = await admin('POST', `/admin/commissions/${voice.id}/posted`, { channelId: '222222222222222222', messageId: '444444444444444444' });
  check('admin: posted is 200, repeated 200, a different pair 409', posted.status === 200 && postedAgain.status === 200 && postedOther.status === 409, `${posted.status} ${postedAgain.status} ${postedOther.status}`);
  const after = await admin('GET', '/admin/commissions/unposted');
  check('admin: a posted commission leaves the unposted list', !after.body.some(c => c.id === voice.id) && after.body.some(c => c.id === studio.id));

  const forbidden = await admin('POST', `/admin/commissions/${voice.id}/events`, { status: 'in_progress' });
  check('admin: received to in_progress is refused with 400', forbidden.status === 400 && typeof forbidden.body.error === 'string', JSON.stringify(forbidden));
  await open();
  check('track: a refused move leaves the timeline alone', (await timeline().count()) === 1);
  const noActing = await admin('POST', `/admin/commissions/${voice.id}/events`, { status: 'quoted' }, { acting: '' });
  check('admin: an event without X-Acting-Discord-Id is 400', noActing.status === 400);

  const steps = [['quoted', 'Quote sent', 'Rp600.000, send to the invoice link'], ['deposit_paid', 'Deposit paid', undefined], ['in_progress', 'In progress', undefined]];
  for (const [i, [status, label, note]] of steps.entries()) {
    const moved = await admin('POST', `/admin/commissions/${voice.id}/events`, { status, note });
    check(`admin: move to ${status}`, moved.status === 200 && moved.body.status === status, JSON.stringify(moved.body.next));
    if (i === 0) {
      const again = await admin('POST', `/admin/commissions/${voice.id}/events`, { status });
      check('admin: repeating the current status is 200 without a new row', again.status === 200);
    }
    await open();
    const text = await page.locator('main').innerText();
    check(`track: reload shows ${label} and ${i + 2} timeline entries`, (await timeline().count()) === i + 2 && text.includes(label) && (!note || text.includes(note)), text.replace(/\n/g, ' | '));
    await shot(page, `track-${i + 3}-${status}`);
  }
  const final = await admin('POST', `/admin/commissions/${voice.id}/events`, { status: 'final' });
  check('admin: in_progress to final is refused', final.status === 400);
  const missing = await admin('POST', `/admin/commissions/6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0099/events`, { status: 'quoted' });
  check('admin: an unknown id is 404', missing.status === 404);

  const api = await fetch(`${BASE}/api/commission/${voice.id}?t=${voice.token}`);
  const apiBody = await api.json();
  check('api: the public read has events and no contact details', api.status === 200 && apiBody.events.length === 4 && !JSON.stringify(apiBody).includes('Mika') && !JSON.stringify(apiBody).includes('mika#0001'), JSON.stringify(Object.keys(apiBody)));
  const apiBad = await fetch(`${BASE}/api/commission/${voice.id}?t=wrong`);
  const apiMissing = await fetch(`${BASE}/api/commission/6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0099?t=${voice.token}`);
  check('api: a bad token and a missing id both answer 404', apiBad.status === 404 && apiMissing.status === 404 && (await apiBad.text()) === (await apiMissing.text()));

  const replay = await fetch(`${BASE}/api/inquiry`, { method: 'POST', body: JSON.stringify({ id: voice.id, kind: 'voice', fields: v.fields, quote: sentQuote(v) }) });
  check('api: posting the stored payload again is a 200 with the same link', replay.status === 200 && (await replay.json()).trackingUrl === voice.href, String(replay.status));
  const clash = await fetch(`${BASE}/api/inquiry`, { method: 'POST', body: JSON.stringify({ id: voice.id, kind: 'voice', fields: { ...v.fields, name: 'Someone else' }, quote: null }) });
  check('api: the same id with another payload is 409', clash.status === 409);
  const blankName = await fetch(`${BASE}/api/inquiry`, { method: 'POST', body: JSON.stringify({ id: '6f0e5d0a-5a43-4c52-9a56-2a8f0f6c0098', kind: 'endorse', fields: { ...en.fields, brand: ' ' }, quote: null }) });
  check('api: a required answer left blank is 400', blankName.status === 400);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const m = await mobile.newPage();
  await m.goto(`${BASE}${voice.href}`);
  await m.getByLabel('Status history').waitFor();
  check('track: no horizontal scroll at 390px', !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await m.screenshot({ path: `${OUT}track-6-mobile.png`, fullPage: true });
}

await browser.close();
writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
process.exit(results.every(r => r.ok) ? 0 : 1);
