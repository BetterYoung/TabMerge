/**
 * TabMerge 弹窗逻辑。
 * 直接调用 core/groups.js，窗口 id 取弹窗所属的窗口。
 */

import {
  groupTabsByDomain,
  setGroupsCollapsed,
  dissolveAllGroups,
  setGroupCollapsed,
  getGroupSnapshot,
  captureCustomNames,
  GROUP_COLOR_HEX,
} from '../core/groups.js';

const { icon } = globalThis.TabMergeIcons;

const els = {
  tabCount: document.getElementById('tab-count'),
  btnGroup: document.getElementById('btn-group'),
  btnCollapse: document.getElementById('btn-collapse'),
  btnExpand: document.getElementById('btn-expand'),
  btnDissolve: document.getElementById('btn-dissolve'),
  btnSettings: document.getElementById('btn-settings'),
  list: document.getElementById('group-list'),
  empty: document.getElementById('empty-state'),
  status: document.getElementById('status'),
};

let windowId = null;
let busy = false;
let groupCount = 0;

function renderStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const size = Number(node.dataset.size || 18);
    node.innerHTML = icon(node.dataset.icon, { size });
  });
}

function setStatus(text) {
  els.status.textContent = text || '';
}

function updateDisabled() {
  els.btnGroup.disabled = busy;
  els.btnCollapse.disabled = busy || groupCount === 0;
  els.btnExpand.disabled = busy || groupCount === 0;
  els.btnDissolve.disabled = busy || groupCount === 0;
}

function setBusy(next) {
  busy = next;
  updateDisabled();
}

function renderGroups(groups) {
  groupCount = groups.length;
  els.empty.hidden = groupCount > 0;
  els.list.textContent = '';

  for (const group of groups) {
    const row = document.createElement('li');
    row.className = 'group-row';
    row.dataset.groupId = String(group.id);
    row.dataset.collapsed = group.collapsed ? '1' : '0';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const label = group.custom && group.domain ? `${group.title}（${group.domain}）` : group.title;
    row.setAttribute(
      'aria-label',
      `${label}，${group.tabCount} 个标签页，点击${group.collapsed ? '展开' : '收起'}`,
    );

    const bar = document.createElement('span');
    bar.className = 'group-row__bar';
    bar.style.background = GROUP_COLOR_HEX[group.color] || GROUP_COLOR_HEX.grey;

    const name = document.createElement('span');
    name.className = 'group-row__name';

    const title = document.createElement('span');
    title.className = 'group-row__title';
    title.textContent = group.title;
    name.append(title);

    if (group.custom && group.domain) {
      const domain = document.createElement('span');
      domain.className = 'group-row__domain';
      domain.textContent = group.domain;
      name.append(domain);
    }

    const count = document.createElement('span');
    count.className = 'group-row__count';
    count.textContent = String(group.tabCount);

    const chevron = document.createElement('span');
    chevron.className = 'group-row__chevron';
    chevron.innerHTML = icon(group.collapsed ? 'chevron-right' : 'chevron-down', { size: 16 });

    row.append(bar, name, count, chevron);
    els.list.append(row);
  }

  updateDisabled();
}

async function refresh() {
  if (windowId === null) return;
  const snapshot = await getGroupSnapshot(windowId);
  els.tabCount.textContent = `${snapshot.tabCount} 个标签页`;
  renderGroups(snapshot.groups);
}

/**
 * 读取各命令当前的快捷键，填进按钮的悬浮提示。
 */
async function refreshShortcuts() {
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch (error) {
    console.error('[TabMerge] 读取快捷键失败：', error);
  }
  const byName = new Map(commands.map((command) => [command.name, command.shortcut || '']));
  document.querySelectorAll('.action[data-command]').forEach((button) => {
    const tip = button.querySelector('[data-tip]');
    if (!tip) return;
    tip.textContent = byName.get(button.dataset.command) || '未绑定快捷键';
  });
}

async function run(task) {
  if (busy) return;
  setBusy(true);
  try {
    await task();
  } catch (error) {
    console.error('[TabMerge] 操作失败：', error);
    setStatus('操作失败，请重试');
  }
  try {
    await refresh();
  } finally {
    setBusy(false);
  }
}

els.btnGroup.addEventListener('click', () =>
  run(async () => {
    const result = await groupTabsByDomain(windowId);
    if (result.groups === 0) {
      if (result.failed > 0) {
        setStatus(`有 ${result.failed} 个分组创建失败，请重试`);
      } else if (result.belowThreshold > 0) {
        setStatus(`有 ${result.belowThreshold} 个域名的标签页少于阈值，未分组`);
      } else {
        setStatus('当前窗口没有可分组的标签页');
      }
    } else {
      const suffix = result.failed > 0 ? `，${result.failed} 组失败` : '';
      const threshold =
        result.belowThreshold > 0 ? `，${result.belowThreshold} 个域名因阈值未分组` : '';
      setStatus(`已按域名将 ${result.tabs} 个标签页分为 ${result.groups} 组${suffix}${threshold}`);
    }
  }),
);

els.btnCollapse.addEventListener('click', () =>
  run(async () => {
    const affected = await setGroupsCollapsed(windowId, true);
    setStatus(affected > 0 ? `已收起 ${affected} 个分组` : '所有分组都已处于收起状态');
  }),
);

els.btnExpand.addEventListener('click', () =>
  run(async () => {
    const affected = await setGroupsCollapsed(windowId, false);
    setStatus(affected > 0 ? `已展开 ${affected} 个分组` : '所有分组都已处于展开状态');
  }),
);

els.btnDissolve.addEventListener('click', () =>
  run(async () => {
    const affected = await dissolveAllGroups(windowId);
    setStatus(
      affected > 0 ? `已解散 ${affected} 个分组，标签页全部保留` : '当前窗口没有分组',
    );
  }),
);

els.btnSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.list.addEventListener('click', (event) => {
  const row = event.target.closest('.group-row');
  if (!row) return;
  const groupId = Number(row.dataset.groupId);
  const wasCollapsed = row.dataset.collapsed === '1';
  run(async () => {
    await setGroupCollapsed(groupId, !wasCollapsed);
    setStatus(wasCollapsed ? '已展开该分组' : '已收起该分组');
  });
});

els.list.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.group-row');
  if (!row) return;
  event.preventDefault();
  row.click();
});

async function init() {
  renderStaticIcons();
  try {
    const win = await chrome.windows.getCurrent();
    windowId = win?.id ?? null;
  } catch {
    windowId = null;
  }
  if (windowId === null) {
    els.tabCount.textContent = '无法读取当前窗口';
    return;
  }
  await refreshShortcuts();
  // 先学习用户在 Chrome 里做过的重命名，再渲染清单
  await captureCustomNames(windowId);
  await refresh();
}

init();

