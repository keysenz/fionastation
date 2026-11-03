#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  return {
    status: res.status,
    body: res.status === 200 ? await res.json() : null,
  };
};

const STREAMS = 'nav[aria-label="Karaoke streams"]';
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
    await page.getByRole('button', { name: 'All streams' }).click();
    await page.locator(STREAMS).waitFor({ state: 'visible' });
  }
};
const queueDrawerOf = (page) => page.getByRole('heading', { name: 'Up Next' }).locator('xpath=../..');
const queueHandle = (page) => page.getByRole('button', { name: 'Queue', exact: true });
const autoplaySwitch = (page) => page.getByRole('switch', { name: 'Autoplay' });
const switchBecomes = (page, checked, message) =>
  page
    .locator(`[role="switch"][aria-label="Autoplay"][aria-checked="${checked}"]`)
    .waitFor({ timeout: 5000 })
    .catch(() => {
      throw new Error(message);
    });
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
const openVideo = async (page, videos, videoUrl) => {
  await showList(page);
  const button = videoRow(page, videos, videoUrl).locator('button');
  await button.click();
  await button.and(page.locator('[aria-current="true"]')).waitFor();
  await setlistOf(page).waitFor({ state: 'visible' });
  return setlistOf(page);
};
const songRowOf = async (page, videos, row) => {
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
  page.evaluate(() => {
    const p = window.YT.get(document.querySelector('iframe[src*="youtube"]').id);
    p.seekTo(Math.max(0, p.getDuration() - 2), true);
  });

const journeys = {
  async site(page) {
    await page.goto(BASE + '/');
    await page.getByRole('heading', { name: /Fiona/ }).waitFor();
    const bg = page.getByAltText('Background');
    await bg.waitFor();
    const loaded = await bg.evaluate(async (img) => {
      await img.decode().catch(() => {});
      return img.naturalWidth;
    });
    check('site', 'background image renders', loaded > 0, `naturalWidth ${loaded}`);
    await page.screenshot({ path: join(out, 'home.png') });
    for (const [label, heading] of [
      ['About', 'Fiona Clearesta'],
      ['Credits', 'Credits'],
    ]) {
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
    await videoRows(page).first().waitFor();
    check('karaoke', 'list shows one row per video', (await videoRows(page).count()) === videos.length, `${await videoRows(page).count()} rows`);
    const firstShown = displayOrder(videos)[0];
    check('karaoke', 'exactly one stream is selected on load', (await page.locator(`${STREAMS} [aria-current="true"]`).count()) === 1);
    check('karaoke', 'the setlist shows only the selected stream, not every stream', (await songRowsIn(setlistOf(page)).count()) === firstShown.karaoke_song.length, `${firstShown.karaoke_song.length} songs`);
    await page.screenshot({ path: join(out, 'karaoke-list.png') });

    const rows = songRows(videos);
    const aIndex = await findRowIndex(rows, isPublic);
    const bIndex = await findRowIndex(rows, async (s) => (await isPublic(s)) && s.song_title !== rows[aIndex].song_title);
    const cIndex = await findRowIndex(rows, async (s) => (await isPublic(s)) && s.song_title !== rows[aIndex].song_title && s.song_title !== rows[bIndex].song_title);
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

    const chosen = videos.filter((v) => !v.is_gone && v.karaoke_song.some((s) => s.song_title === shared)).at(-1);
    const chosenSong = chosen.karaoke_song.find((s) => s.song_title === shared);
    await videoRows(page).filter({ hasText: chosen.video_title }).first().locator('button').click();
    await songRowsIn(setlistOf(page)).filter({ hasText: shared }).first().click();
    const start = chosenSong.timestamp.split(':').reduce((t, part) => t * 60 + Number(part), 0);
    const chosenSrc = await playerSrc(page);
    check('karaoke', 'playing a song from a chosen video loads that video at its timestamp', chosenSrc.includes(`/embed/${chosen.video_url}`) && chosenSrc.includes(`start=${start}`), chosenSrc.slice(0, 100));
    await page.screenshot({ path: join(out, 'karaoke-search-played.png') });

    await search.fill('zzzqqqxxx');
    await page.getByText('No songs found').waitFor();
    check('karaoke', 'search shows an empty state', true);
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

    const other = displayOrder(videos).find((v) => v.video_url !== chosen.video_url);
    await openVideo(page, videos, other.video_url);
    const nowPlayingRow = videoRow(page, videos, chosen.video_url);
    check('karaoke', 'the video holding the current song is marked even when another stream is selected', (await nowPlayingRow.getByLabel('Now playing').count()) === 1 && (await nowPlayingRow.locator('[aria-current="true"]').count()) === 0);

    const rowA = await songRowOf(page, videos, a);
    await rowA.click();
    const bar = page.locator('.fixed.bottom-0');
    await bar.getByRole('heading', { name: a.song_title }).waitFor();
    const src = await playerSrc(page);
    check('karaoke', 'play opens the player at the song timestamp', src.includes(a.video_url) && src.includes('start='), src.slice(0, 90));

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
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, rows[start])).click();
    const bar = page.locator('.fixed.bottom-0');
    await bar.getByRole('heading', { name: rows[start].song_title }).waitFor();
    await playerReady(page);
    await page.evaluate(() => {
      window.__frame = document.querySelector('iframe[src*="youtube"]');
    });

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
      await page.evaluate(() => {
        const f = document.querySelector('iframe[src*="youtube"]');
        window.YT.get(f.id).pauseVideo();
      });
      await bar.locator('i.fa-play').waitFor({ timeout: 15000 });
    });
    await step('player', 'video end moves on to the next song of the same video', async () => {
      await playVideo(page);
      await seekNearEnd(page);
      await page.waitForFunction(
        () => {
          const f = document.querySelector('iframe[src*="youtube"]');
          return f && f !== window.__frame;
        },
        null,
        { timeout: 40000 },
      );
      await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();
      const seconds = nextRow.timestamp.split(':').reduce((t, part) => t * 60 + Number(part), 0);
      if (!(await playerSrc(page)).includes(`start=${seconds}`)) throw new Error(`player is not at start=${seconds}`);
    });
    check('player', 'only one player exists after moving on', (await page.locator('iframe[src*="youtube"]').count()) === 1);

    await step('player', 'the end of the last song of a video plays the first song of another live video', async () => {
      await (await songRowOf(page, videos, lastRow)).click();
      await bar.getByRole('heading', { name: lastRow.song_title }).waitFor();
      await playerReady(page);
      await page.evaluate(() => {
        window.__frame = document.querySelector('iframe[src*="youtube"]');
      });
      await playVideo(page);
      await playerState(page, 1);
      await seekNearEnd(page);
      await page.waitForFunction(
        () => {
          const f = document.querySelector('iframe[src*="youtube"]');
          return f && f !== window.__frame;
        },
        null,
        { timeout: 40000 },
      );
      const src = await playerSrc(page);
      const landed = otherFirsts.find((r) => src.includes(r.video_url));
      if (!landed) throw new Error(`player is on a video that is not another live one: ${src}`);
      const seconds = landed.timestamp.split(':').reduce((t, part) => t * 60 + Number(part), 0);
      if (!src.includes(`start=${seconds}`)) throw new Error(`player is not at the first song, start=${seconds}`);
      await bar.getByRole('heading', { name: landed.song_title }).waitFor();
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
      await playerState(page, 1);
      await seekNearEnd(page);
      await bar.locator('i.fa-play').waitFor({ timeout: 40000 });
      await bar.getByRole('heading', { name: nextRow.song_title }).waitFor();
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
      const blockedTab = await page.context().newPage();
      await blockedTab.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
      });
      await blockedTab.goto(BASE + '/karaoke');
      await videoRows(blockedTab).first().waitFor();
      await (await songRowOf(blockedTab, videos, rows[start])).click();
      await autoplaySwitch(blockedTab).waitFor();
      if ((await autoplaySwitch(blockedTab).getAttribute('aria-checked')) !== 'true') throw new Error('the switch is not on');
      await autoplaySwitch(blockedTab).click();
      await switchBecomes(blockedTab, false, 'the switch does not toggle');
      await blockedTab.close();
    });
  },

  async unavailable(page) {
    const { body: videos } = await api('/api/get-karaoke');
    const rows = songRows(videos);
    const goneIndex = rows.findIndex((r, i) => r.is_gone && rows.findIndex((x) => x.video_url === r.video_url) === i && rows.slice(i + 1).some((x) => !x.is_gone));
    if (goneIndex < 0) throw new Error('no gone song has a live song after it');
    const gone = rows[goneIndex];
    const liveIndex = rows.findIndex((r) => !r.is_gone);
    const live = rows[liveIndex];
    const liveFirsts = rows.filter((r, i) => !r.is_gone && r.video_url !== gone.video_url && rows.findIndex((x) => x.video_url === r.video_url) === i);
    const bar = page.locator('.fixed.bottom-0');
    const stepForward = barButton(page, 'fa-step-forward');

    await page.goto(BASE + '/karaoke');
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
      await page.waitForFunction(
        (urls) => urls.some((url) => document.querySelector('iframe[src*="youtube"]')?.src.includes(url)),
        liveFirsts.map((r) => r.video_url),
        { timeout: 60000 },
      );
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
      await videoRows(page).first().waitFor();
    });
    await page.route('**/api/get-cover', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[{"nope":1}]',
      }),
    );
    await page.goto(BASE + '/cover');
    await step('fetchFailure', 'data of the wrong shape is refused at the boundary', () => page.getByText('Could not load the covers').waitFor());
  },

  async storage(page, context) {
    await page.goto(BASE + '/');
    await page.evaluate(() => localStorage.setItem('karaoke-storage', 'not json'));
    await page.goto(BASE + '/karaoke');
    await videoRows(page).first().waitFor();
    await step('storage', 'corrupt saved data starts with an empty queue', async () => {
      await page.getByRole('button', { name: 'Queue', exact: true }).click();
      await page.getByText('Queue is empty').first().waitFor();
    });
    await page.evaluate(() => localStorage.clear());

    const blockedTab = await context.newPage();
    await blockedTab.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    for (const [path, text] of [
      ['/', 'Station'],
      ['/about', 'Fiona Clearesta'],
      ['/credits', 'Credits'],
    ]) {
      await blockedTab.goto(BASE + path);
      await step('storage', `${path} renders with storage blocked`, () => blockedTab.getByRole('heading', { name: text }).first().waitFor());
    }
    await blockedTab.goto(BASE + '/karaoke');
    await step('storage', 'karaoke works with storage blocked', async () => {
      const { body: blockedVideos } = await api('/api/get-karaoke');
      const blockedRows = songRows(blockedVideos);
      await videoRows(blockedTab).first().waitFor();
      await (await songRowOf(blockedTab, blockedVideos, blockedRows[await findRowIndex(blockedRows, isPublic)])).click();
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
    await videoRows(tabB).first().waitFor();
    await (await songRowOf(tabB, videos, rows[firstIndex])).getByRole('button', { name: 'Add to Queue', exact: true }).click();
    await page.getByRole('link', { name: 'Karaoke' }).click();
    await videoRows(page).first().waitFor();
    await (await songRowOf(page, videos, rows[otherIndex])).getByRole('button', { name: 'Add to Queue', exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke-storage')).state.queue.length);
    check('storage', "two tabs keep each other's queued songs", saved === 2, `${saved} saved`);
    await tabB.close();
  },

  async navigation(page) {
    await page.addInitScript(() => {
      window.__sounds = 0;
      const original = window.Audio.prototype.play;
      window.Audio.prototype.play = function play() {
        window.__sounds++;
        return original.call(this);
      };
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
    const range = await rawRequest('/piosayang.mp3', {
      headers: { Range: 'bytes=0-1' },
    });
    check('paths', 'audio answers a range request', range.status === 206 && range.headers['content-range']?.startsWith('bytes 0-1/'));
    const first = await rawRequest('/api/get-karaoke');
    const again = await rawRequest('/api/get-karaoke', {
      headers: { 'If-None-Match': first.headers.etag },
    });
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

    await page.setViewportSize({ width: 375, height: 667 });
    const { body: videos } = await api('/api/get-karaoke');
    const rows = songRows(videos);
    const noOverflow = () =>
      page.evaluate(() => {
        const scroller = [...document.querySelectorAll('nav[aria-label="Karaoke streams"], section[aria-label^="Setlist of"]')].find((el) => el.offsetParent);
        return {
          page: document.documentElement.scrollWidth,
          scroller: scroller.scrollWidth - scroller.clientWidth,
        };
      });
    await page.goto(BASE + '/karaoke');
    await videoRows(page).first().waitFor();
    await page.waitForTimeout(400);
    await step('mobile', 'the karaoke list fits a 375px phone', async () => {
      const w = await noOverflow();
      if (w.page > 375 || w.scroller > 0) throw new Error(JSON.stringify(w));
      await page.screenshot({ path: join(out, 'karaoke-list-375.png') });
    });
    await step('mobile', 'Add to Queue is icon-only, 40px, named exactly, and clear of the queue handle', async () => {
      const row = rows.find((r) => !r.is_gone);
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
      await videoRows(page).first().locator('button').click();
      await setlistOf(page)
        .getByText(/^\d+ of \d+ songs match$/)
        .waitFor();
      await page.screenshot({ path: join(out, 'karaoke-setlist-375.png') });
      await page.getByRole('button', { name: 'All streams' }).click();
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const logged = [];
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/youtube|google|doubleclick|fontawesome|ERR_|Failed to load resource/i.test(m.text() + m.location().url)) logged.push(`console: ${m.text()}`);
  });
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
