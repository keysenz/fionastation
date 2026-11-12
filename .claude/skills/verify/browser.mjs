import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_TIMEOUT = 30000;

const ab = async (session, ...args) => {
  let stdout;
  try {
    ({ stdout } = await run('agent-browser', ['--session', session, '--json', ...args.map(String)], { maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) {
    stdout = e.stdout;
    if (!stdout) throw new Error(`agent-browser ${args[0]}: ${e.message}`);
  }
  const reply = JSON.parse(stdout);
  if (Array.isArray(reply)) {
    const failed = reply.find((step) => !step.success);
    if (failed) throw new Error(`agent-browser ${failed.command.join(' ')}: ${failed.error}`);
    return reply.map((step) => step.result);
  }
  if (!reply.success) throw new Error(`agent-browser ${args[0]}: ${reply.error}`);
  return reply.data;
};

// Runs inside the page. It finds the elements a chain of locator steps names,
// following Playwright's rules: getByRole skips elements hidden from assistive
// technology, and getByText returns the deepest elements whose text matches.
const RESOLVE = String.raw`
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const toMatcher = (want, exact) => {
  if (want === undefined || want === null) return () => true;
  if (typeof want === 'object') {
    const re = new RegExp(want.re, want.flags);
    return (text) => re.test(text);
  }
  const w = norm(want);
  return exact ? (text) => text === w : (text) => text.toLowerCase().includes(w.toLowerCase());
};
const isVisible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};
const hiddenFromAria = (el) => !el.checkVisibility({ visibilityProperty: true }) || !!el.closest('[aria-hidden="true"]');
const implicitRole = (el) => {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'dialog') return 'dialog';
  if (tag === 'output') return 'status';
  if (tag === 'nav') return 'navigation';
  if (tag === 'main') return 'main';
  if (tag === 'img') return 'img';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'search') return 'searchbox';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'range') return 'slider';
    if (['', 'text', 'email', 'tel', 'url'].includes(type)) return 'textbox';
  }
  return null;
};
const roleOf = (el) => (el.getAttribute('role') ?? '').trim().split(/\s+/)[0] || implicitRole(el);
const textFor = (node) => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (hiddenFromAria(node)) return '';
  if (node.hasAttribute('aria-label')) return ' ' + node.getAttribute('aria-label') + ' ';
  if (node.tagName === 'IMG') return ' ' + (node.getAttribute('alt') ?? '') + ' ';
  return [...node.childNodes].map(textFor).join('');
};
const accessibleName = (el) => {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) return norm(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
  if (el.hasAttribute('aria-label')) return norm(el.getAttribute('aria-label'));
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const label = el.labels?.[0]?.textContent;
    return norm(label ?? el.getAttribute('title') ?? el.getAttribute('placeholder'));
  }
  if (el.tagName === 'IMG') return norm(el.getAttribute('alt'));
  return norm([...el.childNodes].map(textFor).join(''));
};
const headingLevel = (el) => Number(el.getAttribute('aria-level') ?? el.tagName.slice(1));
const order = (els) => [...new Set(els)].sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
const descendants = (roots) => order(roots.flatMap((root) => [...root.querySelectorAll('*')]));
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'TITLE']);
const byText = (roots, match) => {
  const hits = descendants(roots).filter((el) => !SKIP.has(el.tagName) && match(norm(el.textContent)));
  return hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
};
const parents = (els, depth) => order(els.map((el) => { for (let i = 0; i < depth && el; i++) el = el.parentElement; return el; }).filter(Boolean));
const apply = (set, s) => {
  switch (s.kind) {
    case 'css': {
      const parentDepth = s.css.match(/^(?:xpath=)?(\.\.(?:\/\.\.)*)$/);
      if (parentDepth) return parents(set, parentDepth[1].split('/').length);
      if (s.css === 'visible=true') return set.filter(isVisible);
      const visibleOnly = s.css.endsWith(':visible');
      const css = visibleOnly ? s.css.slice(0, -':visible'.length) : s.css;
      const found = order(set.flatMap((root) => [...root.querySelectorAll(css)]));
      return visibleOnly ? found.filter(isVisible) : found;
    }
    case 'role': {
      const match = toMatcher(s.name, s.exact);
      return descendants(set).filter((el) => roleOf(el) === s.role && !hiddenFromAria(el) && (s.level === undefined || headingLevel(el) === s.level) && match(accessibleName(el)));
    }
    case 'text':
      return byText(set, toMatcher(s.text, s.exact));
    case 'attr': {
      const match = toMatcher(s.value, s.exact);
      return descendants(set).filter((el) => el.hasAttribute(s.name) && match(norm(el.getAttribute(s.name))));
    }
    case 'label': {
      const match = toMatcher(s.text, s.exact);
      return descendants(set).filter((el) => match(norm(el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent ?? '')));
    }
    case 'hasText': {
      const match = toMatcher(s.text, false);
      return set.filter((el) => match(norm(el.textContent)));
    }
    case 'nth': {
      const el = set[s.n < 0 ? set.length + s.n : s.n];
      return el ? [el] : [];
    }
    case 'and': {
      const other = new Set(resolve(s.steps));
      return set.filter((el) => other.has(el));
    }
  }
  throw new Error('unknown locator step ' + s.kind);
};
const resolve = (steps) => steps.reduce(apply, [document]).filter((n) => n !== document);
`;

const serialize = (value) => (value instanceof RegExp ? { re: value.source, flags: value.flags } : value);
const source = (fn) => (typeof fn === 'function' ? fn.toString() : `() => (${fn})`);

export class Locator {
  constructor(page, steps) {
    this.page = page;
    this.steps = steps;
  }

  with(step) {
    return new Locator(this.page, [...this.steps, step]);
  }

  locator(css, options = {}) {
    const next = this.with({ kind: 'css', css });
    return options.hasText === undefined ? next : next.with({ kind: 'hasText', text: serialize(options.hasText) });
  }

  getByRole(role, { name, exact, level } = {}) {
    return this.with({ kind: 'role', role, name: serialize(name), exact, level });
  }

  getByText(text, { exact } = {}) {
    return this.with({ kind: 'text', text: serialize(text), exact });
  }

  getByPlaceholder(text, { exact } = {}) {
    return this.with({ kind: 'attr', name: 'placeholder', value: serialize(text), exact });
  }

  getByAltText(text, { exact } = {}) {
    return this.with({ kind: 'attr', name: 'alt', value: serialize(text), exact });
  }

  getByLabel(text, { exact } = {}) {
    return this.with({ kind: 'label', text: serialize(text), exact });
  }

  filter({ hasText }) {
    return this.with({ kind: 'hasText', text: serialize(hasText) });
  }

  and(other) {
    return this.with({ kind: 'and', steps: other.steps });
  }

  nth(n) {
    return this.with({ kind: 'nth', n });
  }

  first() {
    return this.nth(0);
  }

  last() {
    return this.nth(-1);
  }

  // Runs body(elements, arg) in the page against this locator's current matches.
  run(body, arg) {
    return this.page.evalScript(`(async () => { ${RESOLVE}; const els = resolve(${JSON.stringify(this.steps)}); return (${body})(els, ${JSON.stringify(arg)}); })()`);
  }

  async until(predicate, timeout, describe) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.run(predicate)) return;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${describe} of ${JSON.stringify(this.steps)}`);
      await sleep(100);
    }
  }

  waitFor({ state = 'visible', timeout = DEFAULT_TIMEOUT } = {}) {
    const predicates = {
      attached: '(els) => els.length > 0',
      detached: '(els) => els.length === 0',
      visible: `(els) => els.length > 0 && (${isVisibleSource})(els[0])`,
      hidden: `(els) => els.length === 0 || !(${isVisibleSource})(els[0])`,
    };
    return this.until(predicates[state], timeout, state);
  }

  count() {
    return this.run('(els) => els.length');
  }

  isVisible() {
    return this.run(`(els) => els.length > 0 && (${isVisibleSource})(els[0])`);
  }

  isDisabled() {
    return this.run('(els) => els.length > 0 && (els[0].disabled === true || els[0].getAttribute("aria-disabled") === "true")');
  }

  boundingBox() {
    return this.run(`(els) => {
      if (!els.length || !(${isVisibleSource})(els[0])) return null;
      const r = els[0].getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }`);
  }

  async evaluate(fn, arg) {
    await this.waitFor({ state: 'attached' });
    return this.run(`(els, arg) => (${source(fn)})(els[0], arg)`, arg);
  }

  evaluateAll(fn, arg) {
    return this.run(`(els, arg) => (${source(fn)})(els, arg)`, arg);
  }

  async getAttribute(name) {
    await this.waitFor({ state: 'attached' });
    return this.run('(els, name) => els[0].getAttribute(name)', name);
  }

  async innerText() {
    await this.waitFor({ state: 'attached' });
    return this.run('(els) => els[0].innerText');
  }

  async textContent() {
    await this.waitFor({ state: 'attached' });
    return this.run('(els) => els[0].textContent');
  }

  async inputValue() {
    await this.waitFor({ state: 'attached' });
    return this.run('(els) => els[0].value');
  }

  async focus() {
    await this.waitFor({ state: 'attached' });
    await this.run('(els) => els[0].focus()');
  }

  async scrollIntoViewIfNeeded() {
    await this.waitFor();
    await this.run('(els) => els[0].scrollIntoViewIfNeeded(true)');
  }

  // Marks the first match so agent-browser can act on it with a CSS selector.
  // A click at the match's center that lands on its own child counts as a click
  // on the match, as in Playwright, so the child gets the mark. Each retry scrolls
  // the match to another spot, as Playwright does, to get it out from under fixed bars.
  async tag(attempt = 0) {
    const id = randomUUID();
    await this.run(`(els, [id, attempt]) => {
      const el = els[0];
      if (attempt === 0) el.scrollIntoViewIfNeeded(true);
      else el.scrollIntoView({ block: ['center', 'start', 'end'][(attempt - 1) % 3], inline: 'center' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      (hit && hit !== el && el.contains(hit) ? hit : el).setAttribute('data-verify-target', id);
    }`, [id, attempt]);
    return `[data-verify-target="${id}"]`;
  }

  async click({ timeout = DEFAULT_TIMEOUT } = {}) {
    const deadline = Date.now() + timeout;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.waitFor({ timeout: Math.max(0, deadline - Date.now()) });
        await this.page.cmd('click', await this.tag(attempt));
        return;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`${e.message.split('. ')[0]} (clicking ${JSON.stringify(this.steps)})`);
        await sleep(100);
      }
    }
  }

  async fill(value) {
    await this.waitFor();
    const isRange = await this.run('(els) => els[0].type === "range"');
    if (isRange) {
      await this.run(`(els, value) => {
        const el = els[0];
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }`, String(value));
      return;
    }
    await this.page.cmd('fill', await this.tag(), value);
  }
}

const isVisibleSource = `(el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }`;

// A raw CDP connection to one tab, for the input agent-browser has no command for.
class Cdp {
  static async connect(session, targetId) {
    const { cdpUrl } = await ab(session, 'get', 'cdp-url');
    const socket = new WebSocket(cdpUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error(`could not open ${cdpUrl}`));
    });
    const cdp = new Cdp(socket);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    cdp.sessionId = sessionId;
    return cdp;
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}`));
        else resolve(message.result);
      } else if (message.method) {
        this.listeners.get(message.method)?.(message.params);
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, listener) {
    this.listeners.set(method, listener);
  }

  close() {
    this.socket.close();
  }
}

export class Page extends Locator {
  constructor(session, tabId, targetId) {
    super(null, []);
    this.page = this;
    this.session = session;
    this.tabId = tabId;
    this.targetId = targetId;
    this.mouse = {
      move: async (x, y, { steps } = {}) => {
        await this.cmd('mouse', 'move', Math.round(x), Math.round(y), ...(steps ? ['--steps', steps] : []));
      },
      down: () => this.cmd('mouse', 'down', 'left'),
      up: () => this.cmd('mouse', 'up', 'left'),
      // One batch keeps press and release together, so a re-render between them cannot swallow the click.
      click: (x, y) => this.cmd('batch', '--bail', `mouse move ${Math.round(x)} ${Math.round(y)}`, 'mouse down left', 'mouse up left'),
    };
    this.keyboard = { press: (key) => this.cmd('press', key) };
  }

  async cmd(...args) {
    if (this.session.activeTab !== this.tabId) {
      await ab(this.session.name, 'tab', this.tabId);
      this.session.activeTab = this.tabId;
    }
    return ab(this.session.name, ...args);
  }

  context() {
    return this.session;
  }

  async evalScript(script) {
    const data = await this.cmd('eval', script);
    return data.unserializable === 'undefined' ? undefined : data.result;
  }

  evaluate(fn, arg) {
    return this.evalScript(`(${source(fn)})(${JSON.stringify(arg)})`);
  }

  async waitForFunction(fn, arg, { timeout = DEFAULT_TIMEOUT, polling = 100 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await this.evaluate(fn, arg).catch(() => false);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`waitForFunction timed out after ${timeout}ms`);
      await sleep(polling);
    }
  }

  waitForTimeout(ms) {
    return sleep(ms);
  }

  async waitForURL(url, { timeout = DEFAULT_TIMEOUT } = {}) {
    const deadline = Date.now() + timeout;
    while ((await this.url()) !== url) {
      if (Date.now() > deadline) throw new Error(`the url never became ${url}`);
      await sleep(100);
    }
  }

  goto(url) {
    return this.cmd('open', url);
  }

  reload() {
    return this.cmd('reload');
  }

  // agent-browser reports an error when going back leaves the page's document,
  // though the navigation itself happened.
  async goBack() {
    try {
      await this.cmd('back');
    } catch (e) {
      if (!/navigated or closed/.test(e.message)) throw e;
    }
  }

  async url() {
    return (await this.cmd('get', 'url')).url;
  }

  async title() {
    return (await this.cmd('get', 'title')).title;
  }

  screenshot({ path, fullPage = false }) {
    return this.cmd('screenshot', ...(fullPage ? ['--full'] : []), path);
  }

  setViewportSize({ width, height }) {
    return this.cmd('set', 'viewport', width, height);
  }

  route(pattern, { abort = false, body } = {}) {
    return this.cmd('network', 'route', pattern, ...(abort ? ['--abort'] : ['--body', body]));
  }

  unroute(pattern) {
    return this.cmd('network', 'unroute', pattern);
  }

  async addInitScript(fn) {
    const cdp = await this.cdp();
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${source(fn)})()` });
  }

  async cdp() {
    this.cdpConnection ??= await Cdp.connect(this.session.name, this.targetId);
    return this.cdpConnection;
  }

  // Holds every request whose URL matches the pattern until the returned release() runs.
  async holdRequests(urlPattern) {
    const cdp = await this.cdp();
    const held = [];
    let released = false;
    cdp.on('Fetch.requestPaused', ({ requestId }) => {
      if (released) cdp.send('Fetch.continueRequest', { requestId });
      else held.push(requestId);
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern }] });
    return async () => {
      if (released) return;
      released = true;
      await Promise.all(held.map((requestId) => cdp.send('Fetch.continueRequest', { requestId })));
      await cdp.send('Fetch.disable');
    };
  }

  // Page errors and console errors since the last call.
  async problems() {
    const { errors = [] } = await this.cmd('errors');
    const { messages = [] } = await this.cmd('console');
    await this.cmd('errors', '--clear');
    await this.cmd('console', '--clear');
    return { errors, messages };
  }

  async close() {
    this.cdpConnection?.close();
    await ab(this.session.name, 'tab', 'close', this.tabId);
    if (this.session.activeTab === this.tabId) this.session.activeTab = undefined;
  }
}

// One agent-browser session is one isolated browser, standing in for a Playwright context.
export class Session {
  static async open(name, { args, viewport = { width: 1280, height: 800 }, touch = false } = {}) {
    const session = new Session(name, viewport, touch);
    await ab(name, 'close').catch(() => {});
    await ab(name, ...(args ? ['--args', args] : []), 'open', 'about:blank');
    return session;
  }

  constructor(name, viewport, touch) {
    this.name = name;
    this.viewport = viewport;
    this.touch = touch;
    this.pages = 0;
  }

  async newPage() {
    if (this.pages++ > 0) await ab(this.name, 'tab', 'new');
    const { tabs } = await ab(this.name, 'tab', 'list');
    const tab = tabs.find((t) => t.active) ?? tabs.at(-1);
    this.activeTab = tab.tabId;
    const page = new Page(this, tab.tabId, tab.targetId);
    await page.setViewportSize(this.viewport);
    if (this.touch) {
      const cdp = await page.cdp();
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...this.viewport, deviceScaleFactor: 2, mobile: true });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    return page;
  }

  close() {
    return ab(this.name, 'close');
  }
}
