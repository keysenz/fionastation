import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3456';
const OUT = new URL('./evidence/commission/', import.meta.url).pathname;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const newPage = async (mode) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const sent = [];
  let external = 0;
  page.on('request', r => { if (r.method() === 'POST' && !r.url().startsWith(BASE)) external++; });
  await page.route('**/api/inquiry', async route => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    if (mode.length === 0) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const next = mode.shift();
    return next === 'ok'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'x', trackingUrl: '/t/x' }) })
      : route.fulfill({ status: 500, body: 'boom' });
  });
  return { page, sent, external: () => external };
};
const settle = (page) => page.waitForTimeout(200);
const next = async (page) => { await page.getByRole('button', { name: 'Next' }).click(); await settle(page); };
const quote = async (page) => { await settle(page); return page.getByLabel('Price estimate').innerText(); };
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

{
  const { page, sent } = await newPage(['fail', 'ok']);
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
  await shot(page, 'hire-5-sent');
  const [a, b] = sent;
  check('hire: payload shape', a.kind === 'voice' && typeof a.id === 'string' && a.fields.name === 'Mika' && a.quote._tag === 'Priced' && a.quote.total.idr === 600000 && a.quote.total.usd === 120 && a.quote.deposit === null, JSON.stringify(a));
  check('hire: same id on retry', sent.length === 2 && a.id === b.id, `${a.id} ${b.id}`);
  check('hire: id is a uuid', /^[0-9a-f-]{36}$/.test(a.id));
}

{
  const { page, sent, external } = await newPage(['ok']);
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
  check('studio: payload', sent[0].kind === 'studio' && sent[0].quote.total.idr === 506250 && sent[0].quote.deposit.idr === 253125, JSON.stringify(sent[0].quote));
  check('studio: no POST left the origin', external() === 0);
  const long = await newPage([]);
  await long.page.goto(`${BASE}/studio`);
  await long.page.getByLabel('Your name').fill('a'); await long.page.getByLabel('Contact (Discord or email)').fill('b'); await next(long.page);
  await long.page.getByLabel('Song and original artist').fill('s'); await long.page.getByLabel('Vocal and instrumental or karaoke files link').fill('https://a.example.com'); await next(long.page);
  await long.page.getByText('Full Production', { exact: true }).last().click();
  await long.page.getByText('Long', { exact: true }).last().click();
  check('studio: Long is by case', (await quote(long.page)).includes('Priced by case'));
  await shot(long.page, 'studio-5-long');
}

{
  const { page, sent } = await newPage(['ok']);
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
  check('endorse: payload', sent[0].kind === 'endorse' && sent[0].quote === null && sent[0].fields.channels === 'YouTube' && sent[0].fields.budget === '$300 – $700', JSON.stringify(sent[0]));
}

{
  const { page } = await newPage([]);
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

await browser.close();
writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
process.exit(results.every(r => r.ok) ? 0 : 1);
