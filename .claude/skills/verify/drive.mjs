#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './ab.mjs';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.VERIFY_PORT ?? 3456}`;
const wanted = process.argv.slice(2);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(dirname(fileURLToPath(import.meta.url)), 'evidence', stamp);
mkdirSync(out, { recursive: true });

const sessions = new Set();
const makeSession = (label, options) => {
  const session = new Session(`fio-${process.pid}-${label}`, options);
  sessions.add(session);
  return session;
};

const blockedStorageScript = join(mkdtempSync(join(tmpdir(), 'verify-')), 'blocked-storage.js');
writeFileSync(blockedStorageScript, `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });`);
const blockedStoragePage = (label) => makeSession(`${label}-blocked`, { launchArgs: ['--init-script', blockedStorageScript] }).page();

const heldPlaylistScript = join(mkdtempSync(join(tmpdir(), 'verify-')), 'held-playlist.js');
writeFileSync(
  heldPlaylistScript,
  `(() => {
  const real = window.fetch.bind(window);
  let open;
  const gate = new Promise((resolve) => (open = resolve));
  window.__releasePlaylists = () => open();
  window.__heldPlaylists = 0;
  window.__arrivedPlaylists = 0;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!/\\/api\\/playlists\\/[A-Za-z0-9]{8}/.test(url)) return real(input, init);
    window.__heldPlaylists++;
    await gate;
    try {
      return await real(input, init);
    } finally {
      window.__arrivedPlaylists++;
    }
  };
})();`,
);

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const holdYoutubeApi = async (page) => {
  const real = await (await fetch('https://www.youtube.com/iframe_api')).text();
  await page.routeBody('**/iframe_api*', `(function () { var run = function () { (0, eval)(${JSON.stringify(real)}); }; if (window.__youtubeApiReleased) run(); else window.__releaseYoutubeApi = run; })();`);
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await page.unroute('**/iframe_api*');
      await page.evaluate(() => {
        window.__youtubeApiReleased = true;
        window.__releaseYoutubeApi?.();
      });
    },
  };
};

const results = [];
function check(feature, name, ok, detail = '') {
  results.push({ feature, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${feature}: ${name}${detail ? ` (${detail})` : ''}`);
}

const api = async (path, init) => {
  const res = await fetch(BASE + path, init);
  return {
    status: res.status,
    body: res.status === 200 ? await res.json() : null,
  };
};

// The page treats a members-only video as gone, because an embedded player cannot play it.
const pageVideos = async () => {
  const { status, body } = await api('/api/get-karaoke');
  return { status, body: body?.map((v) => ({ ...v, is_gone: v.is_gone || v.membership })) };
};

const STREAMS = 'nav[aria-label="Videos"]';
const SETLIST = 'section[aria-label^="Setlist of"]';
const videoRows = (page) => page.locator(`${STREAMS} li`);
const setlistOf = (page) => page.locator(SETLIST);
const songRowsIn = (setlist) => setlist.locator('ol > li');
const streamCountIs = (page, n) => page.waitForFunction(([sel, want]) => document.querySelectorAll(sel).length === want, [`${STREAMS} li`, n]);
const scrollListToTop = (page) =>
  page.evaluate(
    ([a, b]) =>
      document.querySelectorAll(`${a}, ${b}`).forEach((el) => {
        el.scrollTop = 0;
      }),
    [STREAMS, SETLIST],
  );
const showList = async (page) => {
  if (!(await page.locator(STREAMS).isVisible())) {
    await page.getByRole('button', { name: 'All videos' }).click();
    await page.locator(STREAMS).waitFor({ state: 'visible' });
  }
};
const queueDrawerOf = (page) => page.getByRole('heading', { name: 'Up Next' }).locator('xpath=../..');
const queueHandle = (page) => page.getByRole('button', { name: 'Queue', exact: true });
const autoplaySwitch = (page) => page.locator('[data-player-bar]').getByRole('switch', { name: 'Autoplay' });
const switchBecomes = (page, checked, message) =>
  page
    .locator(`[data-player-bar] [role="switch"][aria-label="Autoplay"][aria-checked="${checked}"]`)
    .waitFor({ timeout: 5000 })
    .catch(() => {
      throw new Error(message);
    });
const barButton = (page, icon) => page.locator(`[data-player-bar] button:not([role="switch"]):has(i.${icon})`);

let failedSteps = 0;
const step = async (feature, name, action, page) => {
  try {
    await action();
    check(feature, name, true);
  } catch (e) {
    check(feature, name, false, e.message.split('\n')[0]);
    if (page) await page.screenshot({ path: join(out, `${feature}-step-${++failedSteps}-failure.png`) }).catch(() => {});
  }
};

const songRows = (videos) =>
  videos.flatMap((v) =>
    v.karaoke_song.map((song) => ({
      ...song,
      video_url: v.video_url,
      title_text: v.video_title,
      membership: v.membership,
      is_gone: v.is_gone,
    })),
  );

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

const displayOrder = (videos) => [...videos.filter((v) => !v.is_gone), ...videos.filter((v) => v.is_gone)];
const videoRow = (page, videos, videoUrl) => videoRows(page).nth(displayOrder(videos).findIndex((v) => v.video_url === videoUrl));
// NOTE: opening a video scrolls its setlist to the top a moment later, which would move a row between aiming and clicking.
const scrollSettled = (page) =>
  page.waitForFunction(
    () => {
      const offsets = JSON.stringify([scrollY, ...[...document.querySelectorAll('*')].filter((el) => el.scrollTop > 0).map((el) => el.scrollTop)]);
      const settled = window.__scrollOffsets === offsets;
      window.__scrollOffsets = offsets;
      return settled;
    },
    null,
    { polling: 150 },
  );
const openVideo = async (page, videos, videoUrl) => {
  await showList(page);
  const button = videoRow(page, videos, videoUrl).locator('button').first();
  await button.click();
  await button.and(page.locator('[aria-current="true"]')).waitFor({ state: 'attached' });
  await setlistOf(page).waitFor({ state: 'visible' });
  await scrollSettled(page);
  return setlistOf(page);
};
const isSingleSong = (videos, videoUrl) => {
  const video = videos.find((v) => v.video_url === videoUrl);
  return video.karaoke_song.length === 1 && !video.is_gone;
};
const songRowOf = async (page, videos, row) => {
  if (isSingleSong(videos, row.video_url)) {
    await showList(page);
    return videoRow(page, videos, row.video_url);
  }
  const section = await openVideo(page, videos, row.video_url);
  const position = videos.find((v) => v.video_url === row.video_url).karaoke_song.findIndex((s) => s.id === row.id);
  return songRowsIn(section).nth(position);
};
const matches = (q) => (text) => text.toLowerCase().includes(q.toLowerCase());
const expectedPerVideo = (videos, q) => {
  const hit = matches(q);
  return displayOrder(videos)
    .map((video) => ({
      video,
      matching: video.karaoke_song.filter((s) => hit(s.song_title) || hit(video.video_title)).length,
    }))
    .filter((x) => x.matching > 0);
};
const expectedFor = (videos, q) => {
  const found = expectedPerVideo(videos, q);
  return {
    videos: found.length,
    songs: found.reduce((n, x) => n + x.matching, 0),
  };
};
const titleOnMostLiveVideos = (rows) => {
  const byTitle = new Map();
  for (const r of rows) {
    if (!r.is_gone) byTitle.set(r.song_title, (byTitle.get(r.song_title) ?? new Set()).add(r.video_url));
  }
  return [...byTitle].sort((x, y) => y[1].size - x[1].size)[0][0];
};

const findRowIndex = async (rows, matches, from = 0) => {
  for (let i = from; i < rows.length; i++) {
    if (await matches(rows[i], i)) return i;
  }
  throw new Error('no karaoke row matches');
};

// fetch normalizes paths, so this sends the request line exactly as written.
const rawRequest = (path, init = {}) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(BASE);
    http
      .request({ hostname, port, path, headers: init.headers ?? {} }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      })
      .on('error', reject)
      .end();
  });

const playerReady = (page) =>
  page.waitForFunction(
    () => {
      const frame = document.querySelector('iframe[src*="youtube"]');
      return frame && window.YT?.get(frame.id)?.getPlayerState;
    },
    null,
    { timeout: 30000 },
  );
const playerState = (page, state) =>
  page.waitForFunction(
    (want) => {
      const frame = document.querySelector('iframe[src*="youtube"]');
      return window.YT.get(frame.id).getPlayerState() === want;
    },
    state,
    { timeout: 30000 },
  );
const playVideo = (page) =>
  page.evaluate(() => {
    const f = document.querySelector('iframe[src*="youtube"]');
    window.YT.get(f.id).playVideo();
  });
const seekNearEnd = (page) =>
  page.waitForFunction(
    () => {
      const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id);
      const duration = p.getDuration();
      if (p.getPlayerState() === 0 || (duration > 0 && p.getCurrentTime() >= duration - 5)) return true;
      if (duration > 0) p.seekTo(duration - 2, true);
      return false;
    },
    null,
    { polling: 1000, timeout: 30000 },
  );

const secondsOf = (timestamp) => timestamp.split(':').reduce((t, part) => t * 60 + Number(part), 0);
const loadedVideoId = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector('iframe[src*="youtube"]');
    return (frame && window.YT?.get?.(frame.id)?.getVideoData?.()?.video_id) ?? null;
  });
const videoLoads = (page, videoIds, { startSeconds, isPlaying = false, timeout = 30000 } = {}) =>
  page
    .waitForFunction(
      ([ids, start, playing]) => {
        const frame = document.querySelector('iframe[src*="youtube"]');
        const p = frame && window.YT?.get?.(frame.id);
        if (!ids.includes(p?.getVideoData?.()?.video_id)) return false;
        const t = p.getCurrentTime();
        if (start !== null && !(t >= start - 1 && t < start + 15)) return false;
        return !playing || p.getPlayerState() === 1;
      },
      [videoIds, startSeconds ?? null, isPlaying],
      { timeout },
    )
    .catch(async () => {
      const seen = await page.evaluate(() => {
        const frame = document.querySelector('iframe[src*="youtube"]');
        const p = frame && window.YT?.get?.(frame.id);
        return p?.getVideoData ? { videoId: p.getVideoData()?.video_id, seconds: p.getCurrentTime(), state: p.getPlayerState() } : 'no player';
      });
      throw new Error(`wanted ${videoIds.join('|')}${startSeconds === undefined ? '' : ` at ${startSeconds}s`}${isPlaying ? ' playing' : ''}, saw ${JSON.stringify(seen)}`);
    });

const queueReorderJourney = async (page, feature, { touch }) => {
  const { body: videos } = await pageVideos();
  const picked = [];
  const video = videos.find((v) => {
    picked.length = 0;
    if (v.is_gone) return false;
    for (const song of songRows([v])) {
      if (!picked.some((p) => p.song_title === song.song_title)) picked.push(song);
    }
    picked.splice(3);
    return picked.length === 3;
  });
  if (!video) throw new Error('no live video with three songs of distinct titles');
  const [a, b, c] = picked;
  const grips = (drawer) => drawer.getByRole('button', { name: /^Move "/ });
  const orderIs = async (drawer, expected) => {
    const want = expected.map((r) => r.song_title).join('|');
    let got = '';
    for (const deadline = Date.now() + 3000; Date.now() < deadline; await page.waitForTimeout(100)) {
      got = (await grips(drawer).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label').slice(6, -1)))).join('|');
      if (got === want) return;
    }
    throw new Error(`drawer order is ${got.split('|').join(' | ')}`);
  };
  const savedOrder = () => page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.map((s) => s.song_title));
  const centerOf = async (locator) => {
    const box = await locator.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const finger = touch ? await page.touch() : undefined;
  const touchEvent = (type, point) => finger.send(type, point);
  const dragGrip = async (drawer, fromIndex, toIndex, shotName) => {
    const start = await centerOf(grips(drawer).nth(fromIndex));
    const end = await centerOf(grips(drawer).nth(toIndex).locator('xpath=..'));
    const at = (t) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    if (touch) await touchEvent('touchStart', start);
    else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
    }
    for (let i = 1; i <= 8; i++) {
      if (touch) await touchEvent('touchMove', at(i / 8));
      else await page.mouse.move(at(i / 8).x, at(i / 8).y);
    }
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, shotName) });
    if (touch) await touchEvent('touchEnd');
    else await page.mouse.up();
  };

  await page.goto(BASE + '/');
  await videoRows(page).first().waitFor();
  const section = await openVideo(page, videos, video.video_url);
  for (const row of [a, b, c]) {
    await songRowsIn(section).nth(video.karaoke_song.findIndex((s) => s.id === row.id)).getByRole('button', { name: 'Add to Queue', exact: true }).click();
  }
  await queueHandle(page).click();
  const drawer = queueDrawerOf(page);
  await grips(drawer).nth(2).waitFor();
  await page.waitForTimeout(400);
  const scroller = drawer.locator('.overflow-y-auto');
  await step(feature, 'the drawer lists the queued songs in the order they were added, each with a grip handle that blocks touch scrolling', async () => {
    await orderIs(drawer, [a, b, c]);
    const touchAction = await grips(drawer).first().evaluate((el) => getComputedStyle(el).touchAction);
    if (touchAction !== 'none') throw new Error(`touch-action is ${touchAction}`);
  });
  await step(feature, `${touch ? 'a finger' : 'the mouse'} dragging the first handle onto the third row moves it to the end and saves the order`, async () => {
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
    await dragGrip(drawer, 0, 2, touch ? 'queue-reorder-touch-mid-drag.png' : 'queue-reorder-mid-drag.png');
    await orderIs(drawer, [b, c, a]);
    const saved = await savedOrder();
    if (saved.join('|') !== [b, c, a].map((r) => r.song_title).join('|')) throw new Error(`saved ${saved.join(' | ')}`);
    if ((await scroller.evaluate((el) => el.scrollTop)) !== scrollBefore) throw new Error('the drawer scrolled during the drag');
    await page.screenshot({ path: join(out, touch ? 'queue-reorder-touch-dropped.png' : 'queue-reorder-dropped.png') });
  });
  await step(feature, 'releasing a drag outside the rows leaves the order alone', async () => {
    const start = await centerOf(grips(drawer).nth(0));
    if (touch) {
      await touchEvent('touchStart', start);
      await touchEvent('touchMove', { x: start.x, y: 5 });
      await touchEvent('touchEnd');
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, 5, { steps: 4 });
      await page.mouse.up();
    }
    await page.waitForTimeout(200);
    await orderIs(drawer, [b, c, a]);
  });
  await step(feature, 'the grip handle moves a song with the arrow keys and keeps focus on it', async () => {
    await grips(drawer).nth(1).focus();
    await page.keyboard.press('ArrowUp');
    await orderIs(drawer, [c, b, a]);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    if (focused !== `Move "${c.song_title}"`) throw new Error(`focus is on ${focused}`);
    await page.keyboard.press('ArrowUp');
    await orderIs(drawer, [c, b, a]);
    await page.keyboard.press('ArrowDown');
    await orderIs(drawer, [b, c, a]);
  });
  await step(feature, 'the new order survives a reload', async () => {
    await page.reload();
    await queueHandle(page).waitFor();
    await queueHandle(page).click();
    await grips(queueDrawerOf(page)).nth(2).waitFor();
    await orderIs(queueDrawerOf(page), [b, c, a]);
  });
  finger?.close();
};



const PLAYLISTS_DB_PATH = process.env.PLAYLISTS_DB_PATH ?? readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.run', 'playlists.path'), 'utf8').trim();
const TOAST = '[data-toast]';
const choiceButton = (page, choice) => page.locator(`[data-playlist-choice="${choice}"]`);
const pathOf = async (page) => new URL(await page.url()).pathname;

const playable = (video, song) => ({
  ...song,
  video_url: video.video_url,
  title_text: video.video_title,
  membership: video.membership,
  published_at: video.published_at,
  kind: video.kind,
});

const livePlayables = async () => {
  const { body: videos } = await pageVideos();
  return videos.filter((v) => !v.is_gone).flatMap((v) => v.karaoke_song.map((song) => playable(v, song)));
};

const createPlaylist = async (name, songs) => {
  const res = await fetch(`${BASE}/api/playlists`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, songIds: songs.map((song) => song.id) }),
  });
  if (res.status !== 201) throw new Error(`creating the playlist answered ${res.status}`);
  return res.json();
};

const deletePlaylist = async ({ id, editToken }) => {
  const res = await fetch(`${BASE}/api/playlists/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${editToken}` } });
  if (res.status !== 200 && res.status !== 204) throw new Error(`deleting the playlist answered ${res.status}`);
};

const setSavedQueue = (page, songs) =>
  page.evaluate((queue) => localStorage.setItem('karaoke-storage', JSON.stringify({ state: { queue, history: [] }, version: 0 })), songs);
const savedQueueIds = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage') ?? '{"state":{"queue":[]}}').state.queue.map((s) => s.id));
const barTitle = (page) => page.locator('[data-player-bar] h3').first().innerText();
const waitForBarSong = (page, song) =>
  page.waitForFunction((title) => document.querySelector('[data-player-bar] h3')?.textContent?.includes(title), song.song_title);
const distinctByTitle = (songs, count) => {
  const seen = new Set();
  return songs.filter((song) => !seen.has(song.song_title) && seen.add(song.song_title)).slice(0, count);
};
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const dialogButton = (page, action) => page.locator(`[data-playlist-dialog] [data-playlist-action="${action}"]`);
const playlistAction = (page, action) => page.locator(`[data-playlist-bar] [data-playlist-action="${action}"]`);
const sourceButton = (page, source) => page.locator(`[data-playlist-source="${source}"]`);
const openSaveDialog = async (page) => {
  await page.locator('[data-playlist-action="Save"]').click();
  await page.locator('[data-playlist-dialog="Editing"]').waitFor();
};
const sharedLink = async (page) => {
  await page.locator('[data-playlist-dialog="Shared"]').waitFor();
  return page.locator('[data-playlist-link="View"] .select-all').innerText();
};
const saveFrom = async (page, source, name) => {
  await sourceButton(page, source).click();
  await page.locator('[data-playlist-field="name"]').fill(name);
  await dialogButton(page, 'Submit').click();
  const link = await sharedLink(page);
  const editLink = await page.locator('[data-playlist-link="Edit"] .select-all').innerText();
  return { id: link.split('/p/')[1], link, editLink };
};
const storedIds = async (id) => {
  const body = await (await fetch(`${BASE}/api/playlists/${id}`)).json();
  return body.entries.map((entry) => entry.songId);
};
const rename = async (page, name) => {
  await playlistAction(page, 'Rename').click();
  await page.locator('[data-playlist-field="name"]').fill(name);
  await dialogButton(page, 'Submit').click();
  await page.locator('[data-toast="PlaylistUpdated"]').waitFor();
};
const seedSession = (page, history, queue) =>
  page.evaluate(([h, q]) => localStorage.setItem('karaoke-storage', JSON.stringify({ state: { queue: q, history: h }, version: 0 })), [history, queue]);
const fitsPhone = async (page) => {
  if (!(await noSidewaysScroll(page))) throw new Error('the page scrolls sideways');
  const box = await page.locator('[data-playlist-dialog], [data-playlist-bar]').first().boundingBox();
  if (box.x < 0 || box.x + box.width > 375) throw new Error(JSON.stringify(box));
};
const expectId = (id) => {
  if (!/^[0-9A-Za-z]{8}$/.test(id)) throw new Error(`odd id ${id}`);
};

const RUN_DIR = join(dirname(fileURLToPath(import.meta.url)), '.run');
const FAKE_USER = { id: '100000000000000001', name: 'Fake Fan' };
const OTHER_USER = { id: '100000000000000002', name: 'User B' };

const waitUntilUp = async (url, ok) => {
  for (let i = 0; i < 90; i++) {
    const res = await fetch(url).catch(() => null);
    if (res && ok(res)) return;
    await sleepMs(1000);
  }
  throw new Error(`${url} did not come up`);
};

const startDiscordStack = async (extraEnv = {}) => {
  const first = Number(process.env.VERIFY_PORT ?? 3456) + 1;
  const [serverPort, fakePort, adminPort] = [first, first + 1, first + 2];
  const base = `http://127.0.0.1:${serverPort}`;
  const fake = `http://127.0.0.1:${fakePort}`;
  const admin = `http://127.0.0.1:${adminPort}`;
  const secret = 'verify-admin-secret';
  const credentials = { DISCORD_CLIENT_ID: 'fake-client', DISCORD_CLIENT_SECRET: 'fake-secret' };
  const children = [];
  const close = () => children.forEach((child) => child.kill());
  try {
    children.push(
      spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'fake-discord.mjs')], {
        env: { ...process.env, ...credentials, FAKE_DISCORD_PORT: String(fakePort) },
        stdio: 'ignore',
      }),
    );
    children.push(
      spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/main.ts'], {
        cwd: join(dirname(fileURLToPath(import.meta.url)), '../../..'),
        env: {
          ...process.env,
          ...credentials,
          PORT: String(serverPort),
          HOSTNAME: '127.0.0.1',
          PLAYLISTS_DB_PATH: join(mkdtempSync(join(tmpdir(), 'verify-discord-')), 'p.db'),
          PLAYLISTS_IP_LIMIT_PER_HOUR: '1000',
          DATABASE_PATH: join(RUN_DIR, 'karaoke.db'),
          DISCORD_API_BASE: fake,
          SITE_ORIGIN: base,
          ADMIN_SECRET: secret,
          ADMIN_PORT: String(adminPort),
          ...extraEnv,
        },
        stdio: 'ignore',
      }),
    );
    await waitUntilUp(`${fake}/nothing`, () => true);
    await waitUntilUp(`${base}/api/get-karaoke`, (res) => res.ok);
  } catch (e) {
    close();
    throw e;
  }
  const actAs = async (user) => {
    await fetch(`${fake}/fake/as?id=${user.id}&name=${encodeURIComponent(user.name)}`);
  };
  const refuseCodes = (on) => fetch(`${fake}/fake/refuse?on=${on ? 1 : 0}`);
  const createAs = async (user, name, songs) => {
    const res = await fetch(`${admin}/admin/owner/playlists`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-acting-discord-id': user.id, 'content-type': 'application/json' },
      body: JSON.stringify({ name, songIds: songs.map((song) => song.id) }),
    });
    if (res.status !== 201) throw new Error(`the owner route answered ${res.status}`);
    return res.json();
  };
  return { base, close, actAs, refuseCodes, createAs };
};

const myPlaylistsButton = (page) => page.locator('[data-playlist-action="Mine"]');
const accountPanel = (page, state) => page.locator(`[data-playlist-dialog="Account"] [data-account="${state}"]`);
const accountDialogAction = (page, action) => page.locator(`[data-playlist-dialog="Account"] [data-playlist-action="${action}"]`);
const openMyPlaylists = async (page) => {
  await myPlaylistsButton(page).click();
  await page.locator('[data-playlist-dialog="Account"]').waitFor();
};
const listedIds = (page) => page.locator('[data-my-playlist]').evaluateAll((links) => links.map((link) => link.getAttribute('data-my-playlist')));
const listedIdsEventually = async (page, want) => {
  await page.waitForFunction(
    (ids) => {
      const shown = [...document.querySelectorAll('[data-my-playlist]')].map((link) => link.getAttribute('data-my-playlist'));
      return ids.every((id) => shown.includes(id));
    },
    want,
  );
  return listedIds(page);
};

const connectDiscord = async (page, base) => {
  await openMyPlaylists(page);
  await accountDialogAction(page, 'Connect').click();
  await page.waitForFunction((root) => location.href === `${root}/`, base);
  await myPlaylistsButton(page).waitFor();
  await openMyPlaylists(page);
  await accountPanel(page, 'Connected').waitFor();
};

const startedSession = async (label, base, songs, options) => {
  const page = options?.blocked ? blockedStoragePage(label) : makeSession(label, options).page();
  await page.goto(base + '/');
  if (songs) await setSavedQueue(page, songs);
  await page.goto(base + '/');
  await page.locator('[data-playlist-action="Save"]').waitFor();
  return page;
};

const saveQueueAs = async (page, name) => {
  await openSaveDialog(page);
  const saved = await saveFrom(page, 'Queue', name);
  await dialogButton(page, 'Done').click();
  return saved;
};

const openFromList = async (page, id) => {
  await page.locator(`[data-my-playlist="${id}"]`).click();
  const replace = page.locator('[data-playlist-choice="Replace"]');
  await page.waitForFunction(() => document.querySelector('[data-playlist-bar], [data-playlist-choice="Replace"]'));
  if (await replace.isVisible()) await replace.click();
  await page.locator('[data-playlist-bar]').waitFor();
};

const barKind = (page) => page.locator('[data-playlist-bar]').getAttribute('data-playlist-bar');

const STATS_MOD = { id: '244661517356761089', name: 'Mod Person' };
const STATS_FIONA = { id: '927090060480905276', name: 'Fiona' };
const STATS_STRANGER = { id: '111111111111111111', name: 'Stranger' };

const seedStats = async (path, songs) => {
  const { openStatStore } = await import('../../../server/stats.ts');
  const [first, second] = songs;
  const daysAgo = (days) => new Date(Date.now() - days * 86400000);
  const at = (days) => openStatStore({ path, now: () => daysAgo(days) });
  const today = at(0);
  const repeat = (times, event) => Array.from({ length: times }, () => event);
  [
    ...repeat(3, { kind: 'Click', songId: first.id, origin: 'Visitor' }),
    ...repeat(5, { kind: 'Play', songId: first.id, origin: 'Visitor' }),
    ...repeat(2, { kind: 'Play', songId: first.id, origin: 'Autoplay' }),
    ...repeat(2, { kind: 'Finish', songId: first.id, origin: 'Visitor' }),
    { kind: 'Play', songId: second.id, origin: 'Visitor' },
    { kind: 'Skip', songId: first.id, origin: 'Visitor', secondsIntoSong: 12 },
    { kind: 'Skip', songId: first.id, origin: 'Visitor', secondsIntoSong: 14 },
    { kind: 'Skip', songId: first.id, origin: 'Visitor', secondsIntoSong: 95 },
  ].forEach((event) => today.record(event));
  const tenAgo = at(10);
  repeat(4, { kind: 'Play', songId: first.id, origin: 'Visitor' }).forEach((event) => tenAgo.record(event));
  tenAgo.record({ kind: 'Skip', songId: first.id, origin: 'Visitor', secondsIntoSong: 200 });
  const fortyAgo = at(40);
  repeat(10, { kind: 'Play', songId: second.id, origin: 'Visitor' }).forEach((event) => fortyAgo.record(event));
};

const journeys = {
  async statsPage(page, context) {
    const f = 'stats-page';
    const [first, second] = distinctByTitle(await livePlayables(), 2);
    const statsPath = join(mkdtempSync(join(tmpdir(), 'verify-stats-')), 'stats.db');
    await seedStats(statsPath, [first, second]);
    const stack = await startDiscordStack({ STATS_DB_PATH: statsPath, STATS_USER_IDS: `${STATS_MOD.id},${STATS_FIONA.id}` });
    const tile = (key) => page.locator(`[data-tile="${key}"] [data-value]`).innerText();
    const shows = async (key, want) => {
      await page.waitForFunction(([k, w]) => document.querySelector(`[data-tile="${k}"] [data-value]`)?.textContent === w, [key, want]);
    };
    const signInAs = async (user) => {
      await stack.actAs(user);
      await page.goto(stack.base + '/stats');
      await page.locator('[data-action="sign-in"]').click();
      await page.waitForFunction(() => location.pathname === '/stats');
    };
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await step(f, 'a signed-out visitor sees only the sign-in screen and no numbers', async () => {
        await page.goto(stack.base + '/stats');
        await page.locator('[data-action="sign-in"]').waitFor();
        if ((await page.locator('[data-tile]').count()) !== 0) throw new Error('tiles shown while signed out');
        const direct = await page.evaluate(() => fetch('/api/stats-page/report').then((res) => res.status));
        if (direct !== 401) throw new Error(`report answered ${direct}`);
        await page.screenshot({ path: join(out, 'stats-signed-out.png') });
      }, page);
      await step(f, 'signing in as a listed moderator returns to /stats and shows the seeded numbers', async () => {
        await signInAs(STATS_MOD);
        await shows('plays', '8');
        if ((await tile('share')) !== '75%') throw new Error(`share ${await tile('share')}`);
        if ((await tile('finishes')) !== '2') throw new Error(`finishes ${await tile('finishes')}`);
        if ((await tile('skips')) !== '3') throw new Error(`skips ${await tile('skips')}`);
        if ((await tile('finish-rate')) !== '25%') throw new Error(`rate ${await tile('finish-rate')}`);
        const user = await page.locator('[data-user]').innerText();
        if (user !== STATS_MOD.name) throw new Error(user);
        await page.screenshot({ path: join(out, 'stats-dashboard-desktop.png'), fullPage: true });
      }, page);
      await step(f, 'the range picker changes the numbers', async () => {
        for (const [days, plays] of [['30', '12'], ['90', '22'], ['1', '8']]) {
          await page.locator(`[data-range="${days}"]`).click();
          await page.waitForFunction((d) => document.querySelector(`[data-range="${d}"]`)?.getAttribute('aria-pressed') === 'true', days);
          await shows('plays', plays);
        }
        await page.locator('[data-range="90"]').click();
        await shows('plays', '22');
        await page.screenshot({ path: join(out, 'stats-dashboard-90d.png'), fullPage: true });
      }, page);
      await step(f, 'the daily chart has a bar group for each UTC day and the table lists the seeded songs', async () => {
        const days = await page.locator('[data-chart="daily"] [data-day]').count();
        if (days !== 90) throw new Error(`${days} days`);
        const rows = await page.locator('[data-table="songs"] tbody tr').count();
        if (rows !== 2) throw new Error(`${rows} song rows`);
        const videos = await page.locator('[data-table="videos"] tbody tr').count();
        if (videos < 1) throw new Error('no video rows');
      }, page);
      await step(f, 'picking a song narrows the skip histogram and sorting reorders the table', async () => {
        const all = await page.locator('[data-skip-total]').getAttribute('data-skip-total');
        if (all !== '4') throw new Error(`all songs ${all}`);
        await page.locator(`[data-pick="${first.id}"]`).first().click();
        await page.waitForFunction(() => document.querySelector('[data-skip-total]')?.getAttribute('data-skip-total') === '4');
        await page.locator(`[data-pick="${second.id}"]`).first().click();
        await page.waitForFunction(() => document.querySelector('[data-skip-total]')?.getAttribute('data-skip-total') === '0');
        await page.locator('[data-sort="title"]').click();
        await page.locator('[data-sort="title"]').click();
        await page.screenshot({ path: join(out, 'stats-histogram-one-song.png'), fullPage: true });
      }, page);
      await step(f, 'a phone has no sideways scroll', async () => {
        await page.setViewportSize({ width: 375, height: 667 });
        await shows('plays', '22');
        if (!(await noSidewaysScroll(page))) throw new Error('the page scrolls sideways');
        await page.screenshot({ path: join(out, 'stats-dashboard-phone.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 800 });
      }, page);
      await step(f, 'logout returns to the sign-in screen and the report is closed again', async () => {
        await page.locator('[data-action="logout"]').click();
        await page.locator('[data-action="sign-in"]').waitFor();
        const direct = await page.evaluate(() => fetch('/api/stats-page/report').then((res) => res.status));
        if (direct !== 401) throw new Error(`report answered ${direct}`);
      }, page);
      await step(f, 'a signed-in person who is not listed sees no access and no numbers', async () => {
        await signInAs(STATS_STRANGER);
        await page.getByRole('heading', { name: 'No access' }).waitFor();
        if ((await page.locator('[data-tile]').count()) !== 0) throw new Error('tiles shown without access');
        const direct = await page.evaluate(() => fetch('/api/stats-page/report').then((res) => res.status));
        if (direct !== 403) throw new Error(`report answered ${direct}`);
        await page.screenshot({ path: join(out, 'stats-no-access.png') });
        await page.locator('[data-action="logout"]').click();
        await page.locator('[data-action="sign-in"]').waitFor();
      }, page);
      await step(f, 'Fiona, listed by user id, gets in', async () => {
        await signInAs(STATS_FIONA);
        await shows('plays', '8');
        await page.locator('[data-action="logout"]').click();
        await page.locator('[data-action="sign-in"]').waitFor();
      }, page);
      await step(f, 'an off-site return path is ignored and the login lands on the home page', async () => {
        await stack.actAs(STATS_MOD);
        await page.goto(stack.base + '/api/auth/discord/start?return=' + encodeURIComponent('https://evil.test/'));
        await page.waitForFunction(() => location.pathname === '/');
        if (new URL(await page.url()).origin !== stack.base) throw new Error(await page.url());
      }, page);
    } finally {
      stack.close();
    }
  },

  async site(page) {
    await page.goto(BASE + '/');
    await page.getByRole('heading', { name: 'Fio Radio' }).waitFor();
    const bg = page.getByAltText('Background');
    await bg.waitFor();
    const loaded = await bg.evaluate(async (img) => {
      await img.decode().catch(() => {});
      return img.naturalWidth;
    });
    check('site', 'background image renders', loaded > 0, `naturalWidth ${loaded}`);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        failed: [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight}`),
        solid: document.fonts.check('900 16px "Font Awesome 6 Free"'),
      };
    });
    check('site', 'icon fonts load', fonts.solid && fonts.failed.length === 0, JSON.stringify(fonts));
    const headers = (await fetch(BASE + '/')).headers;
    check('site', 'security headers are served', headers.get('x-frame-options') === 'SAMEORIGIN');
  },

  async radio(page) {
    const { body: videos } = await pageVideos();
    const live = (kind) => videos.find((v) => v.kind === kind && !v.is_gone && v.karaoke_song.length === 1);
    const cover = live('cover');
    const original = live('original');
    if (!cover || !original) throw new Error('the data has no live cover and original');

    await page.goto(BASE + '/karaoke?x=1');
    await page.waitForURL(BASE + '/?x=1');
    check('radio', '/karaoke lands on / in the browser', true);
    await page.getByRole('heading', { name: 'Fio Radio' }).waitFor();
    await videoRows(page).first().waitFor();
    check('radio', 'the badge counts every video', (await page.locator(`${STREAMS} > p`).first().innerText()).toLowerCase() === `${videos.length} videos`, `${videos.length} videos`);
    const wanted = (kind) => videos.filter((v) => v.kind === kind).length;
    for (const [kind, label] of [['cover', 'Cover'], ['original', 'Original']]) {
      const pills = await videoRows(page).getByText(label, { exact: true }).count();
      check('radio', `the list has a ${label} row for each ${kind} video`, pills === wanted(kind) && pills > 0, `${pills} rows`);
    }
    await page.screenshot({ path: join(out, 'radio-list.png') });

    const coverRow = await songRowOf(page, videos, { ...cover.karaoke_song[0], video_url: cover.video_url });
    await coverRow.click();
    const bar = page.locator('[data-player-bar]');
    await bar.getByRole('heading', { name: cover.karaoke_song[0].song_title }).waitFor();
    await bar.getByText('Cover', { exact: true }).first().waitFor();
    await step('radio', 'playing a cover shows Cover in the bar and loads its video', () => videoLoads(page, [cover.video_url]));
    await page.screenshot({ path: join(out, 'radio-cover-playing.png') });

    const originalRow = await songRowOf(page, videos, { ...original.karaoke_song[0], video_url: original.video_url });
    await originalRow.getByRole('button', { name: 'Add to Queue', exact: true }).click();
    await queueHandle(page).click();
    const drawer = queueDrawerOf(page);
    await drawer.getByText(original.karaoke_song[0].song_title).first().waitFor();
    await drawer.getByText('Original', { exact: true }).waitFor();
    check('radio', 'queueing an original shows Original in the drawer', true);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, 'radio-queue.png') });
  },

  async karaoke(page) {
    const { body: videos } = await pageVideos();
    const total = videos.reduce((n, v) => n + v.karaoke_song.length, 0);
    check('karaoke', 'api returns only karaoke streams with songs', total > 0, `${videos.length} videos, ${total} songs`);

    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    check('karaoke', 'list shows one row per video', (await videoRows(page).count()) === videos.length, `${await videoRows(page).count()} rows`);
    const firstShown = displayOrder(videos)[0];
    check('karaoke', 'exactly one stream is selected on load', (await page.locator(`${STREAMS} [aria-current="true"]`).count()) === 1);
    check('karaoke', 'the setlist shows only the selected stream, not every stream', (await songRowsIn(setlistOf(page)).count()) === firstShown.karaoke_song.length, `${firstShown.karaoke_song.length} songs`);
    await page.screenshot({ path: join(out, 'karaoke-list.png') });

    const rows = songRows(videos);
    const opensSetlist = async (s) => (await isPublic(s)) && !isSingleSong(videos, s.video_url);
    const aIndex = await findRowIndex(rows, opensSetlist);
    const isFirstOfVideo = (s) => rows.filter((r) => r.video_url === s.video_url).every((r) => secondsOf(r.timestamp) >= secondsOf(s.timestamp));
    const bIndex = await findRowIndex(
      rows,
      async (s) => (await opensSetlist(s)) && s.video_url !== rows[aIndex].video_url && isFirstOfVideo(s) && s.song_title !== rows[aIndex].song_title,
    );
    const cIndex = await findRowIndex(rows, async (s) => (await opensSetlist(s)) && s.song_title !== rows[aIndex].song_title && s.song_title !== rows[bIndex].song_title);
    const [a, b, c] = [rows[aIndex], rows[bIndex], rows[cIndex]];
    const search = page.getByPlaceholder('Search songs...');

    const opened = await openVideo(page, videos, a.video_url);
    check('karaoke', 'a video opens to its own songs', (await songRowsIn(opened).count()) === videos.find((v) => v.video_url === a.video_url).karaoke_song.length);
    await openVideo(page, videos, b.video_url);
    check(
      'karaoke',
      'choosing another stream swaps the setlist to its songs',
      (await songRowsIn(setlistOf(page)).count()) === videos.find((v) => v.video_url === b.video_url).karaoke_song.length && (await page.locator(`${STREAMS} [aria-current="true"]`).count()) === 1,
    );

    const shared = titleOnMostLiveVideos(rows);
    const want = expectedFor(videos, shared);
    await search.fill(shared);
    await streamCountIs(page, want.videos);
    check('karaoke', 'searching a title leaves exactly the videos that contain it', (await videoRows(page).count()) === want.videos, `${want.videos} videos for "${shared}"`);
    const perVideo = expectedPerVideo(videos, shared);
    const matchedVideos = perVideo.map((x) => x.video);
    let songsSeen = 0;
    let headersOk = true;
    for (const { video, matching } of perVideo) {
      const setlist = await openVideo(page, matchedVideos, video.video_url);
      songsSeen += await songRowsIn(setlist).count();
      headersOk &&=
        (await setlist.getByText(`${matching} of ${video.karaoke_song.length} songs match`).count()) === 1 &&
        (await videoRows(page)
          .filter({ hasText: video.video_title })
          .first()
          .getByText(new RegExp(`^${matching} ${matching === 1 ? 'match' : 'matches'}$`))
          .count()) === 1;
    }
    check('karaoke', 'searching shows only the matching songs in each stream', songsSeen === want.songs, `${want.songs} songs`);
    check('karaoke', 'each stream shows M of N songs match and a match count', headersOk);

    const chosen = videos.filter((v) => !v.is_gone && v.karaoke_song.length > 1 && v.karaoke_song.some((s) => s.song_title === shared)).at(-1);
    const chosenSong = chosen.karaoke_song.find((s) => s.song_title === shared);
    await videoRows(page).filter({ hasText: chosen.video_title }).first().locator('button').first().click();
    await songRowsIn(setlistOf(page)).filter({ hasText: shared }).first().click();
    await step('karaoke', 'playing a song from a chosen video loads that video at its timestamp', () => videoLoads(page, [chosen.video_url], { startSeconds: secondsOf(chosenSong.timestamp) }));
    await page.screenshot({ path: join(out, 'karaoke-search-played.png') });

    await search.fill('zzzqqqxxx');
    await streamCountIs(page, 0);
    check('karaoke', 'a search with no match shows no videos', true);
    await search.fill('satu bulan');
    const satu = expectedFor(videos, 'satu bulan');
    if (satu.videos > 0) await streamCountIs(page, satu.videos);
    await scrollListToTop(page);
    await page.screenshot({ path: join(out, 'karaoke-search.png') });
    await search.fill('');
    await streamCountIs(page, videos.length);
    check('karaoke', 'clearing the search restores every video', (await videoRows(page).count()) === videos.length);
    const stillSelected = await page.locator(`${STREAMS} [aria-current="true"]`).evaluate((el, title) => el.textContent.includes(title), chosen.video_title);
    check('karaoke', 'clearing the search keeps the stream that was chosen', stillSelected);

    const other = displayOrder(videos).find((v) => v.video_url !== chosen.video_url && !isSingleSong(videos, v.video_url));
    await openVideo(page, videos, other.video_url);
    const nowPlayingRow = videoRow(page, videos, chosen.video_url);
    check('karaoke', 'the video holding the current song is marked even when another stream is selected', (await nowPlayingRow.getByLabel('Now playing').count()) === 1 && (await nowPlayingRow.locator('[aria-current="true"]').count()) === 0);

    const rowA = await songRowOf(page, videos, a);
    await rowA.click();
    const bar = page.locator('[data-player-bar]');
    await bar.getByRole('heading', { name: a.song_title }).waitFor();
    await step('karaoke', 'play opens the player at the song timestamp', () => videoLoads(page, [a.video_url], { startSeconds: secondsOf(a.timestamp) }));

    const row1 = await songRowOf(page, videos, b);
    const addButton = row1.getByRole('button', {
      name: 'Add to Queue',
      exact: true,
    });
    const addBox = await addButton.boundingBox();
    check('karaoke', 'Add to Queue is visible without hovering and is at least 40px', !!addBox && addBox.width >= 40 && addBox.height >= 40, JSON.stringify(addBox));
    await addButton.click();
    await barButton(page, 'fa-step-forward').click();
    await bar.getByRole('heading', { name: b.song_title }).waitFor();
    check('karaoke', 'next plays the queued song', true, b.song_title);

    const row2 = await songRowOf(page, videos, c);
    await row2.getByRole('button', { name: 'Add to Queue', exact: true }).click();
    await queueHandle(page).click();
    const drawer = queueDrawerOf(page);
    await drawer.getByText(c.song_title).first().waitFor();
    check('karaoke', 'queue drawer lists the queued song', true, c.song_title);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, 'karaoke-queue.png') });
    await step('karaoke', 'with the queue drawer open at 1280x800 every visible Add to Queue sits left of the drawer and can be clicked', async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(500);
      await openVideo(page, videos, a.video_url);
      const drawerBox = await queueDrawerOf(page).boundingBox();
      if (!drawerBox || drawerBox.x > 1280 - 300) throw new Error(`drawer box ${JSON.stringify(drawerBox)}`);
      const buttons = setlistOf(page).getByRole('button', {
        name: 'Add to Queue',
        exact: true,
      });
      const n = await buttons.count();
      if (n !== videos.find((v) => v.video_url === a.video_url).karaoke_song.length) throw new Error(`${n} buttons`);
      let checked = 0;
      for (let i = 0; i < n; i++) {
        await buttons.nth(i).evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const box = await buttons.nth(i).boundingBox();
        if (box.x + box.width > drawerBox.x) throw new Error(`button ${i} ends at x ${box.x + box.width}, the drawer starts at ${drawerBox.x}`);
        const reachable = await buttons.nth(i).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return el.contains(hit);
        });
        if (!reachable) throw new Error(`button ${i} is covered`);
        checked++;
      }
      await buttons.last().click({ timeout: 5000 });
      check('karaoke', 'Add to Queue buttons checked beside the open drawer', checked === n, `${checked} buttons, drawer at x ${drawerBox.x}`);
    });
    await step('karaoke', 'scrollbar styles apply to the stream list, the setlist and the drawer', async () => {
      const colors = await page.evaluate(
        (sels) =>
          sels.map((sel) => {
            const el = document.querySelector(sel);
            const cs = getComputedStyle(el);
            return [cs.scrollbarColor, cs.scrollbarWidth, el.scrollHeight > el.clientHeight];
          }),
        [STREAMS, SETLIST, 'div.overflow-y-auto.p-4'],
      );
      for (const [color, width] of colors) {
        if (!color.includes('rgba(68, 110, 146') || width !== 'thin') throw new Error(JSON.stringify(colors));
      }
      if (!colors[0][2]) throw new Error('the stream list does not scroll, so the check proves nothing');
    });
    await page.screenshot({ path: join(out, 'karaoke-queue-open-wide.png') });

    await barButton(page, 'fa-step-backward').click();
    await bar.getByRole('heading', { name: a.song_title }).waitFor();
    await drawer.locator('div.group').first().getByText(b.song_title).waitFor();
    check('karaoke', 'previous returns to the earlier song and the song it left is first under Up Next', true, `${a.song_title} then ${b.song_title}`);
    await barButton(page, 'fa-step-forward').click();
    await bar.getByRole('heading', { name: b.song_title }).waitFor();
    check('karaoke', 'next plays the song previous kept', true, b.song_title);

    await page.reload();
    await videoRows(page).first().waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage')).state);
    check('karaoke', 'queue and history survive a reload', stored.queue.some((s) => s.id === c.id) && stored.history.some((s) => s.id === a.id));
    await queueHandle(page).click();
    await queueDrawerOf(page).getByText(c.song_title).first().waitFor();
    check('karaoke', 'drawer shows the restored queue after reload', true);
  },

  async player(page) {
    const { body: videos } = await pageVideos();
    const rows = songRows(videos);
    const start = await findRowIndex(rows.slice(0, -1), async (s, i) => (await isPublic(s)) && rows[i + 1].video_url === s.video_url);
    const nextRow = rows[start + 1];
    const lastIndex = await findRowIndex(rows, async (s, i) => (await isPublic(s)) && i > 0 && rows[i - 1].video_url === s.video_url && (i === rows.length - 1 || rows[i + 1].video_url !== s.video_url));
    const lastRow = rows[lastIndex];
    const otherFirsts = rows.filter((r, i) => !r.is_gone && r.video_url !== lastRow.video_url && rows.findIndex((x) => x.video_url === r.video_url) === i);
    if (!otherFirsts.length) throw new Error('no other live video to pick');

    const youtubeApi = await holdYoutubeApi(page);
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, rows[start])).click();
    const bar = page.locator('[data-player-bar]');
    await bar.getByRole('heading', { name: rows[start].song_title }).waitFor();
    await step('player', 'the expand button is disabled until the player has loaded', async () => {
      if (!(await barButton(page, 'fa-expand').isDisabled())) throw new Error('expand is clickable while the player loads');
      await bar.locator('img[alt="art"]').locator('..').click();
      await page.waitForTimeout(400);
      if (await page.locator('.fixed.z-50.inset-0').count()) throw new Error('the thumbnail expanded a loading player');
    });
    await step('player', 'a song clicked while the player loads is the one that plays once it has loaded', async () => {
      await (await songRowOf(page, videos, nextRow)).click();
      await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();
      await youtubeApi.release();
      await playerReady(page);
      await videoLoads(page, [nextRow.video_url], { startSeconds: secondsOf(nextRow.timestamp) });
      await page.waitForFunction(() => !document.querySelector('[data-player-bar] button:has(i.fa-expand)').disabled);
    });
    await youtubeApi.release();
    await (await songRowOf(page, videos, rows[start])).click();
    await bar.getByRole('heading', { name: rows[start].song_title }).waitFor();
    await videoLoads(page, [rows[start].video_url], { startSeconds: secondsOf(rows[start].timestamp) });
    await playerReady(page);
    await page.evaluate(() => {
      window.__frame = document.querySelector('iframe[src*="youtube"]');
    });

    await step('player', 'the autoplay switch shows on by default', async () => {
      await autoplaySwitch(page).waitFor();
      if ((await autoplaySwitch(page).getAttribute('aria-checked')) !== 'true') throw new Error('the switch is not on');
    });
    await step('player', 'on a phone the bar hides the switch, and the full player has it as a 40px target clear of repeat', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      try {
        if (await autoplaySwitch(page).isVisible()) throw new Error('the switch still shows in the phone bar');
        if (await barButton(page, 'fa-expand').isVisible()) throw new Error('the separate expand button still shows on a phone');
        await page.getByRole('button', { name: 'Expand player' }).first().click();
        const full = page.locator('.fixed.z-50.inset-0');
        const toggle = full.getByRole('switch', { name: 'Autoplay' });
        await toggle.waitFor({ state: 'visible' });
        await page.waitForTimeout(700);
        const box = await toggle.boundingBox();
        const repeat = await full.getByRole('button', { name: /^Repeat: / }).boundingBox();
        if (!box || box.height < 40 || box.x < 0 || box.x + box.width > 375) throw new Error(`switch box ${JSON.stringify(box)}`);
        if (!repeat || (repeat.x < box.x + box.width && box.x < repeat.x + repeat.width && repeat.y < box.y + box.height && box.y < repeat.y + repeat.height)) throw new Error('the switch overlaps the repeat button');
        await page.getByRole('button', { name: 'Collapse player' }).first().click();
      } finally {
        await page.setViewportSize({ width: 1280, height: 800 });
      }
    });
    await step('player', 'expand keeps the same video element', async () => {
      await barButton(page, 'fa-expand').click();
      await page.waitForFunction(() => window.__frame === document.querySelector('iframe[src*="youtube"]'));
      await page.screenshot({ path: join(out, 'player-expanded.png') });
      await page.locator('button:has(i.fa-chevron-down)').click();
    });
    await step('player', 'while expanded the bar stays usable, Up Next scrolls into view, and the same button collapses', async () => {
      await barButton(page, 'fa-expand').click();
      await page.waitForTimeout(600);
      const onTop = (locator) =>
        locator.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
        });
      if (!(await onTop(autoplaySwitch(page)))) throw new Error('the overlay covers the autoplay switch');
      if (!(await onTop(barButton(page, 'fa-compress')))) throw new Error('the overlay covers the collapse button');
      const upNext = page.locator('.inset-0').getByRole('heading', { name: 'Up Next' });
      await upNext.scrollIntoViewIfNeeded();
      const box = await upNext.boundingBox();
      if (!box || box.y + box.height > 800 - 80) throw new Error(`Up Next is out of reach at ${JSON.stringify(box)}`);
      await barButton(page, 'fa-compress').click();
      await page.waitForFunction(() => !document.querySelector('.inset-0 iframe[src*="youtube"]'));
    });
    await step('player', 'the pause button pauses the real video', async () => {
      await playVideo(page);
      await playerState(page, 1);
      await bar.locator('button:not([role="switch"]) i.fa-pause').waitFor();
      await barButton(page, 'fa-pause').click();
      await playerState(page, 2);
    });
    await step('player', 'a play started inside the player reaches the bar', async () => {
      await playVideo(page);
      await bar.locator('button:not([role="switch"]) i.fa-pause').waitFor({ timeout: 15000 });
    });
    await step('player', 'a pause started inside the player reaches the bar', async () => {
      await page.evaluate(() => {
        const f = document.querySelector('iframe[src*="youtube"]');
        window.YT.get(f.id).pauseVideo();
      });
      await bar.locator('button:not([role="switch"]) i.fa-play').waitFor({ timeout: 15000 });
    });
    await step('player', 'the end of a stream clicked on its first song plays another live video, not the same stream again', async () => {
      await playVideo(page);
      await seekNearEnd(page);
      await videoLoads(page, videos.filter((v) => !v.is_gone && v.video_url !== rows[start].video_url).map((v) => v.video_url), { timeout: 40000 });
    });
    check('player', 'only one player exists after moving on', (await page.locator('iframe[src*="youtube"]').count()) === 1);

    await step('player', 'the end of the last song of a video plays the first song of another live video', async () => {
      await (await songRowOf(page, videos, lastRow)).click();
      await bar.getByRole('heading', { name: lastRow.song_title }).waitFor();
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [lastRow.video_url], { startSeconds: secondsOf(lastRow.timestamp), isPlaying: true });
      await seekNearEnd(page);
      await videoLoads(
        page,
        otherFirsts.map((r) => r.video_url),
        { timeout: 40000 },
      );
      const landedId = await loadedVideoId(page);
      const first = otherFirsts.find((r) => r.video_url === landedId);
      await videoLoads(page, [landedId], { startSeconds: secondsOf(first.timestamp) });
      await bar.getByRole('heading', { name: first.song_title }).waitFor();
    });
    await (await songRowOf(page, videos, nextRow)).click();
    await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();

    await step('player', 'with autoplay off the video end keeps the same song, paused, in the same player', async () => {
      await page.evaluate(() => {
        window.__frame = document.querySelector('iframe[src*="youtube"]');
      });
      await playerReady(page);
      await autoplaySwitch(page).click();
      await switchBecomes(page, false, 'the switch did not turn off');
      await playVideo(page);
      await videoLoads(page, [nextRow.video_url], { startSeconds: secondsOf(nextRow.timestamp), isPlaying: true });
      await seekNearEnd(page);
      await bar.locator('button:not([role="switch"]) i.fa-play').waitFor({ timeout: 40000 });
      const lastOfVideo = rows.filter((r) => r.video_url === nextRow.video_url).toSorted((x, y) => secondsOf(y.timestamp) - secondsOf(x.timestamp))[0];
      await bar.getByRole('heading', { name: lastOfVideo.song_title }).waitFor();
      if (!(await page.evaluate(() => window.__frame === document.querySelector('iframe[src*="youtube"]')))) throw new Error('a new iframe was created');
      if ((await page.locator('iframe[src*="youtube"]').count()) !== 1) throw new Error('more than one player');
    });
    await step('player', 'the off state survives a reload', async () => {
      await page.reload();
      await videoRows(page).first().waitFor();
      if ((await page.evaluate(() => localStorage.getItem('karaoke-autoplay'))) !== 'false') throw new Error('nothing saved');
      await (await songRowOf(page, videos, rows[start])).click();
      await autoplaySwitch(page).waitFor();
      if ((await autoplaySwitch(page).getAttribute('aria-checked')) !== 'false') throw new Error('the switch came back on');
    });
    await step('player', 'a page with blocked storage still renders and defaults to autoplay on', async () => {
      const blockedTab = blockedStoragePage('player');
      await blockedTab.goto(BASE + '/');
      await videoRows(blockedTab).first().waitFor();
      await (await songRowOf(blockedTab, videos, rows[start])).click();
      await autoplaySwitch(blockedTab).waitFor();
      if ((await autoplaySwitch(blockedTab).getAttribute('aria-checked')) !== 'true') throw new Error('the switch is not on');
      await autoplaySwitch(blockedTab).click();
      await switchBecomes(blockedTab, false, 'the switch does not toggle');
      await blockedTab.close();
    });
  },

  async strictAutoplay() {
    const { body: videos } = await pageVideos();
    const [first, second] = videos.filter((v) => !v.is_gone && v.karaoke_song.length > 2);
    if (!second) throw new Error('the data has fewer than two live streams with three songs');
    const songOf = (video, index) => ({ ...video.karaoke_song[index], video_url: video.video_url });
    const strict = makeSession('strict', { launchArgs: ['--args', '--autoplay-policy=user-gesture-required'] });
    try {
      const page = strict.page();
      await page.goto(BASE + '/');
      await videoRows(page).first().waitFor();
      await page.evaluate(() => {
        window.__frames = { max: 0, seen: new Set() };
        setInterval(() => {
          const frames = document.querySelectorAll('iframe[src*="youtube"]');
          window.__frames.max = Math.max(window.__frames.max, frames.length);
          frames.forEach((frame) => window.__frames.seen.add(frame));
        }, 50);
      });
      const bar = page.locator('[data-player-bar]');
      const playSong = async (song) => {
        await (await songRowOf(page, videos, song)).click();
        await bar.getByRole('heading', { name: song.song_title }).waitFor();
      };

      const firstSong = songOf(first, 0);
      await step('strictAutoplay', 'a first play the browser blocks shows the play button in the bar, not pause', async () => {
        await playSong(firstSong);
        await playerReady(page);
        await videoLoads(page, [firstSong.video_url], { startSeconds: secondsOf(firstSong.timestamp) });
        await bar.locator('button:not([role="switch"]) i.fa-play').waitFor({ timeout: 10000 });
      });
      await step('strictAutoplay', 'the first song plays after one click inside the YouTube player, which a strict browser requires', async () => {
        const song = firstSong;
        await barButton(page, 'fa-expand').click();
        await page.waitForTimeout(1500);
        const box = await page.locator('iframe[src*="youtube"]').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await videoLoads(page, [song.video_url], { startSeconds: secondsOf(song.timestamp), isPlaying: true });
        await bar.locator('button:not([role="switch"]) i.fa-pause').waitFor();
        await page.locator('button:has(i.fa-chevron-down)').click();
      });
      for (const [name, song] of [
        ['another song in the same stream', songOf(first, 2)],
        ['a song in another stream', songOf(second, 1)],
      ]) {
        await step('strictAutoplay', `clicking ${name} plays it from its start`, async () => {
          await playSong(song);
          await videoLoads(page, [song.video_url], { startSeconds: secondsOf(song.timestamp), isPlaying: true, timeout: 20000 });
          await bar.locator('button:not([role="switch"]) i.fa-pause').waitFor();
        });
      }
      const frames = await page.evaluate(() => ({ max: window.__frames.max, distinct: window.__frames.seen.size }));
      check('strictAutoplay', 'one YouTube iframe served every song', frames.max === 1 && frames.distinct === 1, JSON.stringify(frames));
      await page.screenshot({ path: join(out, 'strict-autoplay.png') });
      const errors = await page.pageErrors();
      check('strictAutoplay', 'the strict browser logged no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally {
      await strict.close();
    }
  },

  async segmentSkip(page) {
    const { body: videos } = await pageVideos();
    const video = videos.find((v) => !v.is_gone && v.karaoke_song.length >= 3);
    if (!video) throw new Error('no live video with three songs');
    const sorted = songRows([video]).toSorted((a, b) => secondsOf(a.timestamp) - secondsOf(b.timestamp));
    const [first, second, third] = sorted;
    const last = sorted.at(-1);
    const currentTime = () =>
      page.evaluate(() => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).getCurrentTime());
    const timeNear = (seconds) =>
      page.waitForFunction(
        (want) => {
          const t = window.YT.get(document.querySelector('iframe[src*="youtube"]').id).getCurrentTime();
          return t >= want - 1 && t < want + 10;
        },
        seconds,
        { timeout: 20000 },
      ).catch(async () => {
        throw new Error(`wanted about ${seconds}s, saw ${await currentTime()}s`);
      });
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, second)).click();
    await playerReady(page);
    await playVideo(page);
    await videoLoads(page, [video.video_url], { startSeconds: secondsOf(second.timestamp), isPlaying: true });
    await page.waitForTimeout(2000);
    await step('segmentSkip', 'next jumps to the next song timestamp in the same video', async () => {
      await barButton(page, 'fa-step-forward').click();
      await timeNear(secondsOf(third.timestamp));
      if ((await loadedVideoId(page)) !== video.video_url) throw new Error('the video changed');
    }, page);
    await page.screenshot({ path: join(out, 'segment-skip-next.png') });
    await step('segmentSkip', 'previous jumps back to the start of the song before', async () => {
      await page.waitForTimeout(2000);
      await barButton(page, 'fa-step-backward').click();
      await timeNear(secondsOf(second.timestamp));
    }, page);
    await step('segmentSkip', 'previous again reaches the first song of the video', async () => {
      await page.waitForTimeout(2000);
      await barButton(page, 'fa-step-backward').click();
      await timeNear(secondsOf(first.timestamp));
    }, page);
    check('segmentSkip', 'only one player exists after seeking', (await page.locator('iframe[src*="youtube"]').count()) === 1);
    await step('segmentSkip', 'next on the last song of a video with an empty queue plays another live video', async () => {
      const lastRow = await songRowOf(page, videos, last);
      await lastRow.click();
      await page.locator('[data-player-bar]').getByRole('heading', { name: last.song_title }).first().waitFor({ timeout: 10000 });
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { startSeconds: secondsOf(last.timestamp), isPlaying: true });
      await page.waitForTimeout(2000);
      await barButton(page, 'fa-step-forward').click();
      const others = videos.filter((v) => !v.is_gone && v.video_url !== video.video_url).map((v) => v.video_url);
      await videoLoads(page, others, { timeout: 40000 });
    }, page);
    await step('segmentSkip', 'next with a queued song plays it rather than the next song in the stream', async () => {
      await (await songRowOf(page, videos, first)).click();
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { startSeconds: secondsOf(first.timestamp), isPlaying: true });
      const section = await openVideo(page, videos, video.video_url);
      await songRowsIn(section).nth(video.karaoke_song.findIndex((s) => s.id === last.id)).getByRole('button', { name: /queue/i }).first().click();
      await page.waitForTimeout(1000);
      await barButton(page, 'fa-step-forward').click();
      await page.locator('[data-player-bar]').getByRole('heading', { name: last.song_title }).first().waitFor({ timeout: 20000 });
      await timeNear(secondsOf(last.timestamp));
    }, page);
  },
  async playStats(page) {
    const adminPort = process.env.ADMIN_PORT ?? '3911';
    const adminSecret = process.env.ADMIN_SECRET ?? 'verify-admin-secret';
    const report = async () => (await fetch(`http://127.0.0.1:${adminPort}/stats?days=1`, { headers: { authorization: `Bearer ${adminSecret}` } })).json();
    const songStat = async (song) => (await report()).songs.find((s) => s.songId === song.id);
    const until = async (what, ready) => {
      for (let i = 0; i < 40; i++) {
        const seen = await ready();
        if (seen) return seen;
        await page.waitForTimeout(500);
      }
      throw new Error(`never saw ${what}: ${JSON.stringify((await report()).songs)}`);
    };
    const { body: videos } = await pageVideos();
    const live = videos.filter((v) => !v.is_gone);
    const video = live.find((v) => v.karaoke_song.length >= 3 && secondsOf(v.karaoke_song[1].timestamp) - secondsOf(v.karaoke_song[0].timestamp) > 20);
    if (!video) throw new Error('no live video with three songs and a long first song');
    const sorted = songRows([video]).toSorted((a, b) => secondsOf(a.timestamp) - secondsOf(b.timestamp));
    const [first, second, third] = sorted;
    const last = sorted.at(-1);
    const seekTo = (seconds) =>
      page.evaluate((to) => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).seekTo(to, true), seconds);
    const playheadPast = (seconds) =>
      page.waitForFunction((want) => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).getCurrentTime() >= want, seconds, { timeout: 30000 });
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();

    await step('playStats', 'a clicked song counts one click and, once it plays, one visitor play', async () => {
      await (await songRowOf(page, videos, first)).click();
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { startSeconds: secondsOf(first.timestamp), isPlaying: true });
      const stat = await until('the first play', async () => (await songStat(first))?.plays.Visitor === 1 && (await songStat(first)));
      if (stat.clicks !== 1 || stat.plays.Autoplay !== 0) throw new Error(JSON.stringify(stat));
    }, page);

    await step('playStats', 'a stream playing into its second song by itself finishes the first and plays the second', async () => {
      await seekTo(secondsOf(second.timestamp) - 4);
      await playheadPast(secondsOf(second.timestamp) + 1);
      const stat = await until('the second play', async () => (await songStat(second))?.plays.Visitor === 1 && (await songStat(second)));
      const before = await songStat(first);
      if (before.finishes.Visitor !== 1 || before.plays.Visitor !== 1) throw new Error(JSON.stringify(before));
      if (stat.clicks !== 0) throw new Error(`a play by itself counted a click: ${JSON.stringify(stat)}`);
    }, page);

    await step('playStats', 'Next partway through a song records one skip with the seconds into that song', async () => {
      await page.waitForTimeout(3000);
      await barButton(page, 'fa-step-forward').click();
      const stat = await until('the skip', async () => (await songStat(second))?.skips.Visitor === 1 && (await songStat(second)));
      const seconds = stat.medianSecondsIntoSkip;
      if (!(seconds >= 3 && seconds <= 20)) throw new Error(`seconds into the song: ${seconds}`);
      if (stat.finishes.Visitor !== 0) throw new Error('a skipped song counted as finished');
      await until('the third song playing', async () => (await songStat(third))?.plays.Visitor === 1);
    }, page);

    await step('playStats', 'Next on the last song lets the radio pick the next video, which counts as an autoplay play', async () => {
      await (await songRowOf(page, videos, last)).click();
      await page.locator('[data-player-bar]').getByRole('heading', { name: last.song_title }).first().waitFor({ timeout: 10000 });
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { startSeconds: secondsOf(last.timestamp), isPlaying: true });
      await page.waitForTimeout(2000);
      await barButton(page, 'fa-step-forward').click();
      const others = live.filter((v) => v.video_url !== video.video_url).map((v) => v.video_url);
      await videoLoads(page, others, { isPlaying: true, timeout: 40000 });
      const autoplayed = await until('an autoplay play', async () => (await report()).songs.find((s) => s.plays.Autoplay === 1));
      if (autoplayed.plays.Visitor !== 0) throw new Error(JSON.stringify(autoplayed));
      const lastStat = await songStat(last);
      if (lastStat.skips.Visitor !== 1) throw new Error(JSON.stringify(lastStat));
    }, page);
    console.log(JSON.stringify(await report(), null, 2));
  },
  async listeningTrail(page) {
    const statsPath = readFileSync(join(RUN_DIR, 'stats.path'), 'utf8').trim();
    const rows = (table) => {
      const db = new DatabaseSync(statsPath, { readOnly: true });
      try {
        return db.prepare(`SELECT * FROM ${table} ORDER BY minute, session_id, seq`).all();
      } finally {
        db.close();
      }
    };
    const until = async (what, ready) => {
      for (let i = 0; i < 40; i++) {
        const seen = ready();
        if (seen) return seen;
        await page.waitForTimeout(500);
      }
      throw new Error(`never saw ${what}: ${JSON.stringify(rows('listen_events'))}`);
    };
    const { body: videos } = await pageVideos();
    const live = videos.filter((v) => !v.is_gone);
    const video = live.find((v) => v.karaoke_song.length >= 3 && secondsOf(v.karaoke_song[1].timestamp) - secondsOf(v.karaoke_song[0].timestamp) > 20);
    if (!video) throw new Error('no live video with three songs and a long first song');
    const sorted = songRows([video]).toSorted((a, b) => secondsOf(a.timestamp) - secondsOf(b.timestamp));
    const [first, second, third] = sorted;
    const last = sorted.at(-1);
    const seekTo = (seconds) =>
      page.evaluate((to) => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).seekTo(to, true), seconds);
    const playheadPast = (seconds) =>
      page.waitForFunction((want) => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).getCurrentTime() >= want, seconds, { timeout: 30000 });
    const playFirstSong = async () => {
      await page.goto(BASE + '/');
      await videoRows(page).first().waitFor();
      await (await songRowOf(page, videos, first)).click();
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { startSeconds: secondsOf(first.timestamp), isPlaying: true });
    };
    const trailOf = (events) => events.map((r) => `${r.seq} ${r.kind} ${r.song_id} <- ${r.prev_song_id}`);
    const sessionIds = () => [...new Set(rows('listen_events').map((r) => r.session_id))];
    const f = 'listeningTrail';

    await step(f, 'a visit records its clicks, plays, finishes and skips in order, with the song before each play', async () => {
      await playFirstSong();
      await until('the first play', () => rows('listen_events').some((r) => r.kind === 'Play' && r.song_id === first.id));
      await seekTo(secondsOf(second.timestamp) - 4);
      await playheadPast(secondsOf(second.timestamp) + 1);
      await until('the second play', () => rows('listen_events').some((r) => r.kind === 'Play' && r.song_id === second.id));
      await page.waitForTimeout(3000);
      await barButton(page, 'fa-step-forward').click();
      await until('the skip', () => rows('listen_events').some((r) => r.kind === 'Skip' && r.song_id === second.id));
      await until('the third song', () => rows('listen_events').some((r) => r.kind === 'Play' && r.song_id === third.id));
      const events = rows('listen_events');
      const want = [
        `1 Click ${first.id} <- null`,
        `2 Play ${first.id} <- null`,
        `3 Finish ${first.id} <- null`,
        `4 Play ${second.id} <- ${first.id}`,
        `5 Skip ${second.id} <- ${first.id}`,
        `6 Play ${third.id} <- ${second.id}`,
      ];
      if (JSON.stringify(trailOf(events)) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(trailOf(events), null, 1)}`);
      if (new Set(events.map((r) => r.minute)).size < 1 || !events.every((r) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(r.minute))) throw new Error('minute precision');
      if (sessionIds().length !== 1) throw new Error(`session ids ${sessionIds()}`);
    }, page);

    await step(f, 'the session id lives only in memory', async () => {
      const stored = await page.evaluate(() => JSON.stringify([document.cookie, { ...localStorage }, { ...sessionStorage }]));
      if (stored.includes(sessionIds()[0])) throw new Error(`the session id is stored in the browser: ${stored}`);
      if (/session/i.test(await page.evaluate(() => document.cookie))) throw new Error('a session cookie was set');
    }, page);

    await step(f, 'an autoplay pick is logged before the play it causes, with the pool size and 1/pool propensity', async () => {
      await (await songRowOf(page, videos, last)).click();
      await page.locator('[data-player-bar]').getByRole('heading', { name: last.song_title }).first().waitFor({ timeout: 10000 });
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { startSeconds: secondsOf(last.timestamp), isPlaying: true });
      await page.waitForTimeout(2000);
      await barButton(page, 'fa-step-forward').click();
      const others = live.filter((v) => v.video_url !== video.video_url).map((v) => v.video_url);
      await videoLoads(page, others, { isPlaying: true, timeout: 40000 });
      const decision = await until('a decision', () => rows('autoplay_decisions')[0]);
      const play = await until('the autoplay play', () => rows('listen_events').find((r) => r.kind === 'Play' && r.origin === 'Autoplay'));
      if (decision.policy !== 'uniform-v1') throw new Error(decision.policy);
      if (Math.abs(decision.propensity - 1 / decision.pool_size) > 1e-12) throw new Error(`propensity ${decision.propensity} for pool ${decision.pool_size}`);
      if (decision.pool_size < 1) throw new Error('empty pool');
      if (decision.picked_song_id !== play.song_id) throw new Error(`picked ${decision.picked_song_id} but played ${play.song_id}`);
      if (!(decision.seq < play.seq)) throw new Error(`decision seq ${decision.seq} is not before play seq ${play.seq}`);
      if (decision.prev_song_id !== last.id) throw new Error(`decision prev ${decision.prev_song_id}, expected ${last.id}`);
      if (play.prev_song_id !== last.id) throw new Error(`play prev ${play.prev_song_id}`);
      const skip = rows('listen_events').find((r) => r.kind === 'Skip' && r.song_id === last.id);
      if (!skip || !(skip.seq < decision.seq)) throw new Error('the skip of the last song does not sort before the decision');
    }, page);

    await step(f, 'a reload starts a new session that shares nothing with the first', async () => {
      const before = sessionIds();
      await playFirstSong();
      await until('the second session', () => sessionIds().length === 2);
      await until('its play', () => rows('listen_events').some((r) => r.session_id !== before[0] && r.kind === 'Play'));
      await seekTo(secondsOf(second.timestamp) - 4);
      await playheadPast(secondsOf(second.timestamp) + 1);
      await until('its second song', () => rows('listen_events').some((r) => r.session_id !== before[0] && r.kind === 'Play' && r.song_id === second.id));
      const mine = rows('listen_events').filter((r) => r.session_id !== before[0]);
      if (mine[0].seq !== 1) throw new Error(`the new session starts at seq ${mine[0].seq}`);
      if (mine.some((r) => before.includes(r.session_id))) throw new Error('sessions mixed');
      if (!mine.every((r) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.session_id))) throw new Error('not a UUID v4');
      const first1 = mine.find((r) => r.kind === 'Play' && r.song_id === first.id);
      if (first1.prev_song_id !== null) throw new Error('a new session must not know the last visit');
    }, page);

    console.log(JSON.stringify({ listen_events: rows('listen_events'), autoplay_decisions: rows('autoplay_decisions') }, null, 2));

    const stack = await startDiscordStack({ STATS_DB_PATH: statsPath, STATS_USER_IDS: `${STATS_MOD.id},${STATS_FIONA.id}` });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await step(f, 'the export is closed to a signed-out visitor and to an unlisted user', async () => {
        await page.goto(stack.base + '/stats');
        await page.locator('[data-action="sign-in"]').waitFor();
        const status = (table) => page.evaluate((t) => fetch(`/api/stats-page/export?days=7&table=${t}`).then((r) => r.status), table);
        if ((await status('events')) !== 401) throw new Error('signed-out export is open');
        await stack.actAs(STATS_STRANGER);
        await page.locator('[data-action="sign-in"]').click();
        await page.waitForFunction(() => location.pathname === '/stats');
        await page.getByRole('heading', { name: 'No access' }).waitFor();
        if ((await status('decisions')) !== 403) throw new Error('unlisted export is open');
        await page.locator('[data-action="logout"]').click();
        await page.locator('[data-action="sign-in"]').waitFor();
      }, page);

      await step(f, 'the outcome and transition panels show the trail, and the first to second transition has two plays', async () => {
        await stack.actAs(STATS_MOD);
        await page.locator('[data-action="sign-in"]').click();
        await page.waitForFunction(() => location.pathname === '/stats');
        await page.locator('[data-panel="origin-outcomes"]').waitFor();
        const visitor = await page.locator('[data-table="outcomes"] [data-origin="Visitor"]').innerText();
        const autoplay = await page.locator('[data-table="outcomes"] [data-origin="Autoplay"]').innerText();
        if (!/Visitor\s+\d+/.test(visitor) || !/Autoplay\s+\d+/.test(autoplay)) throw new Error(`${visitor} | ${autoplay}`);
        const row = page.locator(`[data-table="transitions"] [data-transition="${first.id}>${second.id}"]`);
        await row.waitFor();
        const cells = await row.locator('td').evaluateAll((tds) => tds.map((td) => td.textContent.trim()));
        if (cells[1] !== '2' || cells[3] !== '50%') throw new Error(`transition row: ${JSON.stringify(cells)}`);
        await page.locator('[data-min-plays="5"]').click();
        await page.waitForFunction(() => document.querySelectorAll('[data-table="transitions"] tbody tr').length === 0);
        await page.locator('[data-min-plays="2"]').click();
        await row.waitFor();
        await page.locator('[data-sort-transition="skipRate"]').click();
        await page.screenshot({ path: join(out, 'trail-panels-desktop.png'), fullPage: true });
      }, page);

      await step(f, 'each export link downloads valid NDJSON for the range, with titles joined', async () => {
        for (const table of ['events', 'decisions']) {
          const href = await page.locator(`[data-export="${table}"]`).getAttribute('href');
          if (href !== `/api/stats-page/export?days=7&table=${table}`) throw new Error(href);
          const result = await page.evaluate((url) => fetch(url).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition'), body: await r.text() })), href);
          if (result.status !== 200 || !result.type.includes('x-ndjson') || !result.disposition.includes('attachment')) throw new Error(JSON.stringify({ ...result, body: '' }));
          const lines = result.body.trimEnd().split('\n').map((line) => JSON.parse(line));
          const want = rows(table === 'events' ? 'listen_events' : 'autoplay_decisions').length;
          if (lines.length !== want || want === 0) throw new Error(`${table}: ${lines.length} lines for ${want} rows`);
          if (!result.body.endsWith('\n')) throw new Error('the last line is not terminated');
          const titled = table === 'events' ? lines.find((l) => l.songId === first.id) : lines[0];
          if (!(titled.title ?? titled.pickedTitle)) throw new Error(`no title: ${JSON.stringify(titled)}`);
          console.log(`${table} sample: ${JSON.stringify(lines[0])}`);
        }
        const bad = await page.evaluate(() => fetch('/api/stats-page/export?days=7&table=sessions').then((r) => r.status));
        if (bad !== 400) throw new Error(`unknown table answered ${bad}`);
      }, page);

      await step(f, 'the panels fit a phone', async () => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.locator('[data-panel="transitions"]').waitFor();
        if (!(await noSidewaysScroll(page))) throw new Error('the page scrolls sideways');
        await page.screenshot({ path: join(out, 'trail-panels-phone.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 800 });
      }, page);
    } finally {
      stack.close();
    }
  },
  async coverEnd(page) {
    const { body: videos } = await pageVideos();
    const live = displayOrder(videos).filter((v) => !v.is_gone);
    const covers = live.filter((v, i) => i > 0 && v.kind === 'cover' && v.karaoke_song.length === 1);
    const [cover, otherCover] = [...covers.filter((v) => v.video_url === 'g26JmYMkml4'), ...covers.filter((v) => v.video_url !== 'g26JmYMkml4')];
    if (!otherCover) throw new Error('the data has fewer than two live single-song covers after the first video');
    const songOfVideo = (video) => ({ ...video.karaoke_song[0], video_url: video.video_url });
    const bar = page.locator('[data-player-bar]');
    const repeatButton = (mode) => bar.getByRole('button', { name: `Repeat: ${mode}`, exact: true });
    const setRepeat = async (mode) => {
      for (let i = 0; i < 3 && !(await repeatButton(mode).isVisible()); i++) {
        await bar.getByRole('button', { name: /^Repeat: / }).click();
        await page.waitForTimeout(300);
      }
      await repeatButton(mode).waitFor({ timeout: 5000 });
    };
    const playCover = async (video) => {
      await (await songRowOf(page, videos, songOfVideo(video))).click();
      await bar.getByRole('heading', { name: video.karaoke_song[0].song_title }).waitFor();
      await playerReady(page);
      await playVideo(page);
      await videoLoads(page, [video.video_url], { isPlaying: true });
    };
    const seekBeforeEnd = (seconds) =>
      page.waitForFunction(
        (before) => {
          const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id);
          const duration = p.getDuration();
          if (!(duration > 0)) return false;
          p.seekTo(duration - before, true);
          return true;
        },
        seconds,
        { polling: 250, timeout: 20000 },
      );
    const playerNow = () =>
      page.evaluate(() => {
        const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id);
        return { videoId: p.getVideoData()?.video_id, seconds: p.getCurrentTime(), state: p.getPlayerState() };
      });
    const keepsPlaying = async (videoId) => {
      await videoLoads(page, [videoId], { isPlaying: true });
      await page.waitForTimeout(5000);
      const now = await playerNow();
      if (now.videoId !== videoId || now.state !== 1) throw new Error(`wanted ${videoId} still playing, saw ${JSON.stringify(now)}`);
    };
    // NOTE: an embedded Short at its end either reports ENDED or wraps to its start without reporting it. Which one varies between runs and often holds for a whole session, so a run that saw only ENDED proves nothing about the wrap and must be rerun.
    const ends = [];
    const reachEnd = async () => {
      const from = await page.evaluate(() => {
        if (!window.__states) {
          window.__states = [];
          window.YT.get(document.querySelector('iframe[src*="youtube"]').id).addEventListener('onStateChange', (e) => window.__states.push(e.data));
        }
        return window.__states.length;
      });
      await page.waitForTimeout(3000);
      await seekBeforeEnd(2);
      return async () => ends.push((await page.evaluate((i) => window.__states.slice(i), from)).includes(0) ? 'reported' : 'wrapped');
    };
    const setlistShows = (video) =>
      page
        .waitForFunction(([sel, title]) => document.querySelector(sel)?.getAttribute('aria-label') === `Setlist of ${title}`, [SETLIST, video.video_title], { timeout: 10000 })
        .catch(async () => {
          throw new Error(`wanted the setlist of ${video.video_url}, saw ${await page.locator(SETLIST).getAttribute('aria-label')}`);
        });

    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();

    await step('coverEnd', 'playing a cover from its video row shows its setlist without choosing it', async () => {
      await playCover(cover);
      await setlistShows(cover);
      const url = await page.url();
      if (new URL(url).searchParams.has('v')) throw new Error(`the play chose the video: ${url}`);
    }, page);
    await page.screenshot({ path: join(out, 'cover-end-setlist.png') });

    await step('coverEnd', 'with autoplay on, a cover that reaches its end moves on to another video that keeps playing', async () => {
      const ended = await reachEnd();
      await videoLoads(page, live.filter((v) => v.video_url !== cover.video_url).map((v) => v.video_url), { timeout: 10000 });
      await ended();
      const landed = await loadedVideoId(page);
      await keepsPlaying(landed);
      await setlistShows(videos.find((v) => v.video_url === landed));
    }, page);
    await page.screenshot({ path: join(out, 'cover-end-moved-on.png') });
    check('coverEnd', 'with autoplay on, a cover wrapped to its start without reporting its end, so the step covered that path', ends.includes('wrapped'), ends.join(' '));

    await step('coverEnd', 'clicking another cover in the last second of one plays the clicked cover', async () => {
      await playCover(cover);
      await seekBeforeEnd(0.8);
      await (await songRowOf(page, videos, songOfVideo(otherCover))).click();
      await videoLoads(page, [otherCover.video_url], { isPlaying: true, timeout: 15000 });
      await keepsPlaying(otherCover.video_url);
    }, page);

    await step('coverEnd', 'with repeat One, a cover replays from its start once per end', async () => {
      await playCover(cover);
      await setRepeat('One');
      for (let end = 0; end < 2; end++) {
        const ended = await reachEnd();
        await page.waitForFunction(
          (id) => {
            const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id);
            return p.getVideoData()?.video_id === id && p.getPlayerState() === 1 && p.getCurrentTime() < 5;
          },
          cover.video_url,
          { timeout: 10000 },
        );
        await ended();
      }
      await keepsPlaying(cover.video_url);
      await setRepeat('Off');
    }, page);

    await step('coverEnd', 'with autoplay off, a cover that reaches its end stops on it', async () => {
      await autoplaySwitch(page).click();
      await switchBecomes(page, false, 'the switch did not turn off');
      await playCover(cover);
      const ended = await reachEnd();
      await bar.locator('button:not([role="switch"]) i.fa-play').waitFor({ timeout: 10000 });
      await ended();
      const stopped = await playerNow();
      await page.waitForTimeout(3000);
      const later = await playerNow();
      if (later.videoId !== cover.video_url || later.state === 1 || Math.abs(later.seconds - stopped.seconds) > 0.5) {
        throw new Error(`wanted ${cover.video_url} stopped, saw ${JSON.stringify(stopped)} then ${JSON.stringify(later)}`);
      }
    }, page);
    await page.screenshot({ path: join(out, 'cover-end-stopped.png') });  },

  async queueReorder(page) {
    await queueReorderJourney(page, 'queueReorder', { touch: false });
  },

  async queueReorderTouch(page) {
    const touchPage = makeSession('touch', { viewport: { width: 375, height: 667 } }).page();
    try {
      await queueReorderJourney(touchPage, 'queueReorderTouch', { touch: true });
    } catch (e) {
      await touchPage.screenshot({ path: join(out, 'queue-reorder-touch-state.png') }).catch(() => {});
      throw e;
    }
  },

  async unavailable(page) {
    const { body: videos } = await pageVideos();
    const rows = songRows(videos);
    const goneIndex = rows.findIndex((r, i) => r.is_gone && rows.findIndex((x) => x.video_url === r.video_url) === i && rows.slice(i + 1).some((x) => !x.is_gone));
    if (goneIndex < 0) throw new Error('no gone song has a live song after it');
    const gone = rows[goneIndex];
    const liveIndex = rows.findIndex((r) => !r.is_gone);
    const live = rows[liveIndex];
    const liveFirsts = rows.filter((r, i) => !r.is_gone && r.video_url !== gone.video_url && rows.findIndex((x) => x.video_url === r.video_url) === i);
    const bar = page.locator('[data-player-bar]');
    const stepForward = barButton(page, 'fa-step-forward');

    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    const liveVideos = videos.filter((v) => !v.is_gone).length;
    const goneRow = videoRow(page, videos, gone.video_url);
    await step('unavailable', 'gone videos are listed after every live one, labelled Stream gone, with no thumbnail request', async () => {
      const labelled = await videoRows(page).evaluateAll((items) => items.map((x) => x.textContent.includes('Stream gone')));
      if (labelled.some((isGone, i) => isGone !== i >= liveVideos)) throw new Error(`labels ${labelled.map(Number).join('')}`);
      if ((await goneRow.locator('img').count()) !== 0) throw new Error('the gone video requests a thumbnail');
    });
    const goneVideo = videos.find((v) => v.video_url === gone.video_url);
    await step('unavailable', 'a gone video can be expanded to show what was sung, with disabled rows and no Add to Queue', async () => {
      const goneSetlist = await openVideo(page, videos, gone.video_url);
      const goneRows = songRowsIn(goneSetlist);
      if ((await goneRows.count()) !== goneVideo.karaoke_song.length) throw new Error('the songs are not listed');
      if (await goneSetlist.getByRole('button', { name: 'Add to Queue' }).count()) throw new Error('a gone row has an Add to Queue button');
      for (const attr of await goneRows.evaluateAll((els) => els.map((el) => el.getAttribute('aria-disabled')))) {
        if (attr !== 'true') throw new Error('a gone row is not aria-disabled');
      }
      await page.screenshot({ path: join(out, 'karaoke-gone-row.png') });
    });
    await step('unavailable', 'clicking a gone song row changes nothing and opens no player', async () => {
      await songRowsIn(setlistOf(page))
        .nth(goneVideo.karaoke_song.findIndex((s) => s.id === gone.id))
        .click();
      await page.waitForTimeout(1000);
      if (await stepForward.count()) throw new Error('a player bar appeared');
      if (await page.locator('iframe[src*="youtube"]').count()) throw new Error('a player was mounted');
    });
    await step('unavailable', 'a search that matches a gone video lists it after the live ones', async () => {
      const search = page.getByPlaceholder('Search songs...');
      await search.fill(gone.song_title);
      const want = expectedFor(videos, gone.song_title);
      await streamCountIs(page, want.videos);
      const last = videoRows(page).last();
      if ((await last.getByText('Stream gone').count()) !== 1) throw new Error('the gone video is not last');
      await search.fill('');
    });

    await page.evaluate(
      (song) =>
        localStorage.setItem(
          'karaoke-storage',
          JSON.stringify({
            state: {
              queue: [
                {
                  id: song.id,
                  song_title: song.song_title,
                  timestamp: song.timestamp,
                  created_at: song.created_at,
                  video_url: song.video_url,
                  title_text: song.title_text,
                  membership: song.membership,
                },
              ],
              history: [],
            },
            version: 0,
          }),
        ),
      gone,
    );
    await page.reload();
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, live)).click();
    await bar.getByRole('heading', { name: live.song_title }).waitFor();
    await stepForward.click();
    const toast = page.getByRole('status');
    await step('unavailable', 'a queued gone song gives a toast that names it', async () => {
      await toast.getByText(gone.song_title, { exact: false }).waitFor({ timeout: 60000 });
      await page.screenshot({ path: join(out, 'karaoke-skip-toast.png') });
    });
    await step('unavailable', 'the toast fits a 375px phone with a 16px gutter', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      const box = await toast.boundingBox();
      if (!box || box.x < 16 - 1 || box.x + box.width > 375 - 16 + 1) throw new Error(`toast box ${JSON.stringify(box)}`);
      await page.setViewportSize({ width: 1280, height: 800 });
    });
    await step('unavailable', 'the player lands on the first song of a live video', async () => {
      await videoLoads(
        page,
        liveFirsts.map((r) => r.video_url),
        { timeout: 60000 },
      );
      const landedId = await loadedVideoId(page);
      const landed = liveFirsts.find((r) => r.video_url === landedId);
      await bar.getByRole('heading', { name: landed.song_title }).waitFor({ timeout: 60000 });
      if ((await page.locator('iframe[src*="youtube"]').count()) !== 1) throw new Error('more than one player');
      if (await bar.getByText('This stream is gone').count()) throw new Error('the bar still shows the error');
    });
    await step('unavailable', 'the toast disappears on its own', () => toast.waitFor({ state: 'detached', timeout: 15000 }));
  },

  async loadRetry(page) {
    const { body: videos } = await pageVideos();
    const rows = songRows(videos);
    const row = rows[await findRowIndex(rows, isPublic)];
    const scriptRequests = () => page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('youtube.com/iframe_api')).length);
    await page.routeAbort('**/iframe_api*');
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, row)).click();
    const bar = page.locator('[data-player-bar]');
    const retry = bar.getByRole('button', { name: 'Retry', exact: true });
    await step('loadRetry', 'a YouTube script that cannot load leaves the song on the bar with a Retry button, and skips nothing', async () => {
      await retry.waitFor({ timeout: 15000 });
      await bar.getByRole('heading', { name: row.song_title }).waitFor();
      if (await bar.locator('button:not([role="switch"]) i.fa-pause, button:not([role="switch"]) i.fa-play').count()) throw new Error('the bar still offers play or pause for a song that did not load');
      if (await page.locator('[role="status"]').count()) throw new Error('a skip toast or a moving-on spinner shows for a load that failed');
      if (await page.locator(`${STREAMS} li [aria-disabled="true"], ${SETLIST} li [aria-disabled="true"]`).evaluateAll((els, title) => els.some((el) => el.textContent.includes(title)), row.song_title)) throw new Error('the song was disabled as gone');
      await page.screenshot({ path: join(out, 'load-retry-failed.png') });
    }, page);
    await step('loadRetry', 'the radio asks for the script again by itself three times, 2, 4 and 8 seconds apart, and then stops', async () => {
      await page.waitForFunction(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('youtube.com/iframe_api')).length >= 4, null, { timeout: 30000, polling: 250 });
      await page.waitForTimeout(12000);
      const requests = await scriptRequests();
      if (requests !== 4) throw new Error(`${requests} requests for the script, expected the first and three retries`);
      const starts = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('youtube.com/iframe_api')).map((entry) => entry.startTime));
      const gaps = starts.slice(1).map((start, i) => Math.round((start - starts[i]) / 1000));
      if (gaps.join() !== '2,4,8') throw new Error(`the retries came ${gaps} seconds apart`);
      await retry.waitFor();
      await bar.getByRole('heading', { name: row.song_title }).waitFor();
    }, page);
    await page.unroute('**/iframe_api*');
    await step('loadRetry', 'Retry, pressed from the keyboard once YouTube is reachable, loads the script again and plays the same song', async () => {
      await retry.focus();
      await page.keyboard.press('Enter');
      await playerReady(page);
      await videoLoads(page, [row.video_url], { startSeconds: secondsOf(row.timestamp) });
      await bar.locator('button:not([role="switch"]) i.fa-pause, button:not([role="switch"]) i.fa-play').first().waitFor({ timeout: 15000 });
      if (await retry.count()) throw new Error('Retry still shows after the song loaded');
      if ((await page.locator('iframe[src*="youtube"]').count()) !== 1) throw new Error('more than one player');
      if ((await scriptRequests()) !== 5) throw new Error(`${await scriptRequests()} requests for the script after one manual retry`);
      await bar.getByRole('heading', { name: row.song_title }).waitFor();
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage') ?? '{"state":{"history":[],"queue":[]}}').state);
      if (stored.history.length || stored.queue.length) throw new Error('the retries changed the queue or history');
      await page.screenshot({ path: join(out, 'load-retry-playing.png') });
    }, page);
  },

  async lyricsRetry(page) {
    const { body: videos } = await pageVideos();
    const video = videos.find((v) => !v.is_gone && v.karaoke_song.length >= 3);
    if (!video) throw new Error('no live video with three songs');
    const [first, second] = songRows([video]).toSorted((a, b) => secondsOf(a.timestamp) - secondsOf(b.timestamp));
    const lyricRequests = (songId) =>
      page.evaluate(
        (id) =>
          performance.getEntriesByType('resource').filter((entry) => {
            const url = new URL(entry.name);
            return url.pathname === '/api/get-lyrics' && url.searchParams.get('song') === id;
          }).length,
        String(songId),
      );
    const requestsReach = (songId, count, timeout) =>
      page
        .waitForFunction(
          ([id, want]) =>
            performance.getEntriesByType('resource').filter((entry) => {
              const url = new URL(entry.name);
              return url.pathname === '/api/get-lyrics' && url.searchParams.get('song') === id;
            }).length >= want,
          [String(songId), count],
          { timeout, polling: 250 },
        )
        .catch(async () => {
          throw new Error(`${await lyricRequests(songId)} lyrics requests for the song, wanted ${count} within ${timeout / 1000}s`);
        });
    const currentTime = () => page.evaluate(() => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).getCurrentTime());
    const waiting = page.locator('[data-lyrics-retry="Waiting"]').first();
    await page.routeBody('**/api/get-lyrics*', 'not lyrics');
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, first)).click();
    await playerReady(page);
    await playVideo(page);
    await videoLoads(page, [video.video_url], { startSeconds: secondsOf(first.timestamp), isPlaying: true });
    await page.locator('[data-player-bar]').getByRole('button', { name: 'Expand player' }).click();
    await step('lyricsRetry', 'lyrics that fail to load show a retry on its way, with a Try again button', async () => {
      await waiting.waitFor({ timeout: 15000 });
      await waiting.getByRole('button', { name: 'Try again' }).waitFor();
      await page.screenshot({ path: join(out, 'lyrics-retry-waiting.png') });
    }, page);
    await step('lyricsRetry', 'the radio fetches the sung song\'s lyrics again by itself while it is sung', async () => {
      await requestsReach(first.id, 2, 25000);
    }, page);
    let afterEnd = 0;
    await step('lyricsRetry', 'once the playhead passes the song\'s end, the radio stops retrying its lyrics', async () => {
      const target = secondsOf(second.timestamp) + 5;
      await page.evaluate((seconds) => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).seekTo(seconds, true), target);
      await page.waitForFunction((want) => window.YT.get(document.querySelector('iframe[src*="youtube"]').id).getCurrentTime() >= want - 1, target, { timeout: 15000 });
      await page.waitForTimeout(2000);
      afterEnd = await lyricRequests(first.id);
      await page.waitForTimeout(20000);
      const later = await lyricRequests(first.id);
      if (later !== afterEnd) throw new Error(`${later - afterEnd} lyrics requests for the first song after the playhead passed its end`);
      if ((await currentTime()) < target + 15) throw new Error('the video did not keep playing past the song');
    }, page);
    await step('lyricsRetry', 'going back to the song fetches its lyrics again at once', async () => {
      await barButton(page, 'fa-step-backward').click();
      await requestsReach(first.id, afterEnd + 1, 8000);
      await waiting.waitFor({ timeout: 10000 });
    }, page);
    await page.unroute('**/api/get-lyrics*');
    await step('lyricsRetry', 'Try again, once the server answers, replaces the retry with the lyrics', async () => {
      const before = await lyricRequests(first.id);
      await waiting.getByRole('button', { name: 'Try again' }).click();
      await requestsReach(first.id, before + 1, 15000);
      await page.waitForTimeout(1000);
      if (await page.locator('[data-lyrics-retry]').count()) throw new Error('the retry still shows after the server answered');
      await page.screenshot({ path: join(out, 'lyrics-retry-loaded.png') });
    }, page);
  },

  async fetchFailure(page) {
    await page.routeAbort('**/api/get-karaoke');
    await page.goto(BASE + '/');
    await step('fetchFailure', 'a failed fetch offers a retry instead of showing an empty list', async () => {
      await page.getByRole('button', { name: 'Try again' }).waitFor();
      if (await videoRows(page).count()) throw new Error('video rows show after a failed fetch');
    });
    await page.unroute('**/api/get-karaoke');
    await step('fetchFailure', 'try again recovers without a reload', async () => {
      await page.getByRole('button', { name: 'Try again' }).click();
      await videoRows(page).first().waitFor();
    });
  },

  async storage(page, context) {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.setItem('karaoke-storage', 'not json'));
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await step('storage', 'corrupt saved data starts with an empty queue', async () => {
      await page.getByRole('button', { name: 'Queue', exact: true }).click();
      await page.getByText('Queue is empty').first().waitFor();
    });
    await page.evaluate(() => localStorage.clear());

    const blockedTab = blockedStoragePage('storage');
    await blockedTab.goto(BASE + '/');
    await step('storage', 'karaoke works with storage blocked', async () => {
      const { body: blockedVideos } = await pageVideos();
      const blockedRows = songRows(blockedVideos);
      await videoRows(blockedTab).first().waitFor();
      await (await songRowOf(blockedTab, blockedVideos, blockedRows[await findRowIndex(blockedRows, isPublic)])).click();
      await blockedTab.locator('[data-player-bar] h3').first().waitFor();
    });
    await blockedTab.close();

    const { body: videos } = await pageVideos();
    const rows = songRows(videos);
    const firstIndex = rows.findIndex((s) => !s.is_gone);
    const otherIndex = rows.findIndex((s) => !s.is_gone && s.song_title !== rows[firstIndex].song_title);
    const tabB = await context.newPage();
    await tabB.goto(BASE + '/');
    await videoRows(tabB).first().waitFor();
    await (await songRowOf(tabB, videos, rows[firstIndex])).getByRole('button', { name: 'Add to Queue', exact: true }).click();
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, rows[otherIndex])).getByRole('button', { name: 'Add to Queue', exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.length);
    check('storage', "two tabs keep each other's queued songs", saved === 2, `${saved} saved`);
    await tabB.close();
  },

  async songs(page) {
    const { body: songbook } = await api('/api/get-songbook');
    check('songs', 'the api serves songs and requests from the sheet', songbook.songs.length > 0 && songbook.requests.length > 0, `${songbook.songs.length} songs, ${songbook.requests.length} requests`);
    await page.goto(BASE + '/');
    await page.getByRole('link', { name: 'Song list' }).click();
    await page.getByRole('heading', { name: 'Songs Fiona can sing' }).waitFor();
    check('songs', 'the radio header links to /songs', new URL(await page.url()).pathname === '/songs');
    const rows = page.locator('main li');
    await rows.first().waitFor();
    const shown = await rows.count();
    check('songs', 'every song and request is listed', shown === songbook.songs.length + songbook.requests.length, `${shown} rows`);
    check('songs', 'the tab title names the page', (await page.title()) === 'Songs | Fio Radio');
    await page.screenshot({ path: join(out, 'songs.png'), fullPage: true });
    await step('songs', 'the page is one screen tall and only the song list scrolls', async () => {
      const layout = await page.evaluate(() => {
        const list = document.querySelector('main .overflow-y-auto');
        return { page: document.documentElement.scrollHeight, inner: innerHeight, listScrolls: list.scrollHeight > list.clientHeight };
      });
      if (layout.page > layout.inner || !layout.listScrolls) throw new Error(JSON.stringify(layout));
    });
    const notesButton = page.getByRole('button', { name: /^lagi nyatet jangan ditagih/ });
    const notesDialog = page.getByRole('dialog');
    const focusedId = () => page.evaluate(() => document.activeElement?.id);
    await step('songs', 'lagi nyatet opens a centered popup with every catatan song, and Escape returns focus to the button', async () => {
      await notesButton.click();
      await notesDialog.waitFor();
      await page.waitForTimeout(300);
      const listed = await notesDialog.locator('li').count();
      if (listed !== songbook.notes.length) throw new Error(`${listed} of ${songbook.notes.length} notes listed`);
      if ((await focusedId()) !== 'songbook-notes-panel') throw new Error(`focus is on ${await focusedId()}`);
      const box = await notesDialog.boundingBox();
      if (Math.abs(box.x + box.width / 2 - 640) > 2 || Math.abs(box.y + box.height / 2 - 400) > 2) throw new Error(`popup box ${JSON.stringify(box)}`);
      await page.screenshot({ path: join(out, 'songs-notes-desktop.png') });
      await page.keyboard.press('Escape');
      await notesDialog.waitFor({ state: 'detached' });
      if ((await focusedId()) !== 'songbook-notes-button') throw new Error(`focus is on ${await focusedId()}`);
    });
    await step('songs', 'on a phone the popup slides up as a bottom sheet and a tap on the backdrop closes it', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      try {
        await notesButton.click();
        await notesDialog.waitFor();
        const animation = await notesDialog.evaluate((el) => getComputedStyle(el).animationName);
        if (animation !== 'sheet-up') throw new Error(`animation is ${animation}`);
        await page.waitForTimeout(400);
        const box = await notesDialog.boundingBox();
        if (box.x !== 0 || box.width !== 375 || Math.abs(box.y + box.height - 667) > 1) throw new Error(`sheet box ${JSON.stringify(box)}`);
        await page.screenshot({ path: join(out, 'songs-notes-375.png') });
        await page.mouse.click(187, 10);
        await notesDialog.waitFor({ state: 'detached' });
      } finally {
        await page.setViewportSize({ width: 1280, height: 800 });
      }
    });
    const pick = songbook.songs[songbook.songs.length - 1].title;
    await page.getByRole('searchbox', { name: 'Search songs' }).fill(pick);
    await step('songs', 'searching hides the songs that do not match', () => page.waitForFunction((all) => document.querySelectorAll('main li').length < all, shown));
    check('songs', 'searching keeps the matching song', (await page.locator('main li', { hasText: pick }).count()) > 0, `${await rows.count()} rows for "${pick}"`);
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('zzzzqqq');
    await step('songs', 'a search with no match shows no songs', () => page.waitForFunction(() => document.querySelectorAll('main li').length === 0));
    await page.getByRole('link', { name: 'Fio Radio' }).click();
    await videoRows(page).first().waitFor();
    check('songs', 'the page links back to the radio', new URL(await page.url()).pathname === '/');
    check('songs', '/songs answers 200 on a cold load', (await rawRequest('/songs')).status === 200);
  },

  async navigation(page) {
    await page.goto(BASE + '/nope');
    await step('navigation', 'an unknown path shows the 404 page', () => page.getByRole('link', { name: 'Back to Fio Radio' }).waitFor());
    await page.getByRole('link', { name: 'Back to Fio Radio' }).click();
    await videoRows(page).first().waitFor();
    check('navigation', 'the 404 link returns to the radio at /', new URL(await page.url()).pathname === '/');
    await page.goBack();
    await page.getByRole('link', { name: 'Back to Fio Radio' }).waitFor();
    check('navigation', 'browser back returns to the 404 page', (await page.url()).endsWith('/nope'));
  },

  async paths() {
    for (const path of ['/radio', '/karaoke', '/cover', '/about', '/credits']) {
      const moved = await rawRequest(`${path}?x=1`);
      check('paths', `${path} redirects to / with its query`, moved.status === 301 && moved.headers.location === '/?x=1', `${moved.status} ${moved.headers.location}`);
    }
    check('paths', '/ answers 200', (await rawRequest('/')).status === 200);
    const statusOf = async (path, init) => (await rawRequest(path, init)).status;
    for (const path of ['/nope', '/..%2f..%2fpackage.json', '/%E0%A4%A', '/%FF', '//', '/robots.txt/x.js', '/a%00.js']) {
      check('paths', `${path} answers 404`, (await statusOf(path)) === 404);
    }
    check('paths', 'the server survives those requests', (await statusOf('/')) === 200);
    const slash = await rawRequest('/radio/');
    check('paths', 'a trailing slash redirects', slash.status === 308 && slash.headers.location === '/radio', slash.headers.location);
    const offsite = await rawRequest('/.//evil.example/');
    check('paths', 'a redirect cannot leave the site', !String(offsite.headers.location).startsWith('//'), offsite.headers.location);
    const range = await rawRequest('/pio_karaoke.webp', {
      headers: { Range: 'bytes=0-1' },
    });
    check('paths', 'a static file answers a range request', range.status === 206 && range.headers['content-range']?.startsWith('bytes 0-1/'));
    const first = await rawRequest('/api/get-karaoke');
    const again = await rawRequest('/api/get-karaoke', {
      headers: { 'If-None-Match': first.headers.etag },
    });
    check('paths', 'unchanged data answers 304', first.status === 200 && again.status === 304);
  },

  async info(page) {
    const infoButton = page.getByRole('button', { name: 'About Fio Radio' });
    const dialog = page.getByRole('dialog');
    const focusedId = () => page.evaluate(() => document.activeElement?.id);
    const panelFits = () =>
      dialog.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, page: document.documentElement.scrollWidth, inner: innerWidth, innerHeight };
      });
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await step('info', 'the header has an info button and no back arrow to a home page', async () => {
      const box = await infoButton.boundingBox();
      if (!box || box.width < 40 || box.height < 40) throw new Error(`info button box ${JSON.stringify(box)}`);
      if (await page.locator('header a:has(i.fa-arrow-left)').count()) throw new Error('a back link is still there');
    });
    await infoButton.click();
    await dialog.waitFor();
    await step('info', 'opening the panel labels the dialog, moves focus into it and shows both sections', async () => {
      if ((await dialog.getAttribute('aria-modal')) !== 'true') throw new Error('aria-modal is not true');
      const labelledBy = await dialog.getAttribute('aria-labelledby');
      if (!labelledBy || !(await page.locator(`#${labelledBy}`).textContent()).includes('About Fio Radio')) throw new Error('aria-labelledby does not name the title');
      if ((await focusedId()) !== 'karaoke-info-panel') throw new Error(`focus is on ${await focusedId()}`);
      await dialog.getByRole('heading', { name: 'Who is Fiona' }).waitFor();
      await dialog.getByRole('heading', { name: 'Credits' }).waitFor();
      if ((await infoButton.getAttribute('aria-expanded')) !== 'true') throw new Error('aria-expanded is not true');
    });
    await step('info', 'every link opens a new tab safely and the profile links are present', async () => {
      const links = await dialog.locator('a').evaluateAll((els) => els.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
      const bad = links.filter((l) => l.target !== '_blank' || !l.rel.includes('noopener') || !l.rel.includes('noreferrer'));
      if (bad.length) throw new Error(`unsafe links ${JSON.stringify(bad.slice(0, 2))}`);
      for (const href of ['https://www.youtube.com/@FionaClearesta', 'https://twitter.com/FionaClearesta', 'https://virtualyoutuber.fandom.com/id/wiki/Fiona_Clearesta', 'https://discord.gg/vwfzuDFJA2']) {
        if (!links.some((l) => l.href === href)) throw new Error(`no link to ${href}`);
      }
    });
    await step('info', 'each credit shows what it is for, and the artwork images load', async () => {
      await dialog.locator('img').evaluateAll((imgs) =>
        Promise.all(imgs.map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; })))),
      );
      const rows = await dialog.locator('ul > li:has(> div:first-child)').evaluateAll((els) =>
        els.map((li) => ({
          name: li.innerText.trim().split(/\s{2,}|\n/)[0],
          icon: !!li.querySelector('i.fas'),
          images: [...li.querySelectorAll('img')].map((img) => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 })),
        })),
      );
      if (rows.length !== 7) throw new Error(`expected 7 credit rows, got ${rows.length}`);
      const bare = rows.filter((r) => !r.icon && !r.images.length);
      if (bare.length) throw new Error(`no mark for ${bare.map((r) => r.name)}`);
      const broken = rows.flatMap((r) => r.images).filter((i) => !i.loaded);
      if (broken.length) throw new Error(`images did not load ${JSON.stringify(broken)}`);
      const emoticons = rows.find((r) => r.name.includes('handryaraart'))?.images.length;
      if (emoticons !== 4) throw new Error(`handryaraart shows ${emoticons} emoticons`);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, 'info-desktop.png') });
    await step('info', 'Escape closes the panel and returns focus to the info button', async () => {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      if ((await focusedId()) !== 'karaoke-info-button') throw new Error(`focus is on ${await focusedId()}`);
    });
    await step('info', 'the Close button closes it and returns focus to the info button', async () => {
      await infoButton.click();
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await dialog.waitFor({ state: 'detached' });
      if ((await focusedId()) !== 'karaoke-info-button') throw new Error(`focus is on ${await focusedId()}`);
    });
    await step('info', 'a click on the backdrop closes it and a click inside the panel does not', async () => {
      await infoButton.click();
      await dialog.waitFor();
      await dialog.getByRole('heading', { name: 'Credits' }).click();
      await page.waitForTimeout(200);
      if (!(await dialog.count())) throw new Error('a click inside closed the panel');
      await page.mouse.click(5, 5);
      await dialog.waitFor({ state: 'detached' });
      if ((await focusedId()) !== 'karaoke-info-button') throw new Error(`focus is on ${await focusedId()}`);
    });
    await step('info', 'the panel sits above the player bar and the search stays usable after closing', async () => {
      const { body: videos } = await pageVideos();
      const rows = songRows(videos);
      await (await songRowOf(page, videos, rows[await findRowIndex(rows, isPublic)])).click();
      await page.locator('[data-player-bar] h3').first().waitFor();
      await infoButton.click();
      await dialog.waitFor();
      const barOnTop = await page.evaluate(() => {
        const bar = document.querySelector('[data-player-bar]').getBoundingClientRect();
        const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
        return hit?.closest('[data-player-bar]') ? `${hit.tagName}.${hit.className}`.slice(0, 120) : '';
      });
      if (barOnTop) throw new Error(`the player bar is above the panel overlay: ${barOnTop}`);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await page.getByPlaceholder('Search songs...').fill('x');
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await infoButton.click();
    await dialog.waitFor();
    await page.waitForTimeout(300);
    await step('info', 'at 375px the panel fits the screen and the page does not scroll sideways', async () => {
      const f = await panelFits();
      if (f.left < 0 || f.right > 375 || f.top < 0 || f.bottom > f.innerHeight || f.page > 375) throw new Error(JSON.stringify(f));
      await page.screenshot({ path: join(out, 'info-375.png') });
    });
    await step('info', 'at 375px the panel scrolls to the end and the Close button stays visible', async () => {
      const closeButton = dialog.getByRole('button', { name: 'Close' });
      const scrolled = await dialog.evaluate((el) => {
        const scrollable = el.scrollHeight > el.clientHeight;
        el.scrollTop = el.scrollHeight;
        return { scrollable, top: el.scrollTop };
      });
      if (!scrolled.scrollable || scrolled.top === 0) throw new Error(JSON.stringify(scrolled));
      await page.waitForTimeout(200);
      const box = await closeButton.boundingBox();
      if (!box || box.width < 40 || box.height < 40 || box.x < 0 || box.x + box.width > 375 || box.y < 0 || box.y + box.height > 667) throw new Error(`close box ${JSON.stringify(box)}`);
      await dialog.getByText('Maroon', { exact: true }).waitFor();
      await page.screenshot({ path: join(out, 'info-375-scrolled.png') });
      await closeButton.click();
      await dialog.waitFor({ state: 'detached' });
    });
  },

  async volume(page) {
    const { body: videos } = await pageVideos();
    const singles = videos.filter((v) => isSingleSong(videos, v.video_url));
    const slider = page.locator('input[aria-label="Volume"]:visible');
    const volumeOf = () =>
      page.evaluate(() => {
        const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id);
        return { level: p.getVolume(), muted: p.isMuted() };
      });
    const volumeBecomes = (want) =>
      page.waitForFunction(
        ([level, muted]) => {
          const frame = document.querySelector('iframe[src*="youtube"]');
          const p = frame && window.YT.get(frame.id);
          return Boolean(p?.getVolume) && p.getVolume() === level && p.isMuted() === muted;
        },
        want,
        { timeout: 10000 },
      );
    const playSingle = async (video) => {
      await videoRows(page).first().waitFor();
      await videoRow(page, videos, video.video_url).locator('button').first().click();
      await playerReady(page);
    };
    await page.goto(BASE + '/');
    await playSingle(singles[0]);
    await step('volume', 'the slider sets the real player volume, with a 40px target and a value text', async () => {
      const box = await slider.boundingBox();
      if (!box || box.height < 40) throw new Error(`slider ${JSON.stringify(box)}`);
      await slider.fill('30');
      await volumeBecomes([30, false]);
      await page.waitForFunction(() => document.querySelector('input[aria-label="Volume"]').getAttribute('aria-valuetext') === '30 percent', null, { timeout: 5000 }).catch(() => { throw new Error('no value text'); });
      await page.screenshot({ path: join(out, 'volume-bar.png') });
    });
    await step('volume', 'mute silences the player and keeps the level, and the slider above 0 unmutes', async () => {
      await page.getByRole('button', { name: 'Mute', exact: true }).click();
      await volumeBecomes([30, true]);
      await page.getByRole('button', { name: 'Unmute', exact: true }).waitFor();
      await slider.fill('60');
      await volumeBecomes([60, false]);
      await slider.fill('0');
      await page.getByRole('button', { name: 'Unmute', exact: true }).waitFor();
      await slider.fill('60');
    });
    await step('volume', 'the next song keeps the volume', async () => {
      await playSingle(singles[1]);
      await volumeBecomes([60, false]);
    });
    await step('volume', 'the volume survives a reload', async () => {
      await page.getByRole('button', { name: 'Mute', exact: true }).click();
      await page.reload();
      await playSingle(singles[0]);
      await volumeBecomes([60, true]);
      if ((await slider.inputValue()) !== '0') throw new Error('a muted slider should read 0');
    });
    await step('volume', 'on a phone the bar has no volume controls, and the expanded player has the slider and mute', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      if (await slider.count()) throw new Error('the slider shows in the phone bar');
      if (await page.getByRole('button', { name: 'Unmute', exact: true }).count()) throw new Error('mute shows before the player opens');
      const title = await page.locator('[data-player-bar] h3').boundingBox();
      if (title.width < 100) throw new Error(`the bar title is ${title.width}px`);
      await page.screenshot({ path: join(out, 'volume-phone-bar.png') });
      await page.getByRole('button', { name: 'Expand player' }).first().click();
      await page.waitForTimeout(800);
      await slider.waitFor();
      const box = await page.getByRole('button', { name: 'Unmute', exact: true }).boundingBox();
      if (!box || box.width < 40 || box.height < 40) throw new Error(`mute ${JSON.stringify(box)}`);
      await page.screenshot({ path: join(out, 'volume-phone-expanded.png') });
    });
  },

  async mobilePlayer(page) {
    await page.setViewportSize({ width: 375, height: 667 });
    const { body: videos } = await pageVideos();
    const singles = [];
    for (const v of videos) {
      if (isSingleSong(videos, v.video_url) && !singles.some((s) => s.karaoke_song[0].song_title === v.karaoke_song[0].song_title)) singles.push(v);
    }
    if (singles.length < 4) throw new Error('need four single-song videos');
    const titleOf = (video) => video.karaoke_song[0].song_title;
    const bar = page.locator('[data-player-bar]');
    const full = page.locator('.fixed.z-50.inset-0');
    const queued = singles.slice(1, 4);
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await videoRow(page, videos, singles[0].video_url).locator('button').first().click();
    await bar.getByRole('heading', { name: titleOf(singles[0]) }).waitFor({ timeout: 10000 });
    for (const video of queued) {
      await videoRow(page, videos, video.video_url).getByRole('button', { name: 'Add to Queue', exact: true }).click();
    }
    await playerReady(page);
    await page.evaluate(() => {
      window.__frame = document.querySelector('iframe[src*="youtube"]');
      window.__frameSrc = window.__frame.src;
    });

    await step('mobilePlayer', 'the mini bar holds the title area, play/pause and next, with a title at least 180px wide', async () => {
      const buttons = bar.locator('button:visible');
      const icons = await buttons.evaluateAll((els) => els.map((el) => el.querySelector('i')?.className ?? 'overlay'));
      if (icons.length !== 3) throw new Error(`visible bar buttons ${JSON.stringify(icons)}`);
      if (!icons.some((c) => /fa-(pause|play)/.test(c)) || !icons.some((c) => c.includes('fa-step-forward'))) throw new Error(`icons ${JSON.stringify(icons)}`);
      for (const [selector, what] of [
        ['i.fa-step-backward', 'previous'],
        ['[role="switch"]', 'the autoplay switch'],
        ['input[aria-label="Volume"]', 'the volume slider'],
        ['button[aria-label^="Repeat"]', 'repeat'],
        ['button[aria-label="Mute"], button[aria-label="Unmute"]', 'mute'],
      ]) {
        if (await bar.locator(selector).locator('visible=true').count()) throw new Error(`${what} shows in the mini bar`);
      }
      const title = await bar.locator('h3').boundingBox();
      if (!title || title.width < 180) throw new Error(`title is ${title?.width}px wide`);
      for (const icon of ['fa-step-forward', 'fa-pause, i.fa-play']) {
        const box = await bar.locator(`button:has(i.${icon})`).first().boundingBox();
        if (!box || box.width < 40 || box.height < 40) throw new Error(`${icon} target ${JSON.stringify(box)}`);
      }
      await page.screenshot({ path: join(out, 'mobile-player-mini-bar.png') });
    });
    await step('mobilePlayer', 'tapping the bar opens the full player and hides the mini bar', async () => {
      await bar.getByRole('button', { name: 'Expand player' }).and(page.locator(':not([disabled])')).waitFor({ state: 'attached', timeout: 30000 });
      const title = await bar.locator('h3').boundingBox();
      await page.mouse.click(title.x + title.width / 2, title.y + title.height + 12);
      await full.getByRole('button', { name: /^Repeat: / }).waitFor({ state: 'visible' });
      await page.waitForTimeout(700);
      if (await bar.isVisible()) throw new Error('the mini bar still shows');
    });
    await step('mobilePlayer', 'the full player shows repeat, previous, play/pause, next, volume and an Up next header with a labeled Autoplay switch', async () => {
      for (const name of [/^Repeat: /, 'Previous song', /^(Play|Pause)$/, 'Next song']) {
        const box = await full.getByRole('button', { name }).boundingBox();
        if (!box || box.width < 48 || box.height < 48) throw new Error(`${name} target ${JSON.stringify(box)}`);
      }
      await full.locator('input[aria-label="Volume"]').waitFor({ state: 'visible' });
      await full.getByRole('heading', { name: 'Up next' }).waitFor({ state: 'visible' });
      const label = full.getByText('Autoplay', { exact: true });
      if (!(await label.isVisible())) throw new Error('the Autoplay text is not visible');
      const toggle = full.getByRole('switch', { name: 'Autoplay' });
      const before = await toggle.getAttribute('aria-checked');
      const flipped = before === 'true' ? 'false' : 'true';
      await toggle.click();
      await full.locator(`[role="switch"][aria-checked="${flipped}"]`).waitFor({ timeout: 5000 }).catch(() => {
        throw new Error(`aria-checked stayed ${before}`);
      });
      await toggle.click();
      await full.locator(`[role="switch"][aria-checked="${before}"]`).waitFor({ timeout: 5000 }).catch(() => {
        throw new Error('the switch did not toggle back');
      });
    });
    await step('mobilePlayer', 'the whole queue is listed, and the screenshot shows it', async () => {
      const rows = full.locator('button[aria-label^="Play "][aria-label$=" now"]');
      if ((await rows.count()) !== 3) throw new Error(`${await rows.count()} queued rows`);
      await page.screenshot({ path: join(out, 'mobile-player-full-queue.png') });
    });
    await step('mobilePlayer', 'collapsing brings the mini bar back and keeps the same video element', async () => {
      await full.locator('button:has(i.fa-chevron-down)').click();
      await bar.waitFor({ state: 'visible' });
      await page.waitForTimeout(600);
      const same = await page.evaluate(() => {
        const frame = document.querySelector('iframe[src*="youtube"]');
        return { sameElement: frame === window.__frame, sameSrc: frame.src === window.__frameSrc, count: document.querySelectorAll('iframe[src*="youtube"]').length };
      });
      if (!same.sameElement || !same.sameSrc || same.count !== 1) throw new Error(JSON.stringify(same));
    });
    await step('mobilePlayer', 'tapping a queued row in the full player plays it now', async () => {
      const title = await bar.locator('h3').boundingBox();
      await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2);
      await full.getByRole('heading', { name: 'Up next' }).waitFor({ state: 'visible' });
      await full.getByRole('button', { name: `Play "${titleOf(queued[1])}" now` }).click();
      await full.getByRole('heading', { level: 1, name: titleOf(queued[1]) }).waitFor({ timeout: 10000 });
      const left = await full.locator('button[aria-label^="Play "][aria-label$=" now"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      if (left.length !== 2 || left.some((l) => l.includes(titleOf(queued[1])))) throw new Error(`queue after play ${JSON.stringify(left)}`);
    });
    await step('mobilePlayer', 'removing every queued song empties the queue', async () => {
      for (const title of [titleOf(queued[0]), titleOf(queued[2])]) {
        await full.getByRole('button', { name: `Remove "${title}" from queue` }).click();
      }
      await page.waitForFunction(() => !document.querySelector('.fixed.z-50.inset-0 button[aria-label^="Remove "]'));
      await page.screenshot({ path: join(out, 'mobile-player-full-empty.png') });
    }, page);
    await step('mobilePlayer', 'the queue drawer header has the labeled Autoplay switch at 375px', async () => {
      await full.locator('button:has(i.fa-chevron-down)').click();
      await bar.waitFor({ state: 'visible' });
      await queueHandle(page).click();
      await page.waitForTimeout(500);
      const toggle = queueDrawerOf(page).getByRole('switch', { name: 'Autoplay' });
      if (!(await queueDrawerOf(page).getByText('Autoplay', { exact: true }).isVisible())) throw new Error('no visible label');
      const before = await toggle.getAttribute('aria-checked');
      await toggle.click();
      await queueDrawerOf(page).locator(`[role="switch"][aria-checked="${before === 'true' ? 'false' : 'true'}"]`).waitFor({ timeout: 5000 });
      await toggle.click();
      await page.getByRole('button', { name: 'Close queue' }).click();
    });
  },

  async mobile(page) {
    await page.setViewportSize({ width: 375, height: 667 });
    const { body: videos } = await pageVideos();
    const rows = songRows(videos);
    const noOverflow = () =>
      page.evaluate(() => {
        const scroller = [...document.querySelectorAll('nav[aria-label="Videos"], section[aria-label^="Setlist of"]')].find((el) => el.offsetParent);
        return {
          page: document.documentElement.scrollWidth,
          scroller: scroller.scrollWidth - scroller.clientWidth,
        };
      });
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await page.waitForTimeout(400);
    await step('mobile', 'the karaoke list fits a 375px phone', async () => {
      const w = await noOverflow();
      if (w.page > 375 || w.scroller > 0) throw new Error(JSON.stringify(w));
      await page.screenshot({ path: join(out, 'karaoke-list-375.png') });
    });
    await step('mobile', 'Add to Queue is icon-only, 40px, named exactly, and clear of the queue handle', async () => {
      const row = rows.find((r) => !r.is_gone && !isSingleSong(videos, r.video_url));
      const setlist = await openVideo(page, videos, row.video_url);
      const buttons = setlist.getByRole('button', {
        name: 'Add to Queue',
        exact: true,
      });
      const n = await buttons.count();
      if (n !== videos.find((v) => v.video_url === row.video_url).karaoke_song.length) throw new Error(`${n} buttons`);
      const handle = await queueHandle(page).boundingBox();
      for (let i = 0; i < n; i++) {
        await buttons.nth(i).scrollIntoViewIfNeeded();
        const box = await buttons.nth(i).boundingBox();
        if (box.width < 40 || box.height < 40) throw new Error(`button ${i} is ${box.width}x${box.height}`);
        if (box.x + box.width > handle.x) throw new Error(`button ${i} reaches x ${box.x + box.width}, the handle starts at ${handle.x}`);
        if (await buttons.nth(i).locator('span:visible').count()) throw new Error('the label is visible on a phone');
      }
      const w = await noOverflow();
      if (w.page > 375 || w.scroller > 0) throw new Error(`overflow ${JSON.stringify(w)}`);
    });
    await step('mobile', 'a search fits a 375px phone and shows M of N songs', async () => {
      await showList(page);
      await page.getByPlaceholder('Search songs...').fill('satu bulan');
      const want = expectedFor(videos, 'satu bulan');
      await streamCountIs(page, want.videos);
      await page.waitForTimeout(300);
      const w = await noOverflow();
      if (w.page > 375 || w.scroller > 0) throw new Error(JSON.stringify(w));
      if (
        (await page
          .locator(STREAMS)
          .getByText(/^\d+ match(es)?$/)
          .count()) !== want.videos
      )
        throw new Error('rows lack a match count');
      await scrollListToTop(page);
      await page.screenshot({ path: join(out, 'karaoke-search-375.png') });
      await videoRows(page).first().locator('button').first().click();
      await setlistOf(page)
        .getByText(/^\d+ of \d+ songs match · (Streamed|Released) \d{1,2} [A-Z][a-z]{2} \d{4}$/)
        .waitFor();
      await page.screenshot({ path: join(out, 'karaoke-setlist-375.png') });
      await page.getByRole('button', { name: 'All videos' }).click();
      await page.locator(STREAMS).waitFor({ state: 'visible' });
      await page.getByPlaceholder('Search songs...').fill('');
    });
    await step('mobile', 'the queue drawer has a visible 40px Close button that closes it', async () => {
      await queueHandle(page).click();
      await page.waitForTimeout(500);
      const close = page.getByRole('button', { name: 'Close queue' });
      const box = await close.boundingBox();
      if (!box || box.width < 40 || box.height < 40 || box.x < 0 || box.x + box.width > 375) throw new Error(`close box ${JSON.stringify(box)}`);
      await page.screenshot({ path: join(out, 'karaoke-queue-375.png') });
      await close.click();
      await page.waitForTimeout(500);
      const drawerBox = await queueDrawerOf(page).boundingBox();
      if (drawerBox.x < 375 - 1) throw new Error(`the drawer is still on screen at x ${drawerBox.x}`);
    });
    const singles = [];
    for (const v of videos) {
      if (isSingleSong(videos, v.video_url) && !singles.some((s) => s.karaoke_song[0].song_title === v.karaoke_song[0].song_title)) singles.push(v);
    }
    const multi = videos.find((v) => !v.is_gone && v.karaoke_song.length > 1);
    const barTitle = () => page.locator('[data-player-bar] h3');
    const queuedTitles = () => queueDrawerOf(page).locator('button[aria-label^="Play "][aria-label$=" now"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const rowOfVideo = (video) => videoRow(page, videos, video.video_url);
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await step('mobile', 'one tap on a single-song row plays it without leaving the video list', async () => {
      const [first] = singles;
      await rowOfVideo(first).locator('button').first().click();
      await barTitle().filter({ hasText: first.karaoke_song[0].song_title }).waitFor({ timeout: 10000 });
      if (!(await page.locator(STREAMS).isVisible())) throw new Error('the video list is gone');
      if (await setlistOf(page).isVisible()) throw new Error('a setlist opened');
      await page.screenshot({ path: join(out, 'mobile-single-tap-play.png') });
    });
    await step('mobile', 'a single-song row has its own Add to Queue button, and the queue drawer plays and removes queued songs', async () => {
      const [first, second] = singles;
      const addOf = (video) => rowOfVideo(video).getByRole('button', { name: 'Add to Queue', exact: true });
      const box = await addOf(first).boundingBox();
      if (!box || box.width < 40 || box.height < 40) throw new Error(`add button ${JSON.stringify(box)}`);
      await addOf(first).click();
      await addOf(second).click();
      await queueHandle(page).click();
      await page.waitForTimeout(500);
      const titleA = first.karaoke_song[0].song_title;
      const titleB = second.karaoke_song[0].song_title;
      const before = await queuedTitles();
      if (before.length !== 2) throw new Error(`queued ${JSON.stringify(before)}`);
      const removeBox = await page.getByRole('button', { name: `Remove "${titleB}" from queue` }).boundingBox();
      if (!removeBox || removeBox.width < 40 || removeBox.height < 40) throw new Error(`remove button ${JSON.stringify(removeBox)}`);
      await page.screenshot({ path: join(out, 'mobile-queue-actions.png') });
      await page.getByRole('button', { name: `Play "${titleB}" now` }).click();
      await barTitle().filter({ hasText: titleB }).waitFor({ timeout: 10000 });
      const afterPlay = await queuedTitles();
      if (afterPlay.length !== 1 || !afterPlay[0].includes(titleA)) throw new Error(`after play ${JSON.stringify(afterPlay)}`);
      await page.getByRole('button', { name: `Remove "${titleA}" from queue` }).click();
      await queueDrawerOf(page).getByText('Queue is empty').waitFor();
      await page.screenshot({ path: join(out, 'mobile-queue-emptied.png') });
    });
    await step('mobile', 'History has Queue all and per-song Add to Queue that put songs back in the queue', async () => {
      const titleA = singles[0].karaoke_song[0].song_title;
      await queueDrawerOf(page).getByRole('button', { name: 'Queue all' }).click();
      await queueDrawerOf(page).getByRole('button', { name: `Play "${titleA}" now` }).waitFor();
      await queueDrawerOf(page).getByRole('button', { name: `Remove "${titleA}" from queue` }).click();
      await queueDrawerOf(page).getByText('Queue is empty').waitFor();
      const historyAdd = queueDrawerOf(page).getByRole('button', { name: 'Add to Queue', exact: true }).first();
      await historyAdd.click();
      await queueDrawerOf(page).getByRole('button', { name: `Play "${titleA}" now` }).waitFor();
      await page.getByRole('button', { name: 'Close queue' }).click();
      await page.waitForTimeout(500);
    });
    await step('mobile', 'the player bar title is not cut to a stub and tapping it expands the player', async () => {
      const box = await barTitle().boundingBox();
      if (!box || box.width < 180) throw new Error(`title is ${box?.width}px wide`);
      await page.screenshot({ path: join(out, 'mobile-player-bar.png') });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole('button', { name: 'Collapse player' }).first().waitFor({ state: 'visible' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, 'mobile-player-expanded.png') });
      await page.goBack();
      await page.getByRole('button', { name: 'Expand player' }).first().waitFor({ state: 'visible' });
    });
    await step('mobile', 'the repeat button cycles Off, All, One and the mode survives a reload', async () => {
      const repeat = (mode) => page.getByRole('button', { name: `Repeat: ${mode}`, exact: true });
      await page.getByRole('button', { name: 'Expand player' }).first().click();
      const box = await repeat('Off').boundingBox();
      if (!box || box.width < 40 || box.height < 40) throw new Error(`repeat button ${JSON.stringify(box)}`);
      await repeat('Off').click();
      await repeat('All').click();
      await repeat('One').waitFor();
      await page.screenshot({ path: join(out, 'mobile-repeat-one.png') });
      await page.reload();
      await videoRows(page).first().waitFor();
      await rowOfVideo(singles[0]).locator('button').first().click();
      await page.getByRole('button', { name: 'Expand player' }).first().click();
      await page.getByRole('button', { name: 'Repeat: One', exact: true }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Repeat: One', exact: true }).click();
      await page.getByRole('button', { name: 'Repeat: Off', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Collapse player' }).first().click();
      await page.getByRole('button', { name: 'Expand player' }).first().waitFor({ state: 'visible' });
    });
    await step('mobile', 'Back from a setlist lands on the video list, still on the site', async () => {
      await showList(page);
      await rowOfVideo(multi).locator('button').first().click();
      await setlistOf(page).waitFor({ state: 'visible' });
      if (!(await page.url()).includes('v=')) throw new Error(`url ${await page.url()}`);
      await page.goBack();
      await page.locator(STREAMS).waitFor({ state: 'visible' });
      if (await setlistOf(page).isVisible()) throw new Error('the setlist is still open');
      if (!(await page.url()).startsWith(BASE)) throw new Error(`left the site: ${await page.url()}`);
    });
    await step('mobile', 'Back closes the queue drawer, still on the site', async () => {
      await queueHandle(page).click();
      await page.waitForTimeout(500);
      await page.goBack();
      await page.waitForTimeout(500);
      const drawerBox = await queueDrawerOf(page).boundingBox();
      if (drawerBox.x < 375 - 1) throw new Error(`the drawer is still on screen at x ${drawerBox.x}`);
      if (!(await page.url()).startsWith(BASE)) throw new Error(`left the site: ${await page.url()}`);
    });
    await step('mobile', 'closing a layer with its own button removes its history entry', async () => {
      const fresh = await page.context().newPage();
      await fresh.setViewportSize({ width: 375, height: 667 });
      await fresh.goto(BASE + '/');
      await videoRows(fresh).first().waitFor();
      const before = await fresh.evaluate(() => history.length);
      await videoRows(fresh).filter({ hasText: multi.video_title }).first().locator('button').first().click();
      await fresh.getByRole('button', { name: 'All videos' }).click();
      await fresh.locator(STREAMS).waitFor({ state: 'visible' });
      await fresh.waitForFunction((n) => !location.search, null);
      await fresh.goBack();
      if ((await fresh.url()).startsWith(BASE)) throw new Error(`a stale entry remains: ${await fresh.url()}`);
      await fresh.close();
      if (before < 1) throw new Error('no history');
    });
    await step('mobile', 'a link to one video opens its setlist, and an unknown id shows the list', async () => {
      await page.goto(`${BASE}/?v=${multi.video_url}`);
      await setlistOf(page).waitFor({ state: 'visible' });
      await page.screenshot({ path: join(out, 'mobile-direct-link.png') });
      await page.goto(`${BASE}/?v=does-not-exist`);
      await page.locator(STREAMS).waitFor({ state: 'visible' });
      if (await setlistOf(page).isVisible()) throw new Error('a setlist opened for an unknown id');
    });
  },

  async playlistOpen(page) {
    const songs = distinctByTitle(await livePlayables(), 3);
    const { id } = await createPlaylist('Verify open', songs);
    await page.goto(`${BASE}/p/${id}`);
    await step('playlist-open', 'the first song of the playlist starts with no question asked', async () => {
      await waitForBarSong(page, songs[0]);
      if (await page.locator('[role="dialog"]').isVisible()) throw new Error('a question was asked of an empty queue');
    }, page);
    await step('playlist-open', 'the rest of the playlist waits in the queue in order', async () => {
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('karaoke-storage') ?? '{"state":{"queue":[]}}').state.queue.length === 2);
      const queued = await savedQueueIds(page);
      if (queued.join() !== songs.slice(1).map((s) => s.id).join()) throw new Error(`queued ${queued.join()}`);
    }, page);
    await step('playlist-open', 'the link stays in the address bar and the playlist name is in the page title', async () => {
      if ((await pathOf(page)) !== `/p/${id}`) throw new Error(await pathOf(page));
      if (!(await page.title()).includes('Verify open')) throw new Error(await page.title());
    }, page);
    await step('playlist-open', 'the first song loads in the YouTube player', () => videoLoads(page, [songs[0].video_url]), page);
    await page.screenshot({ path: join(out, 'playlist-open.png') });
  },

  async playlistChoice(page) {
    const live = distinctByTitle(await livePlayables(), 5);
    const queued = live.slice(0, 2);
    const listed = live.slice(2, 5);
    const { id } = await createPlaylist('Verify choice', listed);
    const askOnExistingQueue = async () => {
      await page.goto(BASE + '/');
      await setSavedQueue(page, queued);
      await page.goto(`${BASE}/p/${id}`);
      await choiceButton(page, 'Replace').waitFor({ state: 'visible' });
    };
    await askOnExistingQueue();
    await step('playlist-choice', 'a saved queue makes the link ask, and nothing plays or changes meanwhile', async () => {
      if ((await savedQueueIds(page)).join() !== queued.map((s) => s.id).join()) throw new Error('the queue changed before an answer');
      if (await page.locator('[data-player-bar]').isVisible()) throw new Error('something started before the answer');
      await page.screenshot({ path: join(out, 'playlist-ask.png') });
    }, page);
    await choiceButton(page, 'Replace').click();
    await step('playlist-choice', 'Replace queue leaves only the playlist, and its first song plays', async () => {
      await waitForBarSong(page, listed[0]);
      await page.waitForFunction((want) => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.map((s) => s.id).join() === want, listed.slice(1).map((s) => s.id).join());
      if (await choiceButton(page, 'Replace').isVisible()) throw new Error('the question stayed open');
      await page.screenshot({ path: join(out, 'playlist-replace.png') });
    }, page);

    await askOnExistingQueue();
    await choiceButton(page, 'Append').click();
    await step('playlist-choice', 'Add to queue keeps the two queued songs first, then the playlist, and starts nothing', async () => {
      const want = [...queued, ...listed].map((s) => s.id).join();
      await page.waitForFunction((expected) => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.map((s) => s.id).join() === expected, want);
      if (await page.locator('[data-player-bar]').isVisible()) throw new Error('the player started');
      await page.screenshot({ path: join(out, 'playlist-append.png') });
    }, page);

    await askOnExistingQueue();
    await choiceButton(page, 'Cancel').click();
    await step('playlist-choice', 'Cancel leaves the queue unchanged and closes the question', async () => {
      await choiceButton(page, 'Replace').waitFor({ state: 'hidden' });
      if ((await savedQueueIds(page)).join() !== queued.map((s) => s.id).join()) throw new Error('the queue changed');
      await page.screenshot({ path: join(out, 'playlist-cancel.png') });
    }, page);

    await askOnExistingQueue();
    await page.getByRole('dialog').evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await step('playlist-choice', 'Escape answers like Cancel', async () => {
      await choiceButton(page, 'Replace').waitFor({ state: 'hidden' });
      if ((await savedQueueIds(page)).join() !== queued.map((s) => s.id).join()) throw new Error('the queue changed');
    }, page);
  },

  async playlistNavigation(page) {
    const songs = distinctByTitle(await livePlayables(), 5);
    const first = await createPlaylist('Verify navigation', songs.slice(0, 3));
    const second = await createPlaylist('Verify other', songs.slice(3, 5));
    const dialogOpen = () => page.locator('[role="dialog"]').isVisible();
    const queueNow = async () => (await savedQueueIds(page)).join();
    const wantQueue = songs.slice(1, 3).map((s) => s.id).join();
    await page.goto(`${BASE}/p/${first.id}`);
    await waitForBarSong(page, songs[0]);
    await page.waitForFunction((want) => JSON.parse(localStorage.getItem('karaoke-storage') ?? '{"state":{"queue":[]}}').state.queue.map((s) => s.id).join() === want, wantQueue);
    await page.getByRole('link', { name: 'Song list' }).click();
    await page.waitForFunction(() => location.pathname === '/songs');
    await page.goBack();
    await page.waitForFunction((id) => location.pathname === `/p/${id}` && document.title.includes('Verify navigation'), first.id);
    await step('playlist-navigation', 'Back to the opened link from the song list asks nothing and changes nothing', async () => {
      if (await dialogOpen()) throw new Error('the question came back');
      if ((await queueNow()) !== wantQueue) throw new Error(`queue ${await queueNow()}`);
      await page.waitForFunction((title) => document.querySelector('[data-player-bar] h3')?.textContent?.includes(title), songs[0].song_title);
    }, page);
    await page.reload();
    await page.waitForFunction(() => document.title.includes('Verify navigation'));
    await step('playlist-navigation', 'a reload of the opened link asks nothing and keeps the queue', async () => {
      if (await dialogOpen()) throw new Error('the question came back after a reload');
      if ((await queueNow()) !== wantQueue) throw new Error(`queue ${await queueNow()}`);
    }, page);
    await page.getByLabel('Add to Queue').first().click({ force: true });
    await page.waitForFunction((was) => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.length > was, wantQueue.split(',').length);
    await page.getByRole('link', { name: 'Song list' }).click();
    await page.waitForFunction(() => location.pathname === '/songs');
    await page.goBack();
    await step('playlist-navigation', 'the same link again after the visitor queued another song asks like any link and drops the playlist name from the title', async () => {
      await choiceButton(page, 'Replace').waitFor({ state: 'visible' });
      if ((await page.title()).includes('Verify navigation')) throw new Error('the title still names the playlist');
    }, page);
    await choiceButton(page, 'Cancel').click();
    await page.goto(`${BASE}/p/${second.id}`);
    await step('playlist-navigation', 'a different link still asks', () => choiceButton(page, 'Replace').waitFor({ state: 'visible' }), page);
  },

  async playlistSlowFetch() {
    const songs = distinctByTitle(await livePlayables(), 4);
    const { id } = await createPlaylist('Verify slow', songs.slice(0, 2));
    const slow = makeSession('slow', { launchArgs: ['--init-script', heldPlaylistScript] });
    const page = slow.page();
    const arrive = async () => {
      await page.evaluate(() => window.__releasePlaylists());
      await page.waitForFunction(() => window.__arrivedPlaylists >= 1);
    };
    const barSongIs = (song) => page.evaluate((title) => document.querySelector('[data-player-bar] h3')?.textContent?.includes(title) ?? false, song.song_title);
    await page.goto(`${BASE}/p/${id}`);
    await videoRows(page).first().waitFor();
    await page.waitForFunction(() => window.__heldPlaylists >= 1);
    await (await songRowOf(page, (await pageVideos()).body, songs[3])).click();
    await waitForBarSong(page, songs[3]);
    await arrive();
    await step('playlist-slow-fetch', 'a playlist that arrives after the visitor started a song asks first', () => choiceButton(page, 'Replace').waitFor({ state: 'visible' }), page);
    await step('playlist-slow-fetch', 'the song the visitor started keeps playing until they answer', async () => {
      if (!(await barSongIs(songs[3]))) throw new Error('the bar changed');
      if ((await savedQueueIds(page)).length !== 0) throw new Error('the queue changed');
    }, page);

    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/p/${id}`);
    await videoRows(page).first().waitFor();
    await page.waitForFunction(() => window.__heldPlaylists >= 1);
    await page.getByRole('link', { name: 'Song list' }).click();
    await page.waitForFunction(() => location.pathname === '/songs');
    await arrive();
    await sleepMs(500);
    await step('playlist-slow-fetch', 'a playlist that arrives after the visitor left the link loads nothing', async () => {
      if ((await savedQueueIds(page)).length !== 0) throw new Error('the playlist loaded into the queue');
      if (await page.locator('[data-player-bar]').isVisible()) throw new Error('a song started');
      if (await page.locator('[role="dialog"]').isVisible()) throw new Error('a question appeared on the song list');
    }, page);
  },

  async playlistFocus(page) {
    const live = distinctByTitle(await livePlayables(), 5);
    const { id } = await createPlaylist('Verify focus', live.slice(2, 5));
    await page.goto(BASE + '/');
    await setSavedQueue(page, live.slice(0, 2));
    await page.goto(`${BASE}/p/${id}`);
    await choiceButton(page, 'Replace').waitFor({ state: 'visible' });
    const focusedChoice = () => page.evaluate(() => document.activeElement?.getAttribute('data-playlist-choice') ?? `outside:${document.activeElement?.id || document.activeElement?.tagName}`);
    const cycle = async (key, want) => {
      const seen = [await focusedChoice()];
      for (let i = 0; i < want.length; i++) {
        await page.keyboard.press(key);
        seen.push(await focusedChoice());
      }
      return seen;
    };
    await step('playlist-focus', 'the question takes focus on its first choice', async () => {
      const at = await focusedChoice();
      if (at !== 'Replace') throw new Error(at);
    }, page);
    await step('playlist-focus', 'Tab cycles through the three choices and never leaves the question', async () => {
      const seen = await cycle('Tab', [1, 2, 3, 4]);
      if (seen.join() !== 'Replace,Append,Cancel,Replace,Append') throw new Error(seen.join());
    }, page);
    await step('playlist-focus', 'Shift+Tab cycles backward and wraps from the first choice to the last', async () => {
      await page.keyboard.press('Shift+Tab');
      const atFirst = await focusedChoice();
      await page.keyboard.press('Shift+Tab');
      const wrapped = await focusedChoice();
      if (atFirst !== 'Replace' || wrapped !== 'Cancel') throw new Error(`${atFirst} then ${wrapped}`);
    }, page);
    await page.keyboard.press('Escape');
    await step('playlist-focus', 'Escape cancels, leaves the queue alone and returns focus to the page', async () => {
      await choiceButton(page, 'Replace').waitFor({ state: 'hidden' });
      if ((await savedQueueIds(page)).join() !== live.slice(0, 2).map((s) => s.id).join()) throw new Error('the queue changed');
      await page.waitForFunction(() => document.activeElement?.id === 'karaoke-info-button');
    }, page);
  },

  async playlistGone(page) {
    const songs = distinctByTitle(await livePlayables(), 2);
    const created = await createPlaylist('Verify deleted', songs);
    await deletePlaylist(created);
    await page.goto(`${BASE}/p/${created.id}`);
    await step('playlist-gone', 'a deleted playlist link lands on / with the deleted toast and nothing queued', async () => {
      await page.locator(`[data-toast="PlaylistDeleted"]`).waitFor();
      if ((await pathOf(page)) !== '/') throw new Error(await pathOf(page));
      await videoRows(page).first().waitFor();
      if ((await savedQueueIds(page)).length !== 0) throw new Error('something was queued');
      await page.screenshot({ path: join(out, 'playlist-deleted.png') });
    }, page);
    await page.goto(`${BASE}/p/zzzzzzzz`);
    await step('playlist-gone', 'a link that never existed lands on / with the unknown toast', async () => {
      await page.locator(`[data-toast="PlaylistNotFound"]`).waitFor();
      if ((await pathOf(page)) !== '/') throw new Error(await pathOf(page));
      await videoRows(page).first().waitFor();
      await page.screenshot({ path: join(out, 'playlist-unknown.png') });
    }, page);
    await step('playlist-gone', 'a link whose id is not 8 letters and digits is the 404 page, not a playlist', async () => {
      const res = await fetch(`${BASE}/p/short`);
      if (res.status !== 404) throw new Error(`answered ${res.status}`);
      const ok = await fetch(`${BASE}/p/zzzzzzzz`);
      if (ok.status !== 200) throw new Error(`a well-formed link answered ${ok.status}`);
    });
    await step('playlist-gone', 'the toast clears itself', async () => {
      await page.goto(`${BASE}/p/zzzzzzzz`);
      await page.locator(TOAST).waitFor();
      await page.locator(TOAST).waitFor({ state: 'hidden', timeout: 15000 });
    }, page);
  },

  async playlistUnavailable(page) {
    const { body: videos } = await pageVideos();
    const goneSong = videos.filter((v) => v.is_gone).flatMap((v) => v.karaoke_song.map((song) => playable(v, song)))[0];
    if (!goneSong) throw new Error('the data has no gone or members-only song');
    const live = distinctByTitle(await livePlayables(), 2);
    const { id } = await createPlaylist('Verify unavailable', [live[0], goneSong, live[1]]);
    await page.goto(`${BASE}/p/${id}`);
    await step('playlist-unavailable', 'a gone song is left out of the queue and the toast says some were skipped', async () => {
      await page.locator(`[data-toast="PlaylistSongsUnavailable"]`).waitFor();
      await waitForBarSong(page, live[0]);
      const queued = await savedQueueIds(page);
      if (queued.join() !== live[1].id) throw new Error(`queued ${queued.join()}`);
      await page.screenshot({ path: join(out, 'playlist-unavailable.png') });
    }, page);
  },

  async playlistFallback(page) {
    const live = distinctByTitle(await livePlayables(), 2);
    const { id } = await createPlaylist('Verify fallback', live);
    const db = new DatabaseSync(PLAYLISTS_DB_PATH);
    const row = db.prepare('SELECT entries FROM playlists WHERE id = ?').get(id);
    if (!row) throw new Error(`playlist ${id} is not in ${PLAYLISTS_DB_PATH}: this journey edits the server's own database, so start the server with launch.sh or set PLAYLISTS_DB_PATH to the file the server uses`);
    const entries = JSON.parse(row.entries).map((entry, index) => (index === 1 ? { ...entry, songId: 'renumbered-away' } : entry));
    db.prepare('UPDATE playlists SET entries = ? WHERE id = ?').run(JSON.stringify(entries), id);
    db.close();
    await page.goto(`${BASE}/p/${id}`);
    await step('playlist-fallback', 'an entry with a stale song id still resolves by its video and timestamp', async () => {
      await waitForBarSong(page, live[0]);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('karaoke-storage') ?? '{"state":{"queue":[]}}').state.queue.length === 1);
      const queued = await savedQueueIds(page);
      if (queued.join() !== live[1].id) throw new Error(`queued ${queued.join()}`);
      if ((await page.locator(TOAST).count()) !== 0) throw new Error('a resolved entry was reported unavailable');
      await page.screenshot({ path: join(out, 'playlist-fallback.png') });
    }, page);
  },

  async playlistMobile(page) {
    await page.setViewportSize({ width: 375, height: 667 });
    const live = distinctByTitle(await livePlayables(), 4);
    const { id } = await createPlaylist('Verify mobile with a rather long playlist name to wrap', live.slice(0, 2));
    await page.goto(BASE + '/');
    await setSavedQueue(page, live.slice(2, 4));
    await page.goto(`${BASE}/p/${id}`);
    await choiceButton(page, 'Replace').waitFor({ state: 'visible' });
    await step('playlist-mobile', 'the question fits a 375px phone', async () => {
      if (!(await noSidewaysScroll(page))) throw new Error('the page scrolls sideways');
      const box = await page.getByRole('dialog').boundingBox();
      if (box.x < 0 || box.x + box.width > 375) throw new Error(JSON.stringify(box));
      await page.screenshot({ path: join(out, 'playlist-ask-375.png') });
    }, page);
    await choiceButton(page, 'Cancel').click();
    const gone = await createPlaylist('Verify mobile toast', live.slice(0, 1));
    await deletePlaylist(gone);
    await page.goto(`${BASE}/p/${gone.id}`);
    await step('playlist-mobile', 'the toast fits a 375px phone', async () => {
      await page.locator(TOAST).waitFor();
      if (!(await noSidewaysScroll(page))) throw new Error('the page scrolls sideways');
      const box = await page.locator(TOAST).boundingBox();
      if (box.x < 0 || box.x + box.width > 375) throw new Error(JSON.stringify(box));
      await page.screenshot({ path: join(out, 'playlist-toast-375.png') });
    }, page);
  },

  async playlistTiming(page) {
    const runs = Number(process.env.TIMING_RUNS ?? 10);
    const songs = distinctByTitle(await livePlayables(), 30);
    const { id } = await createPlaylist('Verify timing', songs);
    const timeToPlaying = async (path, firstVideo) => {
      await page.goto('about:blank');
      await page.evaluate(() => localStorage.clear()).catch(() => {});
      const started = Date.now();
      await page.goto(BASE + path);
      await videoLoads(page, firstVideo, { timeout: 60000 });
      return Date.now() - started;
    };
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const radioVideos = (await pageVideos()).body.filter((v) => !v.is_gone).map((v) => v.video_url);
    const radioSamples = [];
    const playlistSamples = [];
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.clear());
    for (let i = 0; i < runs; i++) {
      await page.goto(BASE + '/');
      await page.evaluate(() => localStorage.clear());
      playlistSamples.push(await timeToPlaying(`/p/${id}`, [songs[0].video_url]));
      const radioStart = Date.now();
      await page.goto(BASE + '/');
      await videoRows(page).first().waitFor();
      await (await songRowOf(page, (await pageVideos()).body, songs[0])).click();
      await videoLoads(page, radioVideos, { timeout: 60000 });
      radioSamples.push(Date.now() - radioStart);
    }
    console.log(`TIMING radio median ${median(radioSamples)} ms ${JSON.stringify(radioSamples)}`);
    console.log(`TIMING playlist median ${median(playlistSamples)} ms ${JSON.stringify(playlistSamples)}`);
    check('playlist-timing', 'both paths reach Playing', radioSamples.length === runs && playlistSamples.length === runs, `radio ${median(radioSamples)} ms, playlist ${median(playlistSamples)} ms`);
  },

  async playlistSave(page) {
    const songs = distinctByTitle(await livePlayables(), 6);
    const [h1, h2, playing, q1, q2, q3] = songs;
    const videos = (await pageVideos()).body;
    await page.goto(BASE + '/');
    await seedSession(page, [h2, h1], [q1, q2, q3]);
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, playing)).click();
    await waitForBarSong(page, playing);
    await openSaveDialog(page);
    await step(
      'playlist-save',
      'each source stores its own songs in play order',
      async () => {
        await page.screenshot({ path: join(out, 'save-dialog.png') });
        const want = {
          Queue: [q1, q2, q3],
          History: [h1, h2],
          Session: [h1, h2, playing, q1, q2, q3],
        };
        for (const [source, expected] of Object.entries(want)) {
          const { id } = await saveFrom(page, source, `Verify ${source}`);
          const stored = await storedIds(id);
          if (stored.join() !== expected.map((s) => s.id).join()) throw new Error(`${source} stored ${stored.join()}`);
          if (source === 'Session') await page.screenshot({ path: join(out, 'save-shared.png') });
          await dialogButton(page, 'Done').click();
          await openSaveDialog(page);
        }
      },
      page,
    );
    await step(
      'playlist-save',
      'a fancy name is cleaned and the saved playlist is remembered with its token',
      async () => {
        const { id } = await saveFrom(page, 'Queue', '  𝓕𝓲𝓸𝓷𝓪  ');
        const body = await (await fetch(`${BASE}/api/playlists/${id}`)).json();
        if (body.name !== 'Fiona') throw new Error(body.name);
        const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-my-playlists') ?? '[]'));
        if (!mine.some((o) => o.id === id && o.editToken)) throw new Error(JSON.stringify(mine));
      },
      page,
    );
    await dialogButton(page, 'Done').click();
    await step(
      'playlist-save',
      'a source with no songs is disabled and nothing is sent for it',
      async () => {
        const fresh = makeSession('save-empty').page();
        await fresh.goto(BASE + '/');
        await fresh.evaluate(() => localStorage.clear());
        await fresh.goto(BASE + '/');
        await openSaveDialog(fresh);
        for (const source of ['Queue', 'History', 'Session'])
          if (!(await sourceButton(fresh, source).isDisabled())) throw new Error(`${source} is enabled with no songs`);
        if (!(await dialogButton(fresh, 'Submit').isDisabled())) throw new Error('Save is enabled with no songs');
      },
      page,
    );
  },

  async playlistShare(page) {
    const songs = distinctByTitle(await livePlayables(), 3);
    await page.goto(BASE + '/');
    await setSavedQueue(page, songs);
    await page.goto(BASE + '/');
    await openSaveDialog(page);
    const { id, link } = await saveFrom(page, 'Queue', 'Rainy day Fio');
    await step(
      'playlist-share',
      'Copy puts only the view link on the clipboard',
      async () => {
        await page.evaluate(() => {
          window.__copied = [];
          const write = navigator.clipboard.writeText.bind(navigator.clipboard);
          navigator.clipboard.writeText = (text) => {
            window.__copied.push(text);
            return write(text).catch(() => {});
          };
        });
        await page.locator('[data-playlist-copy-target="View"]').click();
        await page.waitForFunction(() => window.__copied.length === 1);
        const copied = await page.evaluate(() => window.__copied);
        if (copied[0] !== link || copied[0].includes('#edit')) throw new Error(copied[0]);
        await page.locator('[data-playlist-copy="Copied"]').first().waitFor({ timeout: 5000 });
        await page.screenshot({ path: join(out, 'copy-link.png') });
      },
      page,
    );
    await step(
      'playlist-share',
      'the shown edit link carries the token and the view link does not',
      async () => {
        const edit = await page.locator('[data-playlist-link="Edit"] .select-all').innerText();
        if (!edit.startsWith(`${link}#edit=`)) throw new Error(edit);
      },
      page,
    );
    const other = makeSession('share-other').page();
    await other.goto(link);
    await step(
      'playlist-share',
      'a fresh browser opens the link and plays the same songs',
      async () => {
        await waitForBarSong(other, songs[0]);
        await other.waitForFunction(() => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.length === 2);
        const queued = await savedQueueIds(other);
        if (
          queued.join() !==
          songs
            .slice(1)
            .map((s) => s.id)
            .join()
        )
          throw new Error(queued.join());
        const owns = await other.evaluate(() => localStorage.getItem('karaoke-my-playlists'));
        if (owns) throw new Error('a plain link gave edit rights');
        if (await playlistAction(other, 'Rename').isVisible()) throw new Error('Rename is offered without the token');
      },
      other,
    );
    expectId(id);
  },

  async playlistEdit(page) {
    const songs = distinctByTitle(await livePlayables(), 4);
    await page.goto(BASE + '/');
    await setSavedQueue(page, songs.slice(0, 3));
    await page.goto(BASE + '/');
    await openSaveDialog(page);
    const { id, link, editLink } = await saveFrom(page, 'Queue', 'Edit me');
    await dialogButton(page, 'Done').click();
    const second = makeSession('edit-b').page();
    await second.goto(editLink);
    await step(
      'playlist-edit',
      'the edit link in a fresh session offers Rename and Delete, and the address bar drops the fragment',
      async () => {
        await playlistAction(second, 'Rename').waitFor();
        await playlistAction(second, 'Delete').waitFor();
        await second.waitForFunction(() => !location.hash);
        const url = await second.url();
        if (url.includes('edit=') || !url.endsWith(`/p/${id}`)) throw new Error(url);
        await second.screenshot({ path: join(out, 'edit-link.png') });
      },
      second,
    );
    await step(
      'playlist-edit',
      'Rename in one session shows in another after a reload',
      async () => {
        await rename(page, 'Renamed on A');
        await second.reload();
        await second.waitForFunction(() => document.title.includes('Renamed on A'));
        if (await choiceButton(second, 'Replace').isVisible()) throw new Error('the opened link asked again');
        await page.screenshot({ path: join(out, 'rename.png') });
      },
      second,
    );
    await step(
      'playlist-edit',
      'a stale edit shows the conflict toast and then holds the newer version',
      async () => {
        await rename(second, 'Renamed on B');
        await playlistAction(page, 'Rename').click();
        await page.locator('[data-playlist-field="name"]').fill('Stale from A');
        await dialogButton(page, 'Submit').click();
        await page.locator('[data-toast="PlaylistConflict"]').waitFor();
        await page.screenshot({ path: join(out, 'conflict.png') });
        await playlistAction(page, 'Rename').click();
        const shown = await page.locator('[data-playlist-field="name"]').inputValue();
        if (shown !== 'Renamed on B') throw new Error(`holds ${shown}`);
        await dialogButton(page, 'Cancel').click();
        const body = await (await fetch(`${BASE}/api/playlists/${id}`)).json();
        if (body.name !== 'Renamed on B') throw new Error(body.name);
      },
      page,
    );
    await step(
      'playlist-edit',
      'Update from queue replaces the stored songs with the queue',
      async () => {
        await playlistAction(second, 'Update').click();
        await second.screenshot({ path: join(out, 'update.png') });
        await dialogButton(second, 'Submit').click();
        await second.locator('[data-toast="PlaylistUpdated"]').waitFor();
        const queued = await savedQueueIds(second);
        const stored = await storedIds(id);
        if (queued.length === 0 || stored.join() !== queued.join()) throw new Error(`stored ${stored.join()} queue ${queued.join()}`);
      },
      second,
    );
    await step(
      'playlist-edit',
      'Delete in one session sends the other to / with the deleted toast',
      async () => {
        await playlistAction(second, 'Delete').click();
        await second.screenshot({ path: join(out, 'delete-confirm.png') });
        await dialogButton(second, 'Submit').click();
        await second.locator('[data-toast="PlaylistDeleted"]').waitFor();
        await page.goto(link);
        await page.locator('[data-toast="PlaylistDeleted"]').waitFor();
        if ((await pathOf(page)) !== '/') throw new Error(await pathOf(page));
        await page.screenshot({ path: join(out, 'delete.png') });
      },
      page,
    );
  },

  async playlistCopy(page) {
    const songs = distinctByTitle(await livePlayables(), 3);
    const original = await createPlaylist('Someone elses', songs);
    await page.goto(`${BASE}/p/${original.id}`);
    await playlistAction(page, 'SaveCopy').waitFor();
    await step(
      'playlist-copy',
      'Save a copy makes a new playlist the visitor owns and leaves the original alone',
      async () => {
        await page.screenshot({ path: join(out, 'copy-playlist-open.png') });
        await playlistAction(page, 'SaveCopy').click();
        const field = page.locator('[data-playlist-field="name"]');
        const name = await field.inputValue();
        if (name !== 'Someone elses (copy)') throw new Error(name);
        await page.screenshot({ path: join(out, 'copy-playlist.png') });
        await dialogButton(page, 'Submit').click();
        const link = await sharedLink(page);
        const id = link.split('/p/')[1];
        if (id === original.id) throw new Error('same id');
        const body = await (await fetch(`${BASE}/api/playlists/${id}`)).json();
        if (body.name !== name) throw new Error(body.name);
        if ((await storedIds(id)).join() !== songs.map((s) => s.id).join()) throw new Error('songs differ');
        const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-my-playlists') ?? '[]'));
        if (!mine.some((o) => o.id === id)) throw new Error('not remembered');
        if (mine.some((o) => o.id === original.id)) throw new Error('original is remembered');
        const old = await (await fetch(`${BASE}/api/playlists/${original.id}`)).json();
        if (old.name !== 'Someone elses' || old.version !== 1) throw new Error(`original changed: ${old.name} v${old.version}`);
        await page.screenshot({ path: join(out, 'copy-playlist-shared.png') });
      },
      page,
    );
  },

  async playlistNoStorage() {
    const page = blockedStoragePage('playlist-save');
    const songs = distinctByTitle(await livePlayables(), 1);
    const videos = (await pageVideos()).body;
    await page.goto(BASE + '/');
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, songs[0])).click();
    await waitForBarSong(page, songs[0]);
    await openSaveDialog(page);
    await step(
      'playlist-no-storage',
      'with storage blocked the save succeeds, the link shows, and the page says the edit link must be copied',
      async () => {
        const { link } = await saveFrom(page, 'Session', 'No storage');
        if (!link.includes('/p/')) throw new Error(link);
        await page.locator('[data-playlist-problem="NotRemembered"]').waitFor();
        await page.screenshot({ path: join(out, 'no-storage.png') });
      },
      page,
    );
  },

  async playlistLimit(page) {
    const port = 4619;
    const db = join(mkdtempSync(join(tmpdir(), 'verify-limit-')), 'p.db');
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/main.ts'], {
      cwd: join(dirname(fileURLToPath(import.meta.url)), '../../..'),
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        PLAYLISTS_DB_PATH: db,
        PLAYLISTS_IP_LIMIT_PER_HOUR: '1',
        DATABASE_PATH: join(dirname(fileURLToPath(import.meta.url)), '.run', 'karaoke.db'),
      },
      stdio: 'ignore',
    });
    try {
      const limited = `http://localhost:${port}`;
      for (let i = 0; i < 90; i++) {
        if ((await fetch(`${limited}/api/get-karaoke`).catch(() => null))?.ok) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      const songs = distinctByTitle(await livePlayables(), 2);
      await page.goto(limited + '/');
      await setSavedQueue(page, songs);
      await page.goto(limited + '/');
      await openSaveDialog(page);
      await saveFrom(page, 'Queue', 'First');
      await dialogButton(page, 'Done').click();
      await openSaveDialog(page);
      await step(
        'playlist-limit',
        'past the per-IP limit the dialog reports it and the queue is untouched',
        async () => {
          await page.locator('[data-playlist-source="Queue"]').click();
          await page.locator('[data-playlist-field="name"]').fill('Second');
          await dialogButton(page, 'Submit').click();
          await page.locator('[data-playlist-failure="RateLimited"]').waitFor();
          await page.screenshot({ path: join(out, 'limit.png') });
          const queued = await savedQueueIds(page);
          if (queued.join() !== songs.map((s) => s.id).join()) throw new Error('the queue changed');
          if (!(await dialogButton(page, 'Submit').isVisible())) throw new Error('the dialog closed');
        },
        page,
      );
    } finally {
      child.kill();
    }
  },

  async playlistSaveMobile(page) {
    await page.setViewportSize({ width: 375, height: 667 });
    const songs = distinctByTitle(await livePlayables(), 3);
    await page.goto(BASE + '/');
    await step(
      'playlist-save-mobile',
      'the header keeps Song list on one line beside Save, and an empty Save dialog says what to do first',
      async () => {
        await page.locator('[data-playlist-action="Save"]').waitFor();
        const lines = await page.evaluate(() => {
          const link = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Song list');
          const save = document.querySelector('[data-playlist-action="Save"]');
          const title = document.querySelector('h1').getBoundingClientRect();
          return {
            link: link.getBoundingClientRect().height,
            titleRight: title.right,
            titleWidth: title.width,
            saveLeft: save.getBoundingClientRect().left,
            titleClipped: document.querySelector('h1').scrollWidth > document.querySelector('h1').clientWidth,
          };
        });
        if (lines.link > 48) throw new Error(`Song list wraps: ${JSON.stringify(lines)}`);
        if (lines.titleRight + 8 > lines.saveLeft || lines.titleClipped) throw new Error(`title collides: ${JSON.stringify(lines)}`);
        await page.screenshot({ path: join(out, 'header-375.png') });
        await openSaveDialog(page);
        await page.locator('[data-playlist-problem="NothingToSave"]').waitFor();
        await dialogButton(page, 'Cancel').click();
      },
      page,
    );
    await setSavedQueue(page, songs);
    await page.goto(BASE + '/');
    await step(
      'playlist-save-mobile',
      'the save dialog, the shared dialog and the playlist bar fit a 375px phone',
      async () => {
        await openSaveDialog(page);
        await fitsPhone(page);
        await page.screenshot({ path: join(out, 'save-375.png') });
        await saveFrom(page, 'Queue', 'A rather long playlist name to wrap on a phone screen');
        await fitsPhone(page);
        await page.screenshot({ path: join(out, 'shared-375.png') });
        await dialogButton(page, 'Done').click();
        await page.locator('[data-playlist-bar]').waitFor();
        await fitsPhone(page);
        await page.screenshot({ path: join(out, 'bar-375.png') });
      },
      page,
    );
  },

  async playlistSaveTiming(page) {
    const runs = Number(process.env.TIMING_RUNS ?? 10);
    const songs = distinctByTitle(await livePlayables(), 5);
    const samples = [];
    for (let i = 0; i < runs; i++) {
      await page.goto(BASE + '/');
      await setSavedQueue(page, songs);
      await page.goto(BASE + '/');
      await openSaveDialog(page);
      await page.locator('[data-playlist-source="Queue"]').click();
      await page.locator('[data-playlist-field="name"]').fill(`Timing ${i}`);
      samples.push(
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const start = performance.now();
              new MutationObserver((_, observer) => {
                if (document.querySelector('[data-playlist-dialog="Shared"]')) {
                  observer.disconnect();
                  resolve(performance.now() - start);
                }
              }).observe(document.body, { childList: true, subtree: true });
              document.querySelector('[data-playlist-action="Submit"]').click();
            }),
        ),
      );
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`TIMING save-to-link median ${Math.round(median)} ms ${JSON.stringify(samples.map(Math.round))}`);
    check(
      'playlist-save-timing',
      'every Save to link stays under 300 ms',
      Math.max(...samples) < 300,
      `median ${Math.round(median)} ms, max ${Math.round(sorted.at(-1))} ms`,
    );
  },

  async api() {
    check('api', 'POST /api/get-karaoke is rejected', (await api('/api/get-karaoke', { method: 'POST' })).status === 405);
    const { body: videos } = await api('/api/get-karaoke');
    const mismatches = [];
    for (const v of videos) {
      const status = await videoStatus(v.video_url);
      const expected = status === 200 ? false : [401, 403, 404].includes(status) ? true : undefined;
      if (expected !== undefined && v.is_gone !== expected) mismatches.push(`${v.video_url} oembed ${status} is_gone ${v.is_gone}`);
    }
    check('api', 'is_gone matches oEmbed for every video', mismatches.length === 0 && videos.every((v) => typeof v.is_gone === 'boolean'), mismatches.slice(0, 3).join(' | '));
    for (const route of ['/api/get-cover', '/api/post-karaoke', '/api/update-cover', '/api/update-karaoke', '/api/webhook', '/input_video']) {
      check('api', `${route} no longer exists`, (await api(route, { method: 'GET' })).status === 404);
    }
  },

  async playlistDiscord(page) {
    const stack = await startDiscordStack();
    try {
      const songs = distinctByTitle(await livePlayables(), 4);
      const f = 'playlist-discord';
      const a = await startedSession('discord-a', stack.base, songs.slice(0, 3));
      await step(
        f,
        'a signed-out visitor is offered Connect Discord',
        async () => {
          await openMyPlaylists(a);
          await accountPanel(a, 'SignedOut').waitFor();
          await accountDialogAction(a, 'Connect').waitFor();
          await a.screenshot({ path: join(out, 'discord-connect.png') });
          await dialogButton(a, 'Done').click();
        },
        a,
      );
      const one = await saveQueueAs(a, 'Claim one');
      const two = await saveQueueAs(a, 'Claim two');
      await step(
        f,
        'connecting claims the playlists this browser held tokens for and lists them with the account name',
        async () => {
          await connectDiscord(a, stack.base);
          const name = await a.locator('[data-account-name]').innerText();
          if (name !== FAKE_USER.name) throw new Error(name);
          const shown = await listedIdsEventually(a, [one.id, two.id]);
          await a.screenshot({ path: join(out, 'discord-connected.png') });
          await a.screenshot({ path: join(out, 'discord-claim.png') });
          const mine = await a.evaluate(() => fetch('/api/playlists/mine').then((res) => res.json()));
          const claimed = mine.playlists.map((entry) => entry.id);
          if (![one.id, two.id].every((id) => claimed.includes(id))) throw new Error(`server lists ${claimed.join()} after the page showed ${shown.join()}`);
          await dialogButton(a, 'Done').click();
        },
        a,
      );
      const b = makeSession('discord-b').page();
      await b.goto(stack.base + '/');
      await b.locator('[data-playlist-action="Save"]').waitFor();
      await step(
        f,
        'a second browser with no tokens connects as the same user, lists the playlists and renames one',
        async () => {
          await connectDiscord(b, stack.base);
          await listedIdsEventually(b, [one.id, two.id]);
          await b.screenshot({ path: join(out, 'discord-other-browser-list.png') });
          await openFromList(b, one.id);
          if ((await barKind(b)) !== 'Owner') throw new Error('no owner actions without a token');
          const held = await b.evaluate(() => localStorage.getItem('karaoke-my-playlists'));
          if (held && JSON.parse(held).length) throw new Error(`browser B holds tokens ${held}`);
          await rename(b, 'Renamed from B');
          await b.screenshot({ path: join(out, 'discord-other-browser.png') });
          const stored = await (await fetch(`${stack.base}/api/playlists/${one.id}`)).json();
          if (stored.name !== 'Renamed from B') throw new Error(stored.name);
        },
        b,
      );
      await step(
        f,
        'a playlist deleted from the page while connected leaves a link that lands on / with the deleted toast',
        async () => {
          await playlistAction(b, 'Delete').click();
          await dialogButton(b, 'Submit').click();
          await b.locator('[data-toast="PlaylistDeleted"]').waitFor();
          if (new URL(await b.url()).pathname !== '/') throw new Error(await b.url());
          const c = makeSession('discord-link').page();
          await c.goto(`${stack.base}/p/${one.id}`);
          await c.locator('[data-toast="PlaylistDeleted"]').waitFor();
          if (new URL(await c.url()).pathname !== '/') throw new Error(await c.url());
          await c.screenshot({ path: join(out, 'discord-delete.png') });
        },
        b,
      );
      await step(
        f,
        'disconnecting leaves no account, ends the session, and token-held playlists stay editable',
        async () => {
          await openMyPlaylists(a);
          await accountDialogAction(a, 'Disconnect').click();
          await accountPanel(a, 'SignedOut').waitFor();
          const me = await a.evaluate(() => fetch('/api/auth/me').then((res) => res.status));
          if (me !== 401) throw new Error(`me answered ${me}`);
          await a.screenshot({ path: join(out, 'discord-disconnect.png') });
          await openFromList(a, two.id);
          if ((await barKind(a)) !== 'Owner') throw new Error('the token no longer edits');
        },
        a,
      );
      await step(
        f,
        'a different user sees a stranger playlist with no owner actions and Save a copy',
        async () => {
          await stack.actAs(OTHER_USER);
          const c = await startedSession('discord-c', stack.base);
          await connectDiscord(c, stack.base);
          await dialogButton(c, 'Done').click();
          await c.goto(`${stack.base}/p/${two.id}`);
          await c.locator('[data-playlist-bar]').waitFor();
          if ((await barKind(c)) !== 'Visitor') throw new Error('owner actions offered to a stranger');
          if ((await playlistAction(c, 'Rename').count()) !== 0) throw new Error('Rename offered');
          await playlistAction(c, 'SaveCopy').waitFor();
          await c.screenshot({ path: join(out, 'discord-not-owner.png') });
          await stack.actAs(FAKE_USER);
        },
        a,
      );
      await step(
        f,
        'a playlist made through the owner route appears after connecting and is editable',
        async () => {
          const made = await stack.createAs(FAKE_USER, 'Made by the bot', songs.slice(0, 2));
          const d = await startedSession('discord-d', stack.base);
          await connectDiscord(d, stack.base);
          await listedIdsEventually(d, [made.id]);
          await openFromList(d, made.id);
          if ((await barKind(d)) !== 'Owner') throw new Error('no owner actions');
          await rename(d, 'Renamed after the bot');
          await d.screenshot({ path: join(out, 'discord-bot-made.png') });
        },
        a,
      );
    } finally {
      stack.close();
    }
  },

  async playlistDiscordEdge(page) {
    const stack = await startDiscordStack();
    try {
      const songs = distinctByTitle(await livePlayables(), 2);
      const f = 'playlist-discord-edge';
      await step(
        f,
        'with storage blocked, connecting still works and the page does not crash',
        async () => {
          const blocked = await startedSession('discord-blocked', stack.base, undefined, { blocked: true });
          await connectDiscord(blocked, stack.base);
          await blocked.screenshot({ path: join(out, 'discord-no-storage.png') });
        },
        page,
      );
      await step(
        f,
        'a display name with markup shows as text and runs nothing',
        async () => {
          await stack.actAs({ id: OTHER_USER.id, name: '<img src=x onerror=window.__pwned=1>' });
          const x = await startedSession('discord-xss', stack.base);
          await connectDiscord(x, stack.base);
          const shown = await x.locator('[data-account-name]').innerText();
          if (shown !== '<img src=x onerror=window.__pwned=1>') throw new Error(shown);
          const hostile = await x.evaluate(() => ({ imgs: document.querySelectorAll('img[src="x"]').length, ran: window.__pwned === 1 }));
          if (hostile.imgs !== 0 || hostile.ran) throw new Error(JSON.stringify(hostile));
          await x.screenshot({ path: join(out, 'discord-xss.png') });
          await stack.actAs(FAKE_USER);
        },
        page,
      );
      await step(
        f,
        'at 375px the connected dialog and the header fit with no sideways scroll',
        async () => {
          const m = makeSession('discord-mobile', { viewport: { width: 375, height: 800 } }).page();
          await m.goto(stack.base + '/');
          await setSavedQueue(m, songs);
          await m.goto(stack.base + '/');
          await m.locator('[data-playlist-action="Save"]').waitFor();
          await saveQueueAs(m, 'A rather long playlist name that has to wrap on a phone');
          if (!(await noSidewaysScroll(m))) throw new Error('the header scrolls sideways');
          const header = await m.evaluate(() => ({
            titleRight: document.querySelector('h1').getBoundingClientRect().right,
            firstButtonLeft: document.querySelector('[data-playlist-action="Mine"]').getBoundingClientRect().left,
            titleClipped: document.querySelector('h1').scrollWidth > document.querySelector('h1').clientWidth,
          }));
          if (header.titleRight + 8 > header.firstButtonLeft || header.titleClipped) throw new Error(`title collides: ${JSON.stringify(header)}`);
          await connectDiscord(m, stack.base);
          if (!(await noSidewaysScroll(m))) throw new Error('the page scrolls sideways');
          const box = await m.locator('[data-playlist-dialog="Account"] [role="dialog"]').boundingBox();
          if (box.x < 0 || box.x + box.width > 375) throw new Error(JSON.stringify(box));
          await m.screenshot({ path: join(out, 'discord-mobile.png') });
        },
        page,
      );
    } finally {
      stack.close();
    }
  },

  async playlistDiscordFailure(page) {
    const stack = await startDiscordStack();
    try {
      const f = 'playlist-discord-failure';
      const songs = distinctByTitle(await livePlayables(), 2);
      const toastShows = async (p, reason, shot) => {
        await p.locator(`[data-toast="LoginFailed"][data-toast-reason="${reason}"]`).waitFor();
        const url = new URL(await p.url());
        if (url.pathname !== '/' || url.search) throw new Error(`the address bar kept ${url.pathname}${url.search}`);
        await p.locator('[data-playlist-action="Save"]').waitFor();
        await p.screenshot({ path: join(out, shot) });
      };
      await step(
        f,
        'Discord refusing the code lands on / with the refused toast and no session, and the radio keeps playing',
        async () => {
          await stack.refuseCodes(true);
          const p = await startedSession('discord-refused', stack.base, songs);
          await openMyPlaylists(p);
          await accountDialogAction(p, 'Connect').click();
          await toastShows(p, 'refused', 'discord-login-refused.png');
          const me = await p.evaluate(() => fetch('/api/auth/me').then((res) => res.status));
          if (me !== 401) throw new Error(`a session exists (${me})`);
          await stack.refuseCodes(false);
        },
        page,
      );
      await step(
        f,
        'a callback with a state this browser never started lands on / with the state toast',
        async () => {
          const p = await startedSession('discord-state', stack.base, songs);
          await p.goto(`${stack.base}/api/auth/discord/callback?code=x&state=forged`);
          await toastShows(p, 'state', 'discord-login-state.png');
        },
        page,
      );
      await step(
        f,
        'too many login attempts land on / with the limit toast',
        async () => {
          for (let i = 0; i < 40; i++) await fetch(`${stack.base}/api/auth/discord/start`, { redirect: 'manual' });
          const p = await startedSession('discord-limit', stack.base, songs);
          await p.goto(`${stack.base}/api/auth/discord/start`);
          await toastShows(p, 'limit', 'discord-login-limit.png');
        },
        page,
      );
    } finally {
      stack.close();
    }
  },

  async playlistDiscordUnavailable(page) {
    await step(
      'playlist-discord-unavailable',
      'a server without Discord login offers no Connect, lists local playlists and keeps the radio working',
      async () => {
        const songs = distinctByTitle(await livePlayables(), 2);
        const me = await api('/api/auth/me');
        if (me.status === 200) throw new Error('this server has a login configured');
        await page.goto(BASE + '/');
        await setSavedQueue(page, songs);
        await page.goto(BASE + '/');
        await page.locator('[data-playlist-action="Save"]').waitFor();
        await saveQueueAs(page, 'Local only');
        await openMyPlaylists(page);
        await page.locator('[data-my-playlist]').first().waitFor();
        if ((await page.locator('[data-playlist-action="Connect"]').count()) !== 0) throw new Error('Connect is offered');
        await page.screenshot({ path: join(out, 'discord-unavailable.png') });
        await dialogButton(page, 'Done').click();
      },
      page,
    );
    await step(
      'playlist-discord-unavailable',
      'a dead /api/auth route (an old server answers 404, a lost network aborts) reads as no account',
      async () => {
        const offline = makeSession('discord-offline').page();
        await offline.routeAbort('**/api/auth/**');
        await offline.goto(BASE + '/');
        await offline.locator('[data-playlist-action="Save"]').waitFor();
        await openMyPlaylists(offline);
        if ((await offline.locator('[data-playlist-action="Connect"]').count()) !== 0) throw new Error('Connect is offered');
        if ((await offline.locator('[data-account]').count()) !== 0) throw new Error('an account state shows');
      },
      page,
    );
  },

  async playlistDiscordTiming(page) {
    const stack = await startDiscordStack();
    try {
      const runs = Number(process.env.TIMING_RUNS ?? 10);
      const radioVideos = (await pageVideos()).body.filter((v) => !v.is_gone).map((v) => v.video_url);
      const songs = distinctByTitle(await livePlayables(), 1);
      const timeToPlaying = async (p) => {
        await p.goto('about:blank');
        const started = Date.now();
        await p.goto(stack.base + '/');
        await setSavedQueue(p, songs);
        await p.goto(stack.base + '/');
        await videoRows(p).first().waitFor();
        await (await songRowOf(p, (await pageVideos()).body, songs[0])).click();
        await videoLoads(p, radioVideos, { timeout: 60000 });
        return Date.now() - started;
      };
      const median = (values) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];
      const signedOut = [];
      const connected = [];
      const p = await startedSession('discord-timing', stack.base);
      for (let i = 0; i < runs; i++) {
        await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
        signedOut.push(await timeToPlaying(p));
        await connectDiscord(p, stack.base);
        await dialogButton(p, 'Done').click();
        connected.push(await timeToPlaying(p));
      }
      console.log(`TIMING signed out median ${median(signedOut)} ms ${JSON.stringify(signedOut)}`);
      console.log(`TIMING connected median ${median(connected)} ms ${JSON.stringify(connected)}`);
      check('playlist-discord-timing', 'both states reach Playing', signedOut.length === runs && connected.length === runs, `signed out ${median(signedOut)} ms, connected ${median(connected)} ms`);
    } finally {
      stack.close();
    }
  },
};

try {
  const count = await waitForGoneIds();
  check('setup', 'the server has learned which streams are gone', true, `${count} videos`);
} catch (e) {
  check('setup', 'the server has learned which streams are gone', false, e.message);
}
for (const [name, journey] of Object.entries(journeys)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const session = makeSession(name);
  const page = session.page();
  try {
    await journey(page, session.context());
  } catch (e) {
    check(name, 'journey completed', false, e.message.split('\n')[0]);
    await page.screenshot({ path: join(out, `${name}-failure.png`) }).catch(() => {});
  }
  const logged = [...(await page.pageErrors().catch(() => [])), ...(await page.consoleErrors().catch(() => []))];
  check(name, 'no page errors', logged.length === 0, logged.slice(0, 3).join(' | ').slice(0, 400));
  await Promise.all([...sessions].map((open) => open.close()));
  sessions.clear();
}

writeFileSync(join(out, 'results.json'), JSON.stringify({ base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed. evidence: ${out}`);
process.exit(failed ? 1 : 0);
