/**
 * TabMerge 实机验证脚本（零依赖 Node + Chrome DevTools Protocol）。
 *
 * 用独立临时 profile 启动 Chrome，通过 CDP 的 Extensions.loadUnpacked 装载未打包扩展，
 * 用本地正向代理造出真实形态的标签页 URL（主机名保持 github.com / docs.google.com 等，
 * 无需外网与 DNS），在真实扩展环境里跑通
 * 「分组 / 逐组折叠 / 全收全展 / 全散 / 重新分组」流程，
 * 并把弹窗与设置页截图存到 docs/images/ 供设计比对。
 *
 * 用法：node tools/verify-extension.mjs
 * 可选环境变量：
 *   CHROME_PATH   指定 Chrome 可执行文件
 *   HEADFUL=1     以有头模式运行（默认无头）
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const extensionDir = join(projectRoot, 'extension');
const outputDir = join(projectRoot, 'docs', 'images');
const profileDir = join(projectRoot, '.tmp-verify-profile');
const debugPort = 9333;
const proxyPort = 8899;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('未找到 Chrome，可用环境变量 CHROME_PATH 指定');
}

/* ------------------------------------------------------------------ CDP */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  /** 订阅 CDP 事件，如 Runtime.consoleAPICalled。 */
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      ws.onopen = resolvePromise;
      ws.onerror = () => rejectPromise(new Error('CDP WebSocket 连接失败'));
    });
    const cdp = new CDP(ws);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && cdp.pending.has(message.id)) {
        const { resolvePromise, rejectPromise } = cdp.pending.get(message.id);
        cdp.pending.delete(message.id);
        if (message.error) rejectPromise(new Error(JSON.stringify(message.error)));
        else resolvePromise(message.result);
      } else if (message.method) {
        for (const handler of cdp.listeners.get(message.method) || []) {
          handler(message.params, message.sessionId);
        }
      }
    };
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolvePromise, rejectPromise });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

/* -------------------------------------------------------------- 测试夹具 */

/** 夹具 URL 保留真实主机名形态，请求由本地正向代理接管。 */
const FIXTURE_URLS = [
  'https://github.com/openai/openai-python',
  'https://github.com/chromium/chromium',
  'https://docs.google.com/document/d/1',
  'https://mail.google.com/mail/u/0',
  'https://notion.so/workspace',
  'https://www.notion.so/team',
  'https://figma.com/file/abc',
  'https://oa.corp.example.com/login',
  'https://oa.corp.example.com/approve',
  'https://news.ycombinator.com/',
  'https://stackoverflow.com/questions/1',
  'https://linear.app/team',
];

/** 极简正向代理：回应任何绝对 URI 请求，让标签页 URL 正常提交。 */
function startProxyServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>fixture</title><body>fixture</body>');
    });
    server.listen(proxyPort, '127.0.0.1', () => resolvePromise(server));
  });
}

/* ------------------------------------------------------------------ 工具 */

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('Chrome 调试端口未就绪');
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const description =
      details.exception?.description || details.exception?.value || details.text || '未知异常';
    throw new Error('页面脚本异常：' + description);
  }
  return result.result.value;
}

async function screenshot(session, file, width, height, scale = 2) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
  await sleep(300);
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('  截图 → ' + file);
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const chromePath = findChrome();
  mkdirSync(outputDir, { recursive: true });
  rmSync(profileDir, { recursive: true, force: true });

  const headful = process.env.HEADFUL === '1';
  const args = [
    headful ? '--no-startup-window' : '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    '--proxy-server=http://127.0.0.1:' + proxyPort,
    '--proxy-bypass-list=127.0.0.1;localhost',
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + debugPort,
    '--window-size=1280,900',
    'about:blank',
  ];

  console.log('启动 Chrome（通过 CDP 装载未打包扩展）…');
  const proxyServer = await startProxyServer();
  const child = spawn(chromePath, args, { stdio: 'ignore', detached: false });

  const failures = [];
  let total = 0;
  const check = (name, ok, detail = '') => {
    total += 1;
    console.log('  ' + (ok ? '✔' : '✘') + ' ' + name + (detail ? ' — ' + detail : ''));
    if (!ok) failures.push(name);
  };

  try {
    const version = await waitForPort(debugPort);
    const browser = await CDP.connect(version.webSocketDebuggerUrl);
    console.log('已连接 ' + version.Browser);

    // Chrome 137 起命令行 --load-extension 已失效，改用 CDP 的 Extensions 域装载
    const { id: extensionId } = await browser.send('Extensions.loadUnpacked', {
      path: extensionDir,
    });
    if (!extensionId) throw new Error('扩展装载失败');
    console.log('扩展 ID：' + extensionId);
    await sleep(1200);

    for (const url of FIXTURE_URLS) {
      await browser.send('Target.createTarget', { url });
    }
    await sleep(2500);

    // 打开弹窗页并接管
    const { targetId } = await browser.send('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/popup/popup.html',
    });
    const { sessionId } = await browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const session = { send: (method, params) => browser.send(method, params, sessionId) };
    browser.on('Runtime.consoleAPICalled', (params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      const text = (params.args || [])
        .map((arg) => arg.value ?? arg.description ?? '')
        .join(' ');
      console.log('  [扩展控制台] ' + text);
    });
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await sleep(1500);

    const probe = await evaluate(
      session,
      '(() => ({ title: document.title, api: typeof chrome !== "undefined" && typeof chrome.tabs !== "undefined" }))()',
    );
    check('扩展弹窗页正常加载', probe.title === 'TabMerge' && probe.api === true, JSON.stringify(probe));

    const readState = `(() => {
      const rows = [...document.querySelectorAll('.group-row')].map((row) => ({
        title: row.querySelector('.group-row__title').textContent,
        count: Number(row.querySelector('.group-row__count').textContent),
        bar: row.querySelector('.group-row__bar').style.background,
        collapsed: row.dataset.collapsed,
      }));
      return {
        header: document.getElementById('tab-count').textContent,
        status: document.getElementById('status').textContent,
        emptyHidden: document.getElementById('empty-state').hidden,
        disabled: ['btn-collapse','btn-expand','btn-dissolve'].map((id) => document.getElementById(id).disabled),
        rows,
      };
    })()`;


    // ---- 新版操作区：文案 / 2×2 布局 / 快捷键提示 / 齿轮 ----
    const actionUi = await evaluate(
      session,
      `(() => {
        const ids = ['btn-group', 'btn-dissolve', 'btn-collapse', 'btn-expand'];
        const buttons = ids.map((id) => document.getElementById(id));
        const labels = buttons.map((b) => b.querySelector('.action__label').textContent);
        const tips = buttons.map((b) => b.querySelector('[data-tip]').textContent);
        const rects = buttons.map((b) => {
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
        });
        const gear = document.getElementById('btn-settings');
        return {
          labels,
          tips,
          rects,
          gear: Boolean(gear),
          gearIcon: Boolean(gear?.querySelector('svg')),
          gridColumns: getComputedStyle(document.querySelector('.action-grid')).gridTemplateColumns.split(' ').length,
        };
      })()`,
    );
    check(
      '四个按钮文案为自动分组/解散分组/收起分组/展开分组',
      JSON.stringify(actionUi.labels) ===
        JSON.stringify(['自动分组', '解散分组', '收起分组', '展开分组']),
      JSON.stringify(actionUi.labels),
    );
    check('操作区为两列网格', actionUi.gridColumns === 2, String(actionUi.gridColumns));
    check(
      '自动分组与解散分组同行，收起分组在下一行',
      actionUi.rects[0].y === actionUi.rects[1].y && actionUi.rects[2].y > actionUi.rects[0].y,
      JSON.stringify(actionUi.rects),
    );
    check(
      '悬浮提示显示当前快捷键',
      actionUi.tips[0] === 'Alt+Shift+G' &&
        actionUi.tips[1] === 'Alt+Shift+D' &&
        actionUi.tips[2] === 'Alt+Shift+F' &&
        actionUi.tips[3] === 'Alt+Shift+E',
      JSON.stringify(actionUi.tips),
    );
    check('齿轮设置按钮存在且带图标', actionUi.gear === true && actionUi.gearIcon === true);

    const before = await evaluate(session, readState);
    check('弹窗读到标签页数量', /\d+ 个标签页/.test(before.header), before.header);
    check('未分组时清单为空且显示空态', before.rows.length === 0 && before.emptyHidden === false);
    check('未分组时批量按钮禁用', before.disabled.every((d) => d === true));

    await screenshot(session, join(outputDir, 'popup-empty.png'), 400, 600);

    // 一键分组
    await evaluate(
      session,
      '(async () => { document.getElementById("btn-group").click(); await new Promise(r => setTimeout(r, 1800)); })()',
    );
    const grouped = await evaluate(session, readState);
    const summary = grouped.rows.map((r) => r.title + ':' + r.count).join(', ');
    check('分组后产生 8 个域名分组', grouped.rows.length === 8, grouped.rows.length + ' 组 / ' + summary);
    check('分组后状态行有结果', grouped.status.includes('已按域名'), grouped.status);
    check('分组后批量按钮可用', grouped.disabled.every((d) => d === false));
    check(
      'google 子域归并为一组',
      grouped.rows.some((r) => r.title === 'google.com' && r.count === 2),
      summary,
    );
    check(
      'notion.so 与 www.notion.so 归并',
      grouped.rows.some((r) => r.title === 'notion.so' && r.count === 2),
      summary,
    );
    check(
      'corp 子域归并到 example.com',
      grouped.rows.some((r) => r.title === 'example.com' && r.count === 2),
      summary,
    );
    check(
      '色条使用 Chrome 原生组色',
      grouped.rows.length > 0 && grouped.rows.every((r) => /^rgb\(\d+, \d+, \d+\)$/.test(r.bar)),
      grouped.rows[0] ? grouped.rows[0].bar : '无',
    );
    check(
      '各组配色互不相同',
      new Set(grouped.rows.map((r) => r.bar)).size === grouped.rows.length,
      String(new Set(grouped.rows.map((r) => r.bar)).size),
    );

    const listFit = await evaluate(
      session,
      `(() => {
        const list = document.getElementById('group-list');
        const last = list.lastElementChild;
        const listBottom = list.getBoundingClientRect().bottom;
        const lastBottom = last.getBoundingClientRect().bottom;
        return { scrollable: list.scrollHeight > list.clientHeight + 1, clipped: lastBottom > listBottom + 1 };
      })()`,
    );
    check('8 个分组无需滚动即可看全', !listFit.scrollable && !listFit.clipped, JSON.stringify(listFit));

    await screenshot(session, join(outputDir, 'popup-grouped.png'), 400, 600);

    // 悬浮态：验证快捷键提示的位置与样式
    const hoverPoint = await evaluate(
      session,
      `(() => {
        const r = document.getElementById('btn-group').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`,
    );
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPoint.x, y: hoverPoint.y });
    await sleep(500);
    const tipBox = await evaluate(
      session,
      `(() => {
        const tip = document.querySelector('#btn-group [data-tip]');
        const button = document.getElementById('btn-group');
        const t = tip.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        return {
          visible: Number(getComputedStyle(tip).opacity) > 0.9,
          below: t.top > b.top,
          text: tip.textContent,
        };
      })()`,
    );
    check(
      '悬浮提示显示在按钮下方且内容为快捷键',
      tipBox.visible === true && tipBox.below === true && tipBox.text === 'Alt+Shift+G',
      JSON.stringify(tipBox),
    );
    await screenshot(session, join(outputDir, 'popup-tooltip.png'), 400, 600);
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await sleep(200);

    // 暗色模式
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    await sleep(400);
    await screenshot(session, join(outputDir, 'popup-dark.png'), 400, 600);
    await session.send('Emulation.setEmulatedMedia', { features: [] });
    await sleep(200);

    // 逐组折叠
    await evaluate(
      session,
      '(async () => { document.querySelector(".group-row").click(); await new Promise(r => setTimeout(r, 1000)); })()',
    );
    const afterToggle = await evaluate(session, readState);
    check(
      '点击行切换该组折叠',
      afterToggle.rows[0].collapsed === '1',
      'collapsed=' + afterToggle.rows[0].collapsed,
    );

    // 全部收起 / 全部展开
    await evaluate(
      session,
      '(async () => { document.getElementById("btn-collapse").click(); await new Promise(r => setTimeout(r, 1000)); })()',
    );
    const collapsedAll = await evaluate(session, readState);
    check('全部收起：所有组折叠', collapsedAll.rows.every((r) => r.collapsed === '1'), collapsedAll.status);

    await evaluate(
      session,
      '(async () => { document.getElementById("btn-expand").click(); await new Promise(r => setTimeout(r, 1000)); })()',
    );
    const expandedAll = await evaluate(session, readState);
    check('全部展开：所有组展开', expandedAll.rows.every((r) => r.collapsed === '0'), expandedAll.status);

    // 全部解散
    const tabCountBefore = await evaluate(session, '(async () => (await chrome.tabs.query({})).length)()');
    await evaluate(
      session,
      '(async () => { document.getElementById("btn-dissolve").click(); await new Promise(r => setTimeout(r, 1400)); })()',
    );
    const dissolved = await evaluate(session, readState);
    const tabCountAfter = await evaluate(session, '(async () => (await chrome.tabs.query({})).length)()');
    check('全部解散：分组清空', dissolved.rows.length === 0, dissolved.status);
    check(
      '全部解散：标签页一个不少',
      tabCountBefore === tabCountAfter,
      tabCountBefore + ' → ' + tabCountAfter,
    );

    // 重新分组
    await evaluate(
      session,
      '(async () => { document.getElementById("btn-group").click(); await new Promise(r => setTimeout(r, 1800)); })()',
    );
    const regrouped = await evaluate(session, readState);
    check(
      '重新分组：结果稳定',
      regrouped.rows.length === grouped.rows.length,
      grouped.rows.length + ' → ' + regrouped.rows.length,
    );

    // ---- 重命名后再次分组沿用自定义名 ----
    const renameFlow = await evaluate(
      session,
      `(async () => {
        const groups = await chrome.tabGroups.query({});
        const target = groups.find((g) => g.title === 'github.com');
        await chrome.tabGroups.update(target.id, { title: '工作' });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
        const after = await chrome.tabGroups.query({});
        const stored = await chrome.storage.sync.get('customNames');
        const row = [...document.querySelectorAll('.group-row')].find(
          (r) => r.querySelector('.group-row__title').textContent === '工作',
        );
        const hint = row ? row.querySelector('.group-row__domain')?.textContent : null;
        return {
          titles: after.map((g) => g.title),
          custom: stored.customNames || {},
          hint,
        };
      })()`,
    );
    check(
      '重命名后再次分组沿用自定义名',
      renameFlow.titles.includes('工作') && !renameFlow.titles.includes('github.com'),
      JSON.stringify(renameFlow.titles),
    );
    check('自定义名已记入设置', renameFlow.custom['github.com'] === '工作', JSON.stringify(renameFlow.custom));
    await screenshot(session, join(outputDir, 'popup-renamed.png'), 400, 600);
    check('弹窗同时显示原域名', renameFlow.hint === 'github.com', String(renameFlow.hint));

    // ---- 改回默认名后恢复 ----
    const renameBack = await evaluate(
      session,
      `(async () => {
        const groups = await chrome.tabGroups.query({});
        const renamed = groups.find((g) => g.title === '工作');
        await chrome.tabGroups.update(renamed.id, { title: 'github.com' });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
        const after = await chrome.tabGroups.query({});
        const stored = await chrome.storage.sync.get('customNames');
        return { titles: after.map((g) => g.title), custom: stored.customNames || {} };
      })()`,
    );
    check('改回默认名后恢复域名名', renameBack.titles.includes('github.com'), JSON.stringify(renameBack.titles));
    check(
      '改回默认名后清除自定义记录',
      !('github.com' in renameBack.custom),
      JSON.stringify(renameBack.custom),
    );

    // ---- 分组粒度：完整主机名 ----
    const hostMode = await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'host', excludedDomains: [], skipPinned: true, autoJoinGroup: false, autoCreateGroup: false } });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
        const groups = await chrome.tabGroups.query({});
        return groups.map((g) => g.title).sort();
      })()`,
    );
    check(
      '粒度切到完整主机名后子域拆开',
      hostMode.includes('docs.google.com') && hostMode.includes('mail.google.com'),
      JSON.stringify(hostMode),
    );

    // ---- 排除域名 ----
    const excluded = await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: ['github.com'], skipPinned: true, autoJoinGroup: false, autoCreateGroup: false } });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
        const groups = await chrome.tabGroups.query({});
        const tabs = await chrome.tabs.query({});
        const github = tabs.filter((t) => t.url.includes('github.com'));
        return {
          titles: groups.map((g) => g.title),
          githubGrouped: github.every((t) => t.groupId !== -1),
        };
      })()`,
    );
    check('排除域名后不再生成该分组', !excluded.titles.includes('github.com'), JSON.stringify(excluded.titles));
    check('排除域名的标签页保持未分组', excluded.githubGrouped === false);

    // ---- 跳过固定标签页 ----
    const pinned = await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: false, autoCreateGroup: false, minTabsPerGroup: 1 } });
        const tabs = await chrome.tabs.query({});
        const target = tabs.find((t) => t.url.includes('figma.com'));
        await chrome.tabs.update(target.id, { pinned: true });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
        const groups = await chrome.tabGroups.query({});
        const after = await chrome.tabs.get(target.id);
        return { titles: groups.map((g) => g.title), groupId: after.groupId, pinned: after.pinned };
      })()`,
    );
    check('固定标签页被固定且不参与分组', pinned.pinned === true && pinned.groupId === -1, JSON.stringify(pinned));
    check('固定后分组少一个', !pinned.titles.includes('figma.com'), JSON.stringify(pinned.titles));

    // ---- 最少标签页数（阈值）----
    const threshold = await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: false, autoCreateGroup: false, minTabsPerGroup: 2 } });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
        const groups = await chrome.tabGroups.query({});
        const tabs = await chrome.tabs.query({});
        const solo = (host) => {
          const hit = tabs.filter((t) => t.url.includes(host));
          return hit.length > 0 && hit.every((t) => t.groupId === -1);
        };
        return {
          titles: groups.map((g) => g.title).sort(),
          status: document.getElementById('status').textContent,
          stackoverflowSolo: solo('stackoverflow.com'),
          linearSolo: solo('linear.app'),
          ycombinatorSolo: solo('ycombinator.com'),
        };
      })()`,
    );
    check(
      '阈值 2 时只给出现两次以上的域名建组',
      threshold.titles.length === 4 &&
        threshold.titles.includes('github.com') &&
        threshold.titles.includes('google.com') &&
        threshold.titles.includes('notion.so') &&
        threshold.titles.includes('example.com'),
      JSON.stringify(threshold.titles),
    );
    check(
      '阈值 2 时单标签域名不建组，标签页保持散放',
      threshold.stackoverflowSolo && threshold.linearSolo && threshold.ycombinatorSolo,
      JSON.stringify(threshold),
    );
    check(
      '分组结果提示里说明有多少域名因阈值未分组',
      threshold.status.includes('阈值'),
      threshold.status,
    );

    // ---- 新标签页自动归组 ----
    const autoGroup = await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: true, autoCreateGroup: true } });
        const before = await chrome.tabGroups.query({});
        const githubGroup = before.find((g) => g.title === 'github.com');
        const beforeCount = githubGroup ? (await chrome.tabs.query({ groupId: githubGroup.id })).length : 0;
        await chrome.tabs.create({ url: 'https://github.com/auto-group-test', active: false });
        await new Promise(r => setTimeout(r, 2500));
        const after = await chrome.tabGroups.query({});
        const afterGroup = after.find((g) => g.title === 'github.com');
        const afterCount = afterGroup ? (await chrome.tabs.query({ groupId: afterGroup.id })).length : 0;
        return { beforeCount, afterCount };
      })()`,
    );
    check(
      '新标签页自动并入同域分组',
      autoGroup.afterCount === autoGroup.beforeCount + 1,
      JSON.stringify(autoGroup),
    );

    // ---- 两个自动归组开关相互独立 ----
    const independent = await evaluate(
      session,
      `(async () => {
        // 只开「并入」：同域的新标签页应进已有分组；没有分组的域名不应新建
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: true, autoCreateGroup: false } });
        const groupsBefore = await chrome.tabGroups.query({});
        const beforeTitles = groupsBefore.map((g) => g.title);
        const ghBefore = groupsBefore.find((g) => g.title === 'github.com');
        const beforeCount = ghBefore ? (await chrome.tabs.query({ groupId: ghBefore.id })).length : 0;
        await chrome.tabs.create({ url: 'https://github.com/join-only', active: false });
        await new Promise(r => setTimeout(r, 2200));
        const groupsAfter = await chrome.tabGroups.query({});
        const afterTitles = groupsAfter.map((g) => g.title);
        const gh = groupsAfter.find((g) => g.title === 'github.com');
        const ghCount = gh ? (await chrome.tabs.query({ groupId: gh.id })).length : 0;

        // 只开「新建」：没有分组的域名应新建一个
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: false, autoCreateGroup: true } });
        await chrome.tabs.create({ url: 'https://brandnewsite.example.org/', active: false });
        await new Promise(r => setTimeout(r, 2200));
        const finalGroups = await chrome.tabGroups.query({});
        return {
          beforeTitles,
          afterTitles,
          beforeCount,
          ghCount,
          newGroup: finalGroups.some((g) => g.title === 'example.org'),
        };
      })()`,
    );
    check(
      '只开「并入」：同域标签页进入已有分组',
      independent.ghCount === independent.beforeCount + 1,
      JSON.stringify(independent),
    );
    check(
      '只开「并入」：没有分组的域名不会被自动新建',
      !independent.afterTitles.includes('example.org'),
      JSON.stringify(independent.afterTitles),
    );
    check(
      '只开「新建」：没有对应分组时自动新建',
      independent.newGroup === true,
      JSON.stringify(independent.afterTitles),
    );

    // ---- 阈值下的自动新建：数量不够就先散放，够了再一起成组 ----
    const autoThreshold = await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: false, autoCreateGroup: true, minTabsPerGroup: 2 } });
        await chrome.tabs.create({ url: 'https://thresholdexample.org/first', active: false });
        await new Promise(r => setTimeout(r, 2200));
        const afterFirst = await chrome.tabGroups.query({});
        const firstExists = afterFirst.some((g) => g.title === 'thresholdexample.org');
        const firstTab = (await chrome.tabs.query({})).find((t) => t.url.includes('thresholdexample.org'));
        const firstGrouped = firstTab ? firstTab.groupId !== -1 : null;

        await chrome.tabs.create({ url: 'https://thresholdexample.org/second', active: false });
        await new Promise(r => setTimeout(r, 2200));
        const afterSecond = await chrome.tabGroups.query({});
        const group = afterSecond.find((g) => g.title === 'thresholdexample.org');
        const members = group ? await chrome.tabs.query({ groupId: group.id }) : [];
        return { firstExists, firstGrouped, secondExists: Boolean(group), memberCount: members.length };
      })()`,
    );
    check(
      '阈值 2 时第一个同域标签页不建组',
      autoThreshold.firstExists === false && autoThreshold.firstGrouped === false,
      JSON.stringify(autoThreshold),
    );
    check(
      '阈值 2 时攒够两个同域标签页才一起建组',
      autoThreshold.secondExists === true && autoThreshold.memberCount === 2,
      JSON.stringify(autoThreshold),
    );

    // 恢复默认设置，避免影响后续检查
    await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ settings: { granularity: 'domain', excludedDomains: [], skipPinned: true, autoJoinGroup: false, autoCreateGroup: false, minTabsPerGroup: 1 } });
        document.getElementById('btn-group').click();
        await new Promise(r => setTimeout(r, 1800));
      })()`,
    );

    // 放一条自定义名，让设置页截图能展示「分组名称」区块
    await evaluate(
      session,
      `(async () => {
        await chrome.storage.sync.set({ customNames: { 'github.com': '工作' } });
      })()`,
    );

    // 设置页
    const { targetId: optionsTarget } = await browser.send('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/options/options.html',
    });
    const { sessionId: optionsSessionId } = await browser.send('Target.attachToTarget', {
      targetId: optionsTarget,
      flatten: true,
    });
    const optionsSession = { send: (method, params) => browser.send(method, params, optionsSessionId) };
    await optionsSession.send('Runtime.enable');
    await optionsSession.send('Page.enable');
    await sleep(1500);

    const optionsState = await evaluate(
      optionsSession,
      `(() => ({
        rows: [...document.querySelectorAll('#command-rows .keyrow')].map((li) => ({
          name: li.querySelector('.keyrow__name').textContent,
          desc: li.querySelector('.keyrow__desc').textContent,
          key: li.querySelector('.keycap')?.textContent || li.querySelector('.badge')?.textContent || '',
          isCap: Boolean(li.querySelector('.keycap')),
        })),
        railItems: document.querySelectorAll('.rail__item').length,
        cards: document.querySelectorAll('.card').length,
        activeNav: document.querySelector('.rail__item.is-active')?.dataset.target,
        names: [...document.querySelectorAll('#custom-name-rows .namerow')].map(
          (r) => r.querySelector('.namechip').textContent,
        ),
        granularity: document.querySelector('input[name="granularity"]:checked')?.value,
        skipPinned: document.getElementById('toggle-skip-pinned').checked,
        autoJoin: document.getElementById('toggle-auto-join').checked,
        autoCreate: document.getElementById('toggle-auto-create').checked,
        minTabs: document.getElementById('input-min-tabs').value,
      }))()`,
    );
    check('设置页列出 5 条命令', optionsState.rows.length === 5, JSON.stringify(optionsState.rows.map((r) => r.name)));
    check(
      '设置页显示建议键位',
      optionsState.rows.slice(1).every((r) => /Alt\+Shift\+[A-Z]/.test(r.key)),
      JSON.stringify(optionsState.rows.map((r) => r.key)),
    );
    check(
      '每条命令都有说明文字',
      optionsState.rows.every((r) => r.desc.length > 4),
      JSON.stringify(optionsState.rows.map((r) => r.desc.length)),
    );
    check('侧栏导航有 4 个分区', optionsState.railItems === 4, String(optionsState.railItems));
    check('内容区有 4 张分区卡片', optionsState.cards === 4, String(optionsState.cards));
    check('侧栏默认高亮首个分区', optionsState.activeNav === 'sec-shortcuts', String(optionsState.activeNav));
    check('已记住的分组名渲染为药丸', optionsState.names.includes('工作'), JSON.stringify(optionsState.names));
    check('默认分组粒度为可注册域名', optionsState.granularity === 'domain');
    check('默认跳过固定标签页', optionsState.skipPinned === true);
    check('默认关闭「并入同域分组」', optionsState.autoJoin === false);
    check('默认关闭「无对应分组时新建」', optionsState.autoCreate === false);
    check('默认最少标签页数为 1（不设下限）', optionsState.minTabs === '1', optionsState.minTabs);

    // 最少标签页数：改动后应写入设置并更新说明
    const minTabsSaved = await evaluate(
      optionsSession,
      `(async () => {
        const input = document.getElementById('input-min-tabs');
        input.value = '2';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        const stored = await chrome.storage.sync.get('settings');
        const out = {
          value: input.value,
          hint: document.getElementById('min-tabs-hint').textContent,
          stored: stored.settings?.minTabsPerGroup,
        };
        input.value = '1';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        out.restored = (await chrome.storage.sync.get('settings')).settings?.minTabsPerGroup;
        return out;
      })()`,
    );
    check(
      '设置页改动最少标签页数会写入设置',
      minTabsSaved.stored === 2 && minTabsSaved.value === '2',
      JSON.stringify(minTabsSaved),
    );
    check(
      '最少标签页数说明随取值变化',
      minTabsSaved.hint.includes('2'),
      minTabsSaved.hint,
    );
    check('改回 1 后设置同步回落', minTabsSaved.restored === 1, String(minTabsSaved.restored));

    await screenshot(optionsSession, join(outputDir, 'options.png'), 1200, 1000, 1);

    // 窄窗：侧栏应收成图标条
    await optionsSession.send('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(300);
    const narrow = await evaluate(
      optionsSession,
      `(() => {
        const rail = document.querySelector('.rail');
        return {
          width: Math.round(rail.getBoundingClientRect().width),
          labelHidden: getComputedStyle(document.querySelector('.rail__label')).display === 'none',
        };
      })()`,
    );
    check('窄窗时侧栏收成图标条', narrow.width <= 70 && narrow.labelHidden === true, JSON.stringify(narrow));
    await optionsSession.send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(300);

    // 侧栏联动：每一节滚到视口中央时，侧栏高亮应跟随
    for (const id of ['sec-rules', 'sec-names', 'sec-behavior']) {
      await evaluate(
        optionsSession,
        `(async () => {
          const el = document.getElementById('${id}');
          const rect = el.getBoundingClientRect();
          const center = rect.top + rect.height / 2 + window.scrollY;
          window.scrollTo({ top: center - window.innerHeight / 2 });
          await new Promise(r => setTimeout(r, 600));
        })()`,
      );
      const active = await evaluate(
        optionsSession,
        `document.querySelector('.rail__item.is-active')?.dataset.target`,
      );
      check(`侧栏高亮跟随 ${id}`, active === id, String(active));
    }
    await screenshot(optionsSession, join(outputDir, 'options-scrolled.png'), 1200, 1000, 1);

    // 跳转 Chrome 快捷键设置页：平台可能拦截 chrome:// 导航
    await evaluate(
      optionsSession,
      '(async () => { document.getElementById("btn-open-shortcuts").click(); await new Promise(r => setTimeout(r, 1200)); })()',
    );
    const afterOpen = await browser.send('Target.getTargets');
    const shortcutsTab = afterOpen.targetInfos.find((t) => t.url.includes('extensions/shortcuts'));
    const shortcutHint = await evaluate(
      optionsSession,
      'document.getElementById("shortcut-hint").textContent',
    );
    check(
      '「在 Chrome 中修改快捷键」能打开快捷键设置页',
      Boolean(shortcutsTab),
      shortcutHint || '无提示',
    );

    const commands = await evaluate(
      optionsSession,
      '(async () => (await chrome.commands.getAll()).map(c => ({ name: c.name, shortcut: c.shortcut })))()',
    );
    check('chrome.commands 注册了 5 条命令', commands.length === 5, JSON.stringify(commands));

    console.log('');
    if (failures.length === 0) {
      console.log('全部 ' + total + ' 项验证通过。');
    } else {
      console.log('失败 ' + failures.length + '/' + total + ' 项：' + failures.join('、'));
      process.exitCode = 1;
    }
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await sleep(600);
    proxyServer.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('验证中断：', error);
  process.exitCode = 1;
});





