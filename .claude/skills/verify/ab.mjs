import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT = 30000;
const POLL_MS = 50;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (args, input = '') =>
  new Promise((resolve, reject) => {
    const child = spawn('agent-browser', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`agent-browser ${args.slice(2, 5).join(' ')} did not answer in 120s`));
    }, 120000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });

const literal = (value) => (value === undefined ? 'undefined' : JSON.stringify(value));
const matcherOf = (m) => (m instanceof RegExp ? { re: m.source, flags: m.flags } : m);
const describeMatcher = (m) => (m instanceof RegExp ? String(m) : JSON.stringify(m));

// Runs inside the page. Mirrors the parts of Playwright's locator semantics the journeys rely on.
const pageLibrary = () => {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const rendered = (el) => el.checkVisibility({ visibilityProperty: true });
  const visible = (el) => {
    if (!rendered(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const matcher = (m, exact) => {
    if (typeof m === 'object') {
      const re = new RegExp(m.re, m.flags);
      return (s) => re.test(s);
    }
    const want = norm(m);
    return exact ? (s) => s === want : (s) => s.toLowerCase().includes(want.toLowerCase());
  };

  const IMPLICIT_ROLES = [
    ['button', 'button, summary, input[type=button], input[type=submit], input[type=reset]'],
    ['link', 'a[href], area[href]'],
    ['heading', 'h1, h2, h3, h4, h5, h6'],
    ['dialog', 'dialog'],
    ['status', 'output'],
    ['searchbox', 'input[type=search]:not([list])'],
  ];
  const ARIA_DISABLED_ROLES = new Set(['button', 'link', 'switch', 'checkbox', 'searchbox', 'textbox', 'slider', 'tab', 'menuitem', 'option', 'radio']);
  const roleOf = (el) => {
    const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
    if (explicit) return explicit;
    return IMPLICIT_ROLES.find(([, selector]) => el.matches(selector))?.[0] ?? null;
  };
  const hiddenFromTree = (el) => !rendered(el) || !!el.closest('[aria-hidden="true"]');

  const contentOf = (node) => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || !rendered(node) || node.getAttribute('aria-hidden') === 'true') return '';
    const label = node.getAttribute('aria-label');
    if (label) return label;
    if (node.localName === 'img') return node.getAttribute('alt') ?? '';
    const inner = [...node.childNodes].map(contentOf).join('');
    return getComputedStyle(node).display.startsWith('inline') ? inner : ` ${inner} `;
  };
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      return norm(
        by
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((target) => contentOf(target))
          .join(' '),
      );
    }
    const label = el.getAttribute('aria-label');
    if (label) return norm(label);
    if (el.labels?.length) return norm([...el.labels].map((l) => l.textContent).join(' '));
    const own = norm([...el.childNodes].map(contentOf).join(''));
    if (own) return own;
    return norm(el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '');
  };

  const isDisabled = (el) => {
    if (el.matches(':disabled')) return true;
    return ARIA_DISABLED_ROLES.has(roleOf(el)) && !!el.closest('[aria-disabled="true"]');
  };

  const textMatches = (el, test) => test(norm(el.textContent));
  const byText = (roots, test) =>
    roots.flatMap((root) =>
      [...root.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE'].includes(el.tagName) && textMatches(el, test) && ![...el.children].some((child) => textMatches(child, test))),
    );

  const applyStep = (roots, step) => {
    switch (step.k) {
      case 'css': {
        const stripped = step.sel.replace(/:visible\b/g, '');
        const found = roots.flatMap((root) => [...root.querySelectorAll(stripped)]);
        return stripped === step.sel ? found : found.filter(visible);
      }
      case 'xpath':
        return roots.flatMap((root) => {
          const snapshot = document.evaluate(step.sel, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          return Array.from({ length: snapshot.snapshotLength }, (_, i) => snapshot.snapshotItem(i));
        });
      case 'role': {
        const test = step.name === undefined ? null : matcher(step.name, step.exact);
        const known = IMPLICIT_ROLES.some(([role]) => role === step.role) || step.role === 'switch';
        if (!known) throw new Error(`getByRole does not know the role ${step.role}`);
        return roots
          .flatMap((root) => [...root.querySelectorAll('*')])
          .filter((el) => roleOf(el) === step.role && !hiddenFromTree(el))
          .filter((el) => step.level === undefined || Number(el.getAttribute('aria-level') ?? el.localName.slice(1)) === step.level)
          .filter((el) => test === null || test(nameOf(el)));
      }
      case 'text':
        return byText(roots, matcher(step.text, step.exact));
      case 'label': {
        const test = matcher(step.text, step.exact);
        return roots
          .flatMap((root) => [...root.querySelectorAll('*')])
          .filter((el) => test(el.getAttribute('aria-label') ?? '') || (el.labels && [...el.labels].some((l) => test(norm(l.textContent)))));
      }
      case 'attr': {
        const test = matcher(step.text, step.exact);
        return roots.flatMap((root) => [...root.querySelectorAll(`[${step.name}]`)]).filter((el) => test(el.getAttribute(step.name)));
      }
      case 'hasText': {
        const test = matcher(step.text, false);
        return roots.filter((el) => textMatches(el, test));
      }
      case 'visible':
        return roots.filter(visible);
      case 'nth':
        return [roots.at(step.i)].filter(Boolean);
      case 'and': {
        const other = new Set(resolve(step.steps));
        return roots.filter((el) => other.has(el));
      }
      default:
        throw new Error(`unknown locator step ${step.k}`);
    }
  };
  const resolve = (steps) => {
    let roots = [document];
    for (const step of steps) {
      const found = applyStep(roots, step);
      roots = [...new Set(found)].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    }
    return roots;
  };

  return { norm, rendered, visible, isDisabled, resolve };
};

const inPage = (body) => `(async () => {
  const ab = (window.__ab ??= (${pageLibrary})());
  return await (${body})(ab);
})()`;

class Locator {
  constructor(page, steps, label) {
    this.page = page;
    this.steps = steps;
    this.label = label;
  }

  #chain(step, label) {
    return new Locator(this.page, [...this.steps, step], `${this.label}.${label}`);
  }

  locator(selector, { hasText } = {}) {
    const step = selector.startsWith('xpath=')
      ? { k: 'xpath', sel: selector.slice(6) }
      : selector.startsWith('..') || selector.startsWith('//')
        ? { k: 'xpath', sel: selector }
        : selector === 'visible=true'
          ? { k: 'visible' }
          : { k: 'css', sel: selector };
    const found = this.#chain(step, `locator(${JSON.stringify(selector)})`);
    return hasText === undefined ? found : found.filter({ hasText });
  }

  getByRole(role, { name, exact = false, level } = {}) {
    return this.#chain({ k: 'role', role, name: name === undefined ? undefined : matcherOf(name), exact, level }, `getByRole(${role}${name === undefined ? '' : `, ${describeMatcher(name)}`})`);
  }

  getByText(text, { exact = false } = {}) {
    return this.#chain({ k: 'text', text: matcherOf(text), exact }, `getByText(${describeMatcher(text)})`);
  }

  getByLabel(text, { exact = false } = {}) {
    return this.#chain({ k: 'label', text: matcherOf(text), exact }, `getByLabel(${describeMatcher(text)})`);
  }

  getByPlaceholder(text, { exact = false } = {}) {
    return this.#chain({ k: 'attr', name: 'placeholder', text: matcherOf(text), exact }, `getByPlaceholder(${describeMatcher(text)})`);
  }

  getByAltText(text, { exact = false } = {}) {
    return this.#chain({ k: 'attr', name: 'alt', text: matcherOf(text), exact }, `getByAltText(${describeMatcher(text)})`);
  }

  filter({ hasText }) {
    return this.#chain({ k: 'hasText', text: matcherOf(hasText) }, `filter(${describeMatcher(hasText)})`);
  }

  nth(i) {
    return this.#chain({ k: 'nth', i }, `nth(${i})`);
  }

  first() {
    return this.nth(0);
  }

  last() {
    return this.nth(-1);
  }

  and(other) {
    return this.#chain({ k: 'and', steps: other.steps }, `and(${other.label})`);
  }

  #resolved(body, args) {
    return this.page._evaluateScript(
      inPage(`async (ab) => {
        const els = ab.resolve(${literal(this.steps)});
        return await (${body})(els, ab, ${literal(args)});
      }`),
    );
  }

  async #attempt(body, args, attempt) {
    const res = await this.#resolved(
      `async (els, ab, args) => {
        if (els.length !== 1) return { n: els.length };
        return { n: 1, v: await (${body})(els[0], ab, args, ${attempt}) };
      }`,
      args,
    );
    if (res.n > 1) throw new Error(`strict mode violation: ${this.label} resolved to ${res.n} elements`);
    return res.n === 0 ? { retry: 'the element was not found' } : res.v;
  }

  async #element(body, args, timeout = DEFAULT_TIMEOUT) {
    const deadline = Date.now() + timeout;
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.#attempt(body, args, attempt);
      if (!outcome.retry) return outcome;
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded: ${this.label}: ${outcome.retry}`);
      await sleep(POLL_MS);
    }
  }

  async count() {
    return (await this.#resolved('(els) => els.length')) ?? 0;
  }

  async isVisible() {
    const res = await this.#resolved('(els, ab) => (els.length > 1 ? { many: els.length } : els.length === 1 && ab.visible(els[0]))');
    if (res?.many) throw new Error(`strict mode violation: ${this.label} resolved to ${res.many} elements`);
    return res;
  }

  evaluateAll(fn, arg) {
    return this.#resolved(`(els) => (${fn})(els, ${literal(arg)})`);
  }

  async evaluate(fn, arg) {
    return (await this.#element(`async (el) => ({ value: await (${fn})(el, ${literal(arg)}) })`)).value;
  }

  async #read(body, args) {
    return (await this.#element(`async (el, ab, args) => ({ value: await (${body})(el, ab, args) })`, args)).value;
  }

  getAttribute(name) {
    return this.#read('(el, ab, name) => el.getAttribute(name)', name);
  }

  innerText() {
    return this.#read('(el) => el.innerText');
  }

  textContent() {
    return this.#read('(el) => el.textContent');
  }

  inputValue() {
    return this.#read('(el) => el.value');
  }

  isDisabled() {
    return this.#read('(el, ab) => ab.isDisabled(el)');
  }

  boundingBox() {
    return this.#read(`(el, ab) => {
      if (!ab.rendered(el)) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }`);
  }

  async focus() {
    await this.#element('(el) => { el.focus(); return {}; }');
  }

  async scrollIntoViewIfNeeded() {
    await this.#element(`(el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return {};
    }`);
  }

  async waitFor({ state = 'visible', timeout = DEFAULT_TIMEOUT } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const res = await this.#resolved('(els, ab) => ({ n: els.length, shown: els.length === 1 && ab.visible(els[0]) })');
      if (res.n > 1) throw new Error(`strict mode violation: ${this.label} resolved to ${res.n} elements`);
      const reached = { visible: res.shown, hidden: !res.shown, attached: res.n === 1, detached: res.n === 0 }[state];
      if (reached) return;
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded: ${this.label} to be ${state}`);
      await sleep(POLL_MS);
    }
  }

  async click({ timeout = DEFAULT_TIMEOUT } = {}) {
    const token = Math.random().toString(36).slice(2);
    const target = `[data-ab-click="${token}"]`;
    const deadline = Date.now() + timeout;
    for (let attempt = 0; ; attempt++) {
      let outcome = await this.#attempt(
        `async (el, ab, token, attempt) => {
          const inView = (r) => r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
          const align = [null, 'end', 'center', 'start'][attempt % 4];
          if (align || !inView(el.getBoundingClientRect())) el.scrollIntoView({ block: align ?? 'center', inline: align ?? 'center', behavior: 'instant' });
          if (!ab.visible(el)) return { retry: 'the element is not visible' };
          if (ab.isDisabled(el)) return { retry: 'the element is not enabled' };
          const before = el.getBoundingClientRect();
          await new Promise((resolve) => setTimeout(resolve, 60));
          const r = el.getBoundingClientRect();
          if (before.x !== r.x || before.y !== r.y || before.width !== r.width || before.height !== r.height) return { retry: 'the element is not stable' };
          el.setAttribute('data-ab-click', token);
          return {};
        }`,
        token,
        attempt,
      );
      if (!outcome.retry) {
        try {
          await this.page._call('click', target);
          return;
        } catch (e) {
          outcome = { retry: e.message };
        } finally {
          await this.page.evaluate((t) => document.querySelector(`[data-ab-click="${t}"]`)?.removeAttribute('data-ab-click'), token).catch(() => {});
        }
      }
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded: ${this.label}: ${outcome.retry}`);
      await sleep(POLL_MS);
    }
  }

  async fill(text) {
    const typed = await this.#element(
      `(el, ab, text) => {
        if (!ab.visible(el)) return { retry: 'the element is not visible' };
        if (ab.isDisabled(el)) return { retry: 'the element is not enabled' };
        el.focus();
        if (el.type === 'range') {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: false };
        }
        el.select();
        return { typed: true };
      }`,
      text,
    );
    if (!typed.typed) return;
    if (text === '') await this.page.keyboard.press('Backspace');
    else await this.page._call('keyboard', 'inserttext', text);
  }
}

const pageLocator = (page) => new Locator(page, [], 'page');

export class Session {
  constructor(name, { viewport = { width: 1280, height: 800 }, launchArgs = [] } = {}) {
    this.name = name;
    this.viewport = viewport;
    this.launchArgs = launchArgs;
    this.active = null;
    this.launching = null;
    this.firstTab = null;
  }

  async call(args, input) {
    const { code, stdout, stderr } = await run(['--session', this.name, '--json', ...args], input);
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`agent-browser ${args[0]} failed (exit ${code}): ${(stdout + stderr).trim().split('\n')[0]}`);
    }
    if (!parsed.success) throw new Error(String(parsed.error).split('\n')[0]);
    return parsed.data;
  }

  launch() {
    this.launching ??= (async () => {
      await run(['--session', this.name, '--json', ...this.launchArgs, 'open', 'about:blank']).then(({ stdout }) => {
        if (!JSON.parse(stdout).success) throw new Error(`could not launch ${this.name}: ${stdout.slice(0, 200)}`);
      });
      await this.call(['set', 'viewport', String(this.viewport.width), String(this.viewport.height)]);
      const { tabs } = await this.call(['tab', 'list']);
      this.firstTab = tabs.find((t) => t.active).tabId;
      this.active = this.firstTab;
    })();
    return this.launching;
  }

  page() {
    return new Page(this, null);
  }

  async newTab() {
    await this.launch();
    const { tabId } = await this.call(['tab', 'new', 'about:blank']);
    this.active = tabId;
    await this.call(['set', 'viewport', String(this.viewport.width), String(this.viewport.height)]);
    return new Page(this, tabId);
  }

  context() {
    return { newPage: () => this.newTab() };
  }

  async close() {
    if (!this.launching) return;
    await this.call(['close']).catch(() => {});
  }
}

export class Page {
  constructor(session, tabId) {
    this.session = session;
    this.tabId = tabId;
    this.lastMouse = { x: 0, y: 0 };
    this.mouse = {
      move: async (x, y, { steps = 1 } = {}) => {
        const from = this.lastMouse;
        for (let i = 1; i <= steps; i++) {
          const at = { x: from.x + ((x - from.x) * i) / steps, y: from.y + ((y - from.y) * i) / steps };
          await this._call('mouse', 'move', String(Math.round(at.x)), String(Math.round(at.y)));
        }
        this.lastMouse = { x, y };
      },
      down: () => this._call('mouse', 'down', 'left'),
      up: () => this._call('mouse', 'up', 'left'),
      click: async (x, y) => {
        await this.mouse.move(x, y);
        await this.mouse.down();
        await this.mouse.up();
      },
    };
    this.keyboard = { press: (key) => this._call('press', key) };
  }

  async #use() {
    await this.session.launch();
    this.tabId ??= this.session.firstTab;
    if (this.session.active !== this.tabId) {
      await this.session.call(['tab', this.tabId]);
      this.session.active = this.tabId;
    }
  }

  async _call(...args) {
    await this.#use();
    return this.session.call(args);
  }

  async _evaluateScript(script) {
    await this.#use();
    const data = await this.session.call(['eval', '--stdin'], script);
    return data.result;
  }

  context() {
    return this.session.context();
  }

  async goto(url) {
    await this._call('open', url);
  }

  async reload() {
    await this._call('reload');
  }

  async goBack() {
    const before = await this.url();
    try {
      await this._call('back');
    } catch (e) {
      // `back` across a document change reports this CDP error even though the navigation happened.
      if (!e.message.includes('Inspected target navigated or closed') || (await this.url()) === before) throw e;
    }
  }

  async url() {
    return (await this._call('get', 'url')).url;
  }

  async title() {
    return (await this._call('get', 'title')).title;
  }

  async waitForURL(url, { timeout = DEFAULT_TIMEOUT } = {}) {
    const deadline = Date.now() + timeout;
    while ((await this.url()) !== url) {
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded waiting for ${url}`);
      await sleep(POLL_MS);
    }
  }

  evaluate(fn, arg) {
    return this._evaluateScript(inPage(`async () => (${fn})(${literal(arg)})`));
  }

  async waitForFunction(fn, arg, { timeout = DEFAULT_TIMEOUT, polling = 100 } = {}) {
    const deadline = Date.now() + timeout;
    let last = '';
    for (;;) {
      try {
        if (await this._evaluateScript(inPage(`async () => Boolean(await (${fn})(${literal(arg)}))`))) return;
      } catch (e) {
        last = e.message;
      }
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded waiting for a function${last ? `: ${last}` : ''}`);
      await sleep(polling);
    }
  }

  waitForTimeout(ms) {
    return sleep(ms);
  }

  async screenshot({ path, fullPage = false }) {
    await this._call('screenshot', ...(fullPage ? ['--full'] : []), path);
  }

  async setViewportSize({ width, height }) {
    await this._call('set', 'viewport', String(width), String(height));
  }

  async close() {
    if (this.tabId === null || this.tabId === this.session.firstTab) return this.session.close();
    await this._call('tab', 'close', this.tabId);
    this.session.active = null;
  }

  locator(selector, options) {
    return pageLocator(this).locator(selector, options);
  }

  getByRole(role, options) {
    return pageLocator(this).getByRole(role, options);
  }

  getByText(text, options) {
    return pageLocator(this).getByText(text, options);
  }

  getByLabel(text, options) {
    return pageLocator(this).getByLabel(text, options);
  }

  getByPlaceholder(text, options) {
    return pageLocator(this).getByPlaceholder(text, options);
  }

  getByAltText(text, options) {
    return pageLocator(this).getByAltText(text, options);
  }

  async pageErrors() {
    if (!this.session.launching) return [];
    const { errors } = await this._call('errors');
    return errors.map((e) => `pageerror: ${e.text.split('\n')[0]}`);
  }

  async consoleErrors() {
    if (!this.session.launching) return [];
    const { messages } = await this._call('console');
    return messages.filter((m) => m.type === 'error' && !/youtube|google|doubleclick|fontawesome|ERR_|Failed to load resource/i.test(m.text)).map((m) => `console: ${m.text}`);
  }

  async routeAbort(pattern) {
    await this._call('network', 'route', pattern, '--abort');
  }

  async routeBody(pattern, body) {
    await this._call('network', 'route', pattern, '--body', body);
  }

  async unroute(pattern) {
    await this._call('network', 'unroute', pattern);
  }

  async touch() {
    const { port } = await this._call('stream', 'status');
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('could not open the agent-browser stream for touch input'));
    });
    const send = async (eventType, point) => {
      socket.send(JSON.stringify({ type: 'input_touch', eventType, touchPoints: point ? [{ x: point.x, y: point.y }] : [] }));
      await sleep(25);
    };
    return { send, close: () => socket.close() };
  }
}
