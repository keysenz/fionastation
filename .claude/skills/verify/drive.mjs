#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.VERIFY_PORT ?? 3456}`;
const wanted = process.argv.slice(2);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(dirname(fileURLToPath(import.meta.url)), 'evidence', stamp);
mkdirSync(out, { recursive: true });

const results = [];
function check(feature, name, ok, detail = '') {
  results.push({ feature, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${feature}: ${name}${detail ? ` (${detail})` : ''}`);
}

const api = async (path, init) => {
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

const songRow = (page) => page.locator('div.rounded-lg.p-3', { has: page.locator('h4') });
const autoplaySwitch = (page) => page.getByRole('switch', { name: 'Autoplay' });
const barButton = (page, icon) => page.locator(`.fixed.bottom-0 button:has(i.${icon})`);
const playerSrc = (page) => page.locator('iframe[src*="youtube"]').first().getAttribute('src', { timeout: 30000 });

const step = async (feature, name, action) => {
  try {
    await action();
    check(feature, name, true);
  } catch (e) {
    check(feature, name, false, e.message.split('\n')[0]);
  }
};

const songRows = (videos) => videos.flatMap((v) => v.karaoke_song.map((song) => ({
  ...song, video_url: v.video_url, title_text: v.video_title, membership: v.membership, is_gone: v.is_gone,
})));

const waitForGoneIds = async () => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const { body: videos } = await api('/api/get-karaoke');
    if (videos?.some((v) => v.is_gone)) return videos.filter((v) => v.is_gone).length;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('the api reported no gone video within 120s');
};

const statusCache = new Map();
const videoStatus = async (videoUrl) => {
  if (!statusCache.has(videoUrl)) {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoUrl}`);
    statusCache.set(videoUrl, res.status);
  }
  return statusCache.get(videoUrl);
};

const isPublic = async (row) => !row.is_gone;

const findRowIndex = async (rows, matches, from = 0) => {
  for (let i = from; i < rows.length; i++) {
    if (await matches(rows[i], i)) return i;
  }
  throw new Error('no karaoke row matches');
};

// fetch normalizes paths, so this sends the request line exactly as written.
const rawRequest = (path, init = {}) => new Promise((resolve, reject) => {
  const { hostname, port } = new URL(BASE);
  http.request({ hostname, port, path, headers: init.headers ?? {} }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
  }).on('error', reject).end();
});

const playerReady = (page) => page.waitForFunction(() => {
  const frame = document.querySelector('iframe[src*="youtube"]');
  return frame && window.YT?.get(frame.id)?.getPlayerState;
}, null, { timeout: 30000 });
const playerState = (page, state) => page.waitForFunction((want) => {
  const frame = document.querySelector('iframe[src*="youtube"]');
  return window.YT.get(frame.id).getPlayerState() === want;
}, state, { timeout: 30000 });
const playVideo = (page) => page.evaluate(() => { const f = document.querySelector('iframe[src*="youtube"]'); window.YT.get(f.id).playVideo(); });
const seekNearEnd = (page) => page.evaluate(() => { const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id); p.seekTo(Math.max(0, p.getDuration() - 2), true); });

const journeys = {
  async site(page) {
    await page.goto(BASE + '/');
    await page.getByRole('heading', { name: /Fiona/ }).waitFor();
    const bg = page.getByAltText('Background');
    await bg.waitFor();
    const loaded = await bg.evaluate(async (img) => { await img.decode().catch(() => {}); return img.naturalWidth; });
    check('site', 'background image renders', loaded > 0, `naturalWidth ${loaded}`);
    await page.screenshot({ path: join(out, 'home.png') });
    for (const [label, heading] of [['About', 'Fiona Clearesta'], ['Credits', 'Credits']]) {
      await page.goto(BASE + '/');
      await page.getByRole('link', { name: label }).click();
      await page.getByRole('heading', { name: heading }).first().waitFor();
      check('site', `home menu opens ${label}`, true);
    }
    const headers = (await fetch(BASE + '/')).headers;
    check('site', 'security headers are served', headers.get('x-frame-options') === 'SAMEORIGIN');
  },

  async karaoke(page) {
    const { body: videos } = await api('/api/get-karaoke');
    const total = videos.reduce((n, v) => n + v.karaoke_song.length, 0);
    check('karaoke', 'api returns only karaoke streams with songs', total > 0, `${videos.length} videos, ${total} songs`);

    await page.goto(BASE + '/karaoke');
    await songRow(page).first().waitFor();
    check('karaoke', 'list shows every song', (await songRow(page).count()) === total, `${await songRow(page).count()} rows`);

    const rows = songRows(videos);
    const aIndex = await findRowIndex(rows, isPublic);
    const bIndex = await findRowIndex(rows, async (s) => (await isPublic(s)) && s.song_title !== rows[aIndex].song_title);
    const cIndex = await findRowIndex(rows, async (s) => (await isPublic(s)) && s.song_title !== rows[aIndex].song_title && s.song_title !== rows[bIndex].song_title);
    const [a, b, c] = [rows[aIndex], rows[bIndex], rows[cIndex]];
    const search = page.getByPlaceholder('Search songs...');
    await search.fill(a.song_title);
    await page.waitForFunction((n) => document.querySelectorAll('h4').length < n, total);
    check('karaoke', 'search narrows the list', await songRow(page).filter({ hasText: a.song_title }).first().isVisible(), a.song_title);
    await search.fill('zzzqqqxxx');
    await page.getByText('No songs found').waitFor();
    check('karaoke', 'search shows an empty state', true);
    await search.fill('');

    await songRow(page).nth(aIndex).click();
    const bar = page.locator('.fixed.bottom-0');
    await bar.getByRole('heading', { name: a.song_title }).waitFor();
    const src = await playerSrc(page);
    check('karaoke', 'play opens the player at the song timestamp', src.includes(a.video_url) && src.includes('start='), src.slice(0, 90));

    const row1 = songRow(page).nth(bIndex);
    await row1.hover();
    await row1.getByRole('button', { name: 'Add to Queue' }).click();
    await barButton(page, 'fa-step-forward').click();
    await bar.getByRole('heading', { name: b.song_title }).waitFor();
    check('karaoke', 'next plays the queued song', true, b.song_title);

    const row2 = songRow(page).nth(cIndex);
    await row2.hover();
    await row2.getByRole('button', { name: 'Add to Queue' }).click();
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    const drawer = page.getByRole('heading', { name: 'Up Next' }).locator('xpath=../..');
    await drawer.getByText(c.song_title).first().waitFor();
    check('karaoke', 'queue drawer lists the queued song', true, c.song_title);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, 'karaoke-queue.png') });

    await barButton(page, 'fa-step-backward').click();
    await bar.getByRole('heading', { name: a.song_title }).waitFor();
    await drawer.locator('div.group').first().getByText(b.song_title).waitFor();
    check('karaoke', 'previous returns to the earlier song and the song it left is first under Up Next', true, `${a.song_title} then ${b.song_title}`);
    await barButton(page, 'fa-step-forward').click();
    await bar.getByRole('heading', { name: b.song_title }).waitFor();
    check('karaoke', 'next plays the song previous kept', true, b.song_title);

    await page.reload();
    await songRow(page).first().waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage')).state);
    check('karaoke', 'queue and history survive a reload',
      stored.queue.some((s) => s.id === c.id) && stored.history.some((s) => s.id === a.id));
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await page.getByRole('heading', { name: 'Up Next' }).locator('xpath=../..').getByText(c.song_title).first().waitFor();
    check('karaoke', 'drawer shows the restored queue after reload', true);
  },

  async cover(page) {
    const { body: covers } = await api('/api/get-cover');
    check('cover', 'api returns covers and originals', covers.length > 0, `${covers.length} videos`);
    await page.goto(BASE + '/cover');
    await page.getByText(`${covers.length} Songs Loaded`).first().waitFor();
    const title = page.locator('h2.text-2xl');
    await title.filter({ hasText: covers[0].title }).waitFor();
    check('cover', 'opens on the newest video', (await playerSrc(page)).includes(covers[0].video_id), covers[0].video_id);

    await page.getByTitle('Next', { exact: true }).click();
    await title.filter({ hasText: covers[1].title }).waitFor();
    check('cover', 'next moves down the list', true, covers[1].title);
    await page.getByTitle('Previous').click();
    await page.getByTitle('Previous').click();
    await title.filter({ hasText: covers.at(-1).title }).waitFor();
    check('cover', 'previous wraps to the end of the list', true);

    const search = page.getByPlaceholder('Search covers...').first();
    await search.fill(covers[3].title);
    const hit = page.locator('button', { hasText: covers[3].title }).first();
    await hit.click();
    await title.filter({ hasText: covers[3].title }).waitFor();
    check('cover', 'playlist search selects a video', true, covers[3].title);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, 'cover.png') });
  },

  async player(page) {
    const { body: videos } = await api('/api/get-karaoke');
    const rows = songRows(videos);
    const start = await findRowIndex(rows.slice(0, -1), async (s, i) => (await isPublic(s)) && rows[i + 1].video_url === s.video_url);
    const nextRow = rows[start + 1];
    const lastIndex = await findRowIndex(rows, async (s, i) => (await isPublic(s)) && (i === rows.length - 1 || rows[i + 1].video_url !== s.video_url));
    const lastRow = rows[lastIndex];
    const otherFirsts = rows.filter((r, i) => !r.is_gone && r.video_url !== lastRow.video_url && rows.findIndex((x) => x.video_url === r.video_url) === i);
    if (!otherFirsts.length) throw new Error('no other live video to pick');

    await page.goto(BASE + '/karaoke');
    await songRow(page).first().waitFor();
    await songRow(page).nth(start).click();
    const bar = page.locator('.fixed.bottom-0');
    await bar.getByRole('heading', { name: rows[start].song_title }).waitFor();
    await playerReady(page);
    await page.evaluate(() => { window.__frame = document.querySelector('iframe[src*="youtube"]'); });

    await step('player', 'the autoplay switch shows on by default', async () => {
      await autoplaySwitch(page).waitFor();
      if ((await autoplaySwitch(page).getAttribute('aria-checked')) !== 'true') throw new Error('the switch is not on');
    });
    await step('player', 'the autoplay switch fits a 375px bar with a 40px touch target', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      const box = await autoplaySwitch(page).boundingBox();
      const expand = await barButton(page, 'fa-expand').boundingBox();
      await page.setViewportSize({ width: 1280, height: 800 });
      if (!box || box.height < 40 || box.x < 0 || box.x + box.width > 375) throw new Error(`switch box ${JSON.stringify(box)}`);
      if (!expand || box.x + box.width > expand.x) throw new Error('the switch overlaps the expand button');
    });
    await step('player', 'expand keeps the same video element', async () => {
      await barButton(page, 'fa-expand').click();
      await page.waitForFunction(() => window.__frame === document.querySelector('iframe[src*="youtube"]'));
      await page.screenshot({ path: join(out, 'player-expanded.png') });
      await page.locator('button:has(i.fa-chevron-down)').click();
    });
    await step('player', 'the pause button pauses the real video', async () => {
      await playVideo(page);
      await playerState(page, 1);
      await bar.locator('i.fa-pause').waitFor();
      await barButton(page, 'fa-pause').click();
      await playerState(page, 2);
    });
    await step('player', 'a play started inside the player reaches the bar', async () => {
      await playVideo(page);
      await bar.locator('i.fa-pause').waitFor({ timeout: 15000 });
    });
    await step('player', 'a pause started inside the player reaches the bar', async () => {
      await page.evaluate(() => { const f = document.querySelector('iframe[src*="youtube"]'); window.YT.get(f.id).pauseVideo(); });
      await bar.locator('i.fa-play').waitFor({ timeout: 15000 });
    });
    await step('player', 'video end moves on to the next song of the same video', async () => {
      await playVideo(page);
      await seekNearEnd(page);
      await page.waitForFunction(() => { const f = document.querySelector('iframe[src*="youtube"]'); return f && f !== window.__frame; }, null, { timeout: 40000 });
      await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();
      const seconds = nextRow.timestamp.split(':').reduce((t, part) => t * 60 + Number(part), 0);
      if (!(await playerSrc(page)).includes(`start=${seconds}`)) throw new Error(`player is not at start=${seconds}`);
    });
    check('player', 'only one player exists after moving on', (await page.locator('iframe[src*="youtube"]').count()) === 1);

    await step('player', 'the end of the last song of a video plays the first song of another live video', async () => {
      await songRow(page).nth(lastIndex).click();
      await bar.getByRole('heading', { name: lastRow.song_title }).waitFor();
      await playerReady(page);
      await page.evaluate(() => { window.__frame = document.querySelector('iframe[src*="youtube"]'); });
      await playVideo(page);
      await playerState(page, 1);
      await seekNearEnd(page);
      await page.waitForFunction(() => { const f = document.querySelector('iframe[src*="youtube"]'); return f && f !== window.__frame; }, null, { timeout: 40000 });
      const src = await playerSrc(page);
      const landed = otherFirsts.find((r) => src.includes(r.video_url));
      if (!landed) throw new Error(`player is on a video that is not another live one: ${src}`);
      const seconds = landed.timestamp.split(':').reduce((t, part) => t * 60 + Number(part), 0);
      if (!src.includes(`start=${seconds}`)) throw new Error(`player is not at the first song, start=${seconds}`);
      await bar.getByRole('heading', { name: landed.song_title }).waitFor();
    });
    await songRow(page).nth(start + 1).click();
    await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();

    await step('player', 'with autoplay off the video end keeps the same song, paused, in the same player', async () => {
      await page.evaluate(() => { window.__frame = document.querySelector('iframe[src*="youtube"]'); });
      await playerReady(page);
      await autoplaySwitch(page).click();
      if ((await autoplaySwitch(page).getAttribute('aria-checked')) !== 'false') throw new Error('the switch did not turn off');
      await playVideo(page);
      await playerState(page, 1);
      await seekNearEnd(page);
      await bar.locator('i.fa-play').waitFor({ timeout: 40000 });
      await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();
      if (!(await page.evaluate(() => window.__frame === document.querySelector('iframe[src*="youtube"]')))) throw new Error('a new iframe was created');
      if ((await page.locator('iframe[src*="youtube"]').count()) !== 1) throw new Error('more than one player');
    });
    await step('player', 'the off state survives a reload', async () => {
      await page.reload();
      await songRow(page).first().waitFor();
      if ((await page.evaluate(() => localStorage.getItem('karaoke-autoplay'))) !== 'false') throw new Error('nothing saved');
      await songRow(page).nth(start).click();
      await autoplaySwitch(page).waitFor();
      if ((await autoplaySwitch(page).getAttribute('aria-checked')) !== 'false') throw new Error('the switch came back on');
    });
    await step('player', 'a page with blocked storage still renders and defaults to autoplay on', async () => {
      const blockedTab = await page.context().newPage();
      await blockedTab.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
      });
      await blockedTab.goto(BASE + '/karaoke');
      await songRow(blockedTab).nth(start).click();
      await autoplaySwitch(blockedTab).waitFor();
      if ((await autoplaySwitch(blockedTab).getAttribute('aria-checked')) !== 'true') throw new Error('the switch is not on');
      await autoplaySwitch(blockedTab).click();
      if ((await autoplaySwitch(blockedTab).getAttribute('aria-checked')) !== 'false') throw new Error('the switch does not toggle');
      await blockedTab.close();
    });
  },

  async unavailable(page) {
    const { body: videos } = await api('/api/get-karaoke');
    const rows = songRows(videos);
    const goneIndex = rows.findIndex((r, i) => r.is_gone && rows.findIndex((x) => x.video_url === r.video_url) === i
      && rows.slice(i + 1).some((x) => !x.is_gone));
    if (goneIndex < 0) throw new Error('no gone song has a live song after it');
    const gone = rows[goneIndex];
    const liveIndex = rows.findIndex((r) => !r.is_gone);
    const live = rows[liveIndex];
    const liveFirsts = rows.filter((r, i) => !r.is_gone && r.video_url !== gone.video_url && rows.findIndex((x) => x.video_url === r.video_url) === i);
    const bar = page.locator('.fixed.bottom-0');
    const stepForward = barButton(page, 'fa-step-forward');

    await page.goto(BASE + '/karaoke');
    await songRow(page).first().waitFor();
    const goneRow = songRow(page).nth(goneIndex);
    await step('unavailable', 'a gone row shows Stream gone and offers no Add to Queue', async () => {
      await goneRow.getByText('Stream gone', { exact: true }).waitFor();
      await goneRow.hover();
      if (await goneRow.getByRole('button', { name: 'Add to Queue' }).count()) throw new Error('the gone row has an Add to Queue button');
      if ((await goneRow.getAttribute('aria-disabled')) !== 'true') throw new Error('the gone row is not aria-disabled');
      if ((await goneRow.locator('img').count()) !== 0) throw new Error('the gone row requests a thumbnail');
      await page.screenshot({ path: join(out, 'karaoke-gone-row.png') });
    });
    await step('unavailable', 'clicking a gone row changes nothing and opens no player', async () => {
      await goneRow.click();
      await page.waitForTimeout(1000);
      if (await stepForward.count()) throw new Error('a player bar appeared');
      if (await page.locator('iframe[src*="youtube"]').count()) throw new Error('a player was mounted');
    });

    await page.evaluate((song) => localStorage.setItem('karaoke-storage', JSON.stringify({
      state: { queue: [{ id: song.id, song_title: song.song_title, timestamp: song.timestamp, created_at: song.created_at, video_url: song.video_url, title_text: song.title_text, membership: song.membership }], history: [] },
      version: 0,
    })), gone);
    await page.reload();
    await songRow(page).first().waitFor();
    await songRow(page).nth(liveIndex).click();
    await bar.getByRole('heading', { name: live.song_title }).waitFor();
    await stepForward.click();
    const toast = page.getByRole('status');
    await step('unavailable', 'a queued gone song gives a toast that names it', async () => {
      await toast.getByText(gone.song_title, { exact: false }).waitFor({ timeout: 60000 });
      const text = await toast.innerText();
      if (!/its stream is gone|their streams are gone/.test(text)) throw new Error(`unexpected toast text: ${text}`);
      await page.screenshot({ path: join(out, 'karaoke-skip-toast.png') });
    });
    await step('unavailable', 'the toast fits a 375px phone with a 16px gutter', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      const box = await toast.boundingBox();
      if (!box || box.x < 16 - 1 || box.x + box.width > 375 - 16 + 1) throw new Error(`toast box ${JSON.stringify(box)}`);
      await page.setViewportSize({ width: 1280, height: 800 });
    });
    await step('unavailable', 'the player lands on the first song of a live video', async () => {
      await page.waitForFunction((urls) => urls.some((url) => document.querySelector('iframe[src*="youtube"]')?.src.includes(url)), liveFirsts.map((r) => r.video_url), { timeout: 60000 });
      const src = await playerSrc(page);
      const landed = liveFirsts.find((r) => src.includes(r.video_url));
      await bar.getByRole('heading', { name: landed.song_title }).waitFor({ timeout: 60000 });
      if ((await page.locator('iframe[src*="youtube"]').count()) !== 1) throw new Error('more than one player');
      if (await bar.getByText('This stream is gone').count()) throw new Error('the bar still shows the error');
    });
    await step('unavailable', 'the toast disappears on its own', () => toast.waitFor({ state: 'detached', timeout: 15000 }));
  },

  async coverPlayer(page) {
    const { body: covers } = await api('/api/get-cover');
    await page.goto(BASE + '/cover');
    const title = page.locator('h2.text-2xl');
    await title.filter({ hasText: covers[0].title }).waitFor();
    await playerReady(page);
    await page.getByTitle('Autoplay Next').click();
    await step('coverPlayer', 'autoplay moves on at video end', async () => {
      await playVideo(page);
      await playerState(page, 1);
      await seekNearEnd(page);
      await title.filter({ hasText: covers[1].title }).waitFor({ timeout: 40000 });
    });
  },

  async fetchFailure(page) {
    let blocked = true;
    await page.route('**/api/get-karaoke', (route) => (blocked ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
    await page.goto(BASE + '/karaoke');
    await step('fetchFailure', 'a failed fetch says so instead of showing an empty list', () => page.getByText('Could not load the karaoke archive').waitFor());
    blocked = false;
    await step('fetchFailure', 'try again recovers without a reload', async () => {
      await page.getByRole('button', { name: 'Try again' }).click();
      await songRow(page).first().waitFor();
    });
    await page.route('**/api/get-cover', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[{"nope":1}]' }));
    await page.goto(BASE + '/cover');
    await step('fetchFailure', 'data of the wrong shape is refused at the boundary', () => page.getByText('Could not load the covers').waitFor());
  },

  async storage(page, context) {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.setItem('karaoke-storage', 'not json'));
    await page.goto(BASE + '/karaoke');
    await songRow(page).first().waitFor();
    await step('storage', 'corrupt saved data starts with an empty queue', async () => {
      await page.getByRole('button', { name: 'Queue', exact: true }).click();
      await page.getByText('Queue is empty').first().waitFor();
    });
    await page.evaluate(() => localStorage.clear());

    const blockedTab = await context.newPage();
    await blockedTab.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    for (const [path, text] of [['/', 'Station'], ['/about', 'Fiona Clearesta'], ['/credits', 'Credits']]) {
      await blockedTab.goto(BASE + path);
      await step('storage', `${path} renders with storage blocked`, () => blockedTab.getByRole('heading', { name: text }).first().waitFor());
    }
    await blockedTab.goto(BASE + '/karaoke');
    await step('storage', 'karaoke works with storage blocked', async () => {
      const { body: blockedVideos } = await api('/api/get-karaoke');
      const blockedRows = songRows(blockedVideos);
      await songRow(blockedTab).nth(await findRowIndex(blockedRows, isPublic)).click();
      await blockedTab.locator('.fixed.bottom-0 h3').first().waitFor();
    });
    await blockedTab.close();

    const { body: videos } = await api('/api/get-karaoke');
    const rows = songRows(videos);
    const firstIndex = rows.findIndex((s) => !s.is_gone);
    const otherIndex = rows.findIndex((s) => !s.is_gone && s.song_title !== rows[firstIndex].song_title);
    const tabB = await context.newPage();
    await page.goto(BASE + '/');
    await tabB.goto(BASE + '/karaoke');
    await songRow(tabB).first().waitFor();
    await songRow(tabB).nth(firstIndex).hover();
    await songRow(tabB).nth(firstIndex).getByRole('button', { name: 'Add to Queue' }).click();
    await page.getByRole('link', { name: 'Karaoke' }).click();
    await songRow(page).first().waitFor();
    await songRow(page).nth(otherIndex).hover();
    await songRow(page).nth(otherIndex).getByRole('button', { name: 'Add to Queue' }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.length);
    check('storage', 'two tabs keep each other\'s queued songs', saved === 2, `${saved} saved`);
    await tabB.close();
  },

  async navigation(page) {
    await page.addInitScript(() => {
      window.__sounds = 0;
      const original = window.Audio.prototype.play;
      window.Audio.prototype.play = function play() { window.__sounds++; return original.call(this); };
    });
    await page.goto(BASE + '/cover');
    await page.locator('h2.text-2xl').waitFor();
    await page.getByRole('link', { name: 'Back to Home' }).click();
    await page.getByRole('heading', { name: 'Station' }).waitFor();
    check('navigation', 'back to home plays the sound and navigates', (await page.evaluate(() => window.__sounds)) === 1);
    await page.goBack();
    await page.locator('h2.text-2xl').waitFor();
    check('navigation', 'browser back returns to the page', page.url().endsWith('/cover'));
    await page.goto(BASE + '/nope');
    await step('navigation', 'an unknown path shows the 404 page', () => page.getByText('This page could not be found.').waitFor());
  },

  async paths() {
    const statusOf = async (path, init) => (await rawRequest(path, init)).status;
    for (const path of ['/nope', '/..%2f..%2fpackage.json', '/%E0%A4%A', '/%FF', '//', '/robots.txt/x.js', '/a%00.js']) {
      check('paths', `${path} answers 404`, (await statusOf(path)) === 404);
    }
    check('paths', 'the server survives those requests', (await statusOf('/')) === 200);
    const slash = await rawRequest('/about/');
    check('paths', 'a trailing slash redirects', slash.status === 308 && slash.headers.location === '/about', slash.headers.location);
    const offsite = await rawRequest('/.//evil.example/');
    check('paths', 'a redirect cannot leave the site', !String(offsite.headers.location).startsWith('//'), offsite.headers.location);
    const range = await rawRequest('/piosayang.mp3', { headers: { Range: 'bytes=0-1' } });
    check('paths', 'audio answers a range request', range.status === 206 && range.headers['content-range']?.startsWith('bytes 0-1/'));
    const first = await rawRequest('/api/get-karaoke');
    const again = await rawRequest('/api/get-karaoke', { headers: { 'If-None-Match': first.headers.etag } });
    check('paths', 'unchanged data answers 304', first.status === 200 && again.status === 304);
  },

  async mobile(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    const { body: covers } = await api('/api/get-cover');
    await page.goto(BASE + '/cover');
    await page.locator('h2.text-2xl').waitFor();
    await page.locator('header button').click();
    const drawer = page.locator('div.absolute.inset-0.md\\:hidden');
    await page.getByRole('heading', { name: 'Playlist' }).waitFor();
    await step('mobile', 'choosing a video closes the playlist and plays it', async () => {
      await drawer.locator('button', { hasText: covers[2].title }).first().click();
      await page.waitForFunction(() => document.querySelector('div.absolute.inset-0.translate-x-full'));
      await page.locator('h2.text-2xl').filter({ hasText: covers[2].title }).waitFor();
    });
  },

  async api() {
    for (const route of ['/api/get-karaoke', '/api/get-cover']) {
      check('api', `POST ${route} is rejected`, (await api(route, { method: 'POST' })).status === 405);
    }
    const { body: videos } = await api('/api/get-karaoke');
    const mismatches = [];
    for (const v of videos) {
      const status = await videoStatus(v.video_url);
      const expected = status === 200 ? false : [401, 403, 404].includes(status) ? true : undefined;
      if (expected !== undefined && v.is_gone !== expected) mismatches.push(`${v.video_url} oembed ${status} is_gone ${v.is_gone}`);
    }
    check('api', 'is_gone matches oEmbed for every video', mismatches.length === 0 && videos.every((v) => typeof v.is_gone === 'boolean'), mismatches.slice(0, 3).join(' | '));
    for (const route of ['/api/post-karaoke', '/api/update-cover', '/api/update-karaoke', '/api/webhook', '/input_video']) {
      check('api', `${route} no longer exists`, (await api(route, { method: 'GET' })).status === 404);
    }
  },
};

try {
  const count = await waitForGoneIds();
  check('setup', 'the server has learned which streams are gone', true, `${count} videos`);
} catch (e) {
  check('setup', 'the server has learned which streams are gone', false, e.message);
}
const browser = await chromium.launch();
for (const [name, journey] of Object.entries(journeys)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const logged = [];
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/youtube|google|doubleclick|fontawesome|ERR_|Failed to load resource/i.test(m.text() + m.location().url)) logged.push(`console: ${m.text()}`); });
  try {
    await journey(page, context);
  } catch (e) {
    check(name, 'journey completed', false, e.message.split('\n')[0]);
    await page.screenshot({ path: join(out, `${name}-failure.png`) }).catch(() => {});
  }
  check(name, 'no page errors', logged.length === 0, logged.slice(0, 3).join(' | ').slice(0, 400));
  await context.close();
}
await browser.close();

writeFileSync(join(out, 'results.json'), JSON.stringify({ base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed. evidence: ${out}`);
process.exit(failed ? 1 : 0);
