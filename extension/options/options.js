/**
 * TabMerge 设置页逻辑。
 * 快捷键在 Chrome 侧绑定，本页只负责展示当前绑定并提供跳转入口。
 */

import {
  getSettings,
  saveSettings,
  getCustomNames,
  saveCustomNames,
  normalizeMinTabsPerGroup,
  MIN_TABS_RANGE,
} from '../core/settings.js';

const { icon } = globalThis.TabMergeIcons;

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

const COMMAND_ORDER = [
  '_execute_action',
  'group-tabs',
  'collapse-all',
  'expand-all',
  'dissolve-all',
];

/** 各命令的名称与说明。 */
const COMMAND_META = {
  _execute_action: { label: '打开弹窗', desc: '打开 TabMerge 的弹窗面板。' },
  'group-tabs': { label: '自动分组', desc: '将当前窗口的标签页按域名自动分组。' },
  'collapse-all': { label: '收起分组', desc: '折叠当前窗口中所有分组，只显示分组标题。' },
  'expand-all': { label: '展开分组', desc: '展开当前窗口中所有分组。' },
  'dissolve-all': { label: '解散分组', desc: '取消当前窗口的所有分组，标签页恢复为普通标签页。' },
};

const GRANULARITY_HINTS = {
  domain: '按可注册域名归并：docs.google.com 与 mail.google.com 会归入同一个 google.com 分组。',
  host: '以完整主机名为单位：docs.google.com 与 mail.google.com 各自独立成组。',
};

const els = {
  commandRows: document.getElementById('command-rows'),
  shortcutHint: document.getElementById('shortcut-hint'),
  btnOpenShortcuts: document.getElementById('btn-open-shortcuts'),
  btnRefreshCommands: document.getElementById('btn-refresh-commands'),
  excludeInput: document.getElementById('exclude-input'),
  btnAddExclude: document.getElementById('btn-add-exclude'),
  excludeList: document.getElementById('exclude-list'),
  granularityHint: document.getElementById('granularity-hint'),
  minTabsHint: document.getElementById('min-tabs-hint'),
  minTabsInput: document.getElementById('input-min-tabs'),
  toggleSkipPinned: document.getElementById('toggle-skip-pinned'),
  toggleAutoJoin: document.getElementById('toggle-auto-join'),
  toggleAutoCreate: document.getElementById('toggle-auto-create'),
  customNameRows: document.getElementById('custom-name-rows'),
  customNamesHint: document.getElementById('custom-names-hint'),
};

function renderStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const size = Number(node.dataset.size || 18);
    node.innerHTML = icon(node.dataset.icon, { size });
  });
}

/* 快捷键 ------------------------------------------------------------ */

async function renderCommands() {
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch (error) {
    console.error('[TabMerge] 读取快捷键失败：', error);
  }
  const byName = new Map(commands.map((command) => [command.name, command]));

  els.commandRows.textContent = '';
  for (const name of COMMAND_ORDER) {
    const command = byName.get(name);
    const meta = COMMAND_META[name] || { label: name, desc: '' };
    const shortcut = command?.shortcut || '';

    const row = document.createElement('li');
    row.className = 'keyrow';

    const text = document.createElement('div');
    text.className = 'keyrow__text';

    const nameEl = document.createElement('span');
    nameEl.className = 'keyrow__name';
    nameEl.textContent = meta.label;

    const descEl = document.createElement('span');
    descEl.className = 'keyrow__desc';
    descEl.textContent = meta.desc;

    text.append(nameEl, descEl);

    if (shortcut) {
      const cap = document.createElement('kbd');
      cap.className = 'keycap';
      cap.textContent = shortcut;
      row.append(text, cap);
    } else {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = name === '_execute_action' ? '由 Chrome 分配' : '未设置';
      row.append(text, badge);
    }

    els.commandRows.append(row);
  }
}

async function openShortcutSettings() {
  try {
    await chrome.tabs.create({ url: SHORTCUTS_URL });
    els.shortcutHint.textContent = '已在新标签页打开 Chrome 快捷键设置，改完后点「刷新」。';
  } catch (error) {
    console.error('[TabMerge] 打开快捷键设置失败：', error);
    els.shortcutHint.textContent = `Chrome 阻止了自动跳转，请手动在地址栏打开 ${SHORTCUTS_URL}。`;
  }
}

/* 分组规则 ---------------------------------------------------------- */

function updateGranularityHint(value) {
  els.granularityHint.textContent = GRANULARITY_HINTS[value] || '';
}

function updateMinTabsHint(value) {
  if (value <= 1) {
    els.minTabsHint.textContent = '不设下限：只要该域名有标签页就建组。';
    return;
  }
  els.minTabsHint.textContent =
    `同一域名至少有 ${value} 个标签页才建组，不足的一律保持散放，避免出现大量单标签分组。`;
}

function normalizeDomain(raw) {
  let value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  value = value.split(/[/?#]/)[0].trim();
  return value;
}

function renderExcluded(domains) {
  els.excludeList.textContent = '';
  for (const domain of domains) {
    const chip = document.createElement('li');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.textContent = domain;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除 ${domain}`);
    remove.innerHTML = icon('x', { size: 13 });
    remove.addEventListener('click', async () => {
      const settings = await getSettings();
      const next = settings.excludedDomains.filter((item) => item !== domain);
      await saveSettings({ excludedDomains: next });
      renderExcluded(next);
    });

    chip.append(label, remove);
    els.excludeList.append(chip);
  }
}

async function addExcludedDomain() {
  const value = normalizeDomain(els.excludeInput.value);
  if (!value) return;
  const settings = await getSettings();
  if (settings.excludedDomains.includes(value)) {
    els.excludeInput.value = '';
    return;
  }
  const next = [...settings.excludedDomains, value];
  await saveSettings({ excludedDomains: next });
  els.excludeInput.value = '';
  renderExcluded(next);
}

/* 已记住的分组名 ---------------------------------------------------- */

async function renderCustomNames() {
  const customNames = await getCustomNames();
  const entries = Object.entries(customNames).sort((a, b) => a[0].localeCompare(b[0]));

  els.customNameRows.textContent = '';
  els.customNamesHint.hidden = entries.length > 0;

  for (const [domain, name] of entries) {
    const row = document.createElement('li');
    row.className = 'namerow';

    const chip = document.createElement('span');
    chip.className = 'namechip';
    chip.textContent = name;

    const domainEl = document.createElement('span');
    domainEl.className = 'namerow__domain';
    domainEl.textContent = domain;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-quiet btn-compact';
    remove.textContent = '删除';
    remove.addEventListener('click', async () => {
      const current = await getCustomNames();
      const next = { ...current };
      delete next[domain];
      await saveCustomNames(next);
      await renderCustomNames();
    });

    row.append(chip, domainEl, remove);
    els.customNameRows.append(row);
  }
}

/* 侧栏导航：滚动联动高亮 -------------------------------------------- */

function initRailNav() {
  const items = [...document.querySelectorAll('.rail__item')];
  const sections = items
    .map((item) => document.getElementById(item.dataset.target))
    .filter(Boolean);
  if (sections.length === 0) return;

  const setActive = (id) => {
    for (const item of items) {
      item.classList.toggle('is-active', item.dataset.target === id);
    }
  };

  for (const item of items) {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(item.dataset.target);
      if (!target) return;
      setActive(item.dataset.target);
      const top = target.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  let ticking = false;
  const update = () => {
    ticking = false;
    // 各卡片高度不同，用「中心最接近视口中线」来判定当前分区，避免跳过某一节
    const mid = window.innerHeight / 2;
    let current = sections[0];
    let best = Infinity;
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - mid);
      if (distance < best) {
        best = distance;
        current = section;
      }
    }
    // 滚到底时最后一节未必能滚到中线，直接把它判为当前项
    const atBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    if (atBottom) current = sections[sections.length - 1];
    setActive(current.id);
  };

  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    },
    { passive: true },
  );

  // 内容高度变化（例如记住了新的分组名）后重新判定
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => update());
    for (const section of sections) observer.observe(section);
  }

  return update;
}

/* 初始化 ------------------------------------------------------------ */

async function loadSettings() {
  const settings = await getSettings();
  document.querySelectorAll('input[name="granularity"]').forEach((radio) => {
    radio.checked = radio.value === settings.granularity;
  });
  updateGranularityHint(settings.granularity);
  els.minTabsInput.value = String(settings.minTabsPerGroup);
  updateMinTabsHint(settings.minTabsPerGroup);
  els.toggleSkipPinned.checked = settings.skipPinned;
  els.toggleAutoJoin.checked = settings.autoJoinGroup;
  els.toggleAutoCreate.checked = settings.autoCreateGroup;
  renderExcluded(settings.excludedDomains);
  await renderCustomNames();
}

function bindEvents() {
  els.btnOpenShortcuts.addEventListener('click', openShortcutSettings);
  els.btnRefreshCommands.addEventListener('click', async () => {
    await renderCommands();
    els.shortcutHint.textContent = '已刷新快捷键绑定状态。';
  });

  document.querySelectorAll('input[name="granularity"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      await saveSettings({ granularity: radio.value });
      updateGranularityHint(radio.value);
    });
  });

  els.btnAddExclude.addEventListener('click', addExcludedDomain);
  els.excludeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addExcludedDomain();
  });

  els.minTabsInput.addEventListener('change', async () => {
    const value = normalizeMinTabsPerGroup(els.minTabsInput.value);
    els.minTabsInput.value = String(value);
    updateMinTabsHint(value);
    await saveSettings({ minTabsPerGroup: value });
  });

  els.toggleSkipPinned.addEventListener('change', async () => {
    await saveSettings({ skipPinned: els.toggleSkipPinned.checked });
  });

  els.toggleAutoJoin.addEventListener('change', async () => {
    await saveSettings({ autoJoinGroup: els.toggleAutoJoin.checked });
  });

  els.toggleAutoCreate.addEventListener('change', async () => {
    await saveSettings({ autoCreateGroup: els.toggleAutoCreate.checked });
  });

  // 从 Chrome 快捷键页返回时自动刷新绑定状态
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderCommands();
  });
  window.addEventListener('focus', renderCommands);
}

async function init() {
  renderStaticIcons();
  els.minTabsInput.min = String(MIN_TABS_RANGE.min);
  els.minTabsInput.max = String(MIN_TABS_RANGE.max);
  bindEvents();
  const refreshNav = initRailNav();
  await loadSettings();
  await renderCommands();
  // 内容渲染完成后重算一次高亮，避免拿到空内容时的旧位置
  refreshNav();
}

init();

