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
import {
  deleteSavedGroups,
  getSavedGroups,
  saveEditedGroup,
  saveWindowGroups,
} from '../core/saved-groups.js';
import { GROUP_COLOR_HEX, getGroupSnapshot } from '../core/groups.js';

const { icon } = globalThis.TabMergeIcons;

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

const COMMAND_ORDER = [
  '_execute_action',
  'open-saved-groups',
  'group-tabs',
  'collapse-all',
  'expand-all',
  'dissolve-all',
];

/** 各命令的名称与说明。 */
const COMMAND_META = {
  _execute_action: { label: '打开弹窗', desc: '打开 TabMerge 的弹窗面板。' },
  'open-saved-groups': { label: '打开分组库', desc: '打开已保存的分组，选择并批量恢复。' },
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
  libraryItems: document.getElementById('library-items'),
  libraryEmpty: document.getElementById('library-empty'),
  libraryStatus: document.getElementById('library-status'),
  libraryCount: document.getElementById('library-count'),
  librarySelectAll: document.getElementById('library-select-all'),
  librarySaveCurrent: document.getElementById('btn-save-current-groups'),
  libraryRestore: document.getElementById('library-restore-selected'),
  libraryDelete: document.getElementById('library-delete-selected'),
};

let libraryGroups = [];
let libraryCustomNames = {};
let libraryCurrentGroups = [];
let managementGroups = [];
let libraryWindowId = null;
let libraryBusy = false;
let editingGroupName = null;
let editingGroupWasExpanded = false;

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

/* 分组管理：名称规则与保存快照合并 ---------------------------------- */

function librarySelectedIds() {
  return [...els.libraryItems.querySelectorAll('.library-check:checked')].map((item) => item.value);
}

function makeLibraryIconButton(className, iconName, label, tooltip) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = icon(iconName, { size: 15 });
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = tooltip;
  button.setAttribute('aria-describedby', 'action-tooltip');
  return button;
}

function buildManagementGroups() {
  const byDomain = new Map();
  const rows = [];
  const getOrCreate = (domain, fallbackId) => {
    const key = domain ? `domain:${domain}` : fallbackId;
    let entry = byDomain.get(key);
    if (!entry) {
      entry = { key, domain: domain || '', title: '', color: 'grey', live: null, saved: null, named: false };
      byDomain.set(key, entry);
      rows.push(entry);
    }
    return entry;
  };

  for (const [domain, title] of Object.entries(libraryCustomNames)) {
    const entry = getOrCreate(domain, `name:${domain}`);
    entry.title = title || domain;
    entry.named = true;
  }
  for (const group of libraryCurrentGroups) {
    const entry = getOrCreate(group.domain, `live:${group.id}`);
    entry.live = group;
    entry.title = libraryCustomNames[group.domain] || group.title || entry.title || group.domain || '未命名分组';
    entry.color = group.color || entry.color;
  }
  for (const item of libraryGroups) {
    let entry = item.domain ? byDomain.get(`domain:${item.domain}`) : null;
    if (!entry || entry.saved) {
      entry = getOrCreate('', `saved:${item.id}`);
      entry.domain = item.domain || entry.domain;
    }
    entry.saved = item;
    entry.title = libraryCustomNames[item.domain] || entry.live?.title || item.title || entry.title || '未命名分组';
    entry.color = entry.live?.color || item.color || entry.color;
  }
  return rows.sort((a, b) => (a.title || a.domain).localeCompare(b.title || b.domain, 'zh-CN'));
}

function updateLibraryActions() {
  const selected = librarySelectedIds().length;
  const savedCount = managementGroups.filter((entry) => entry.saved).length;
  els.libraryCount.textContent = `${managementGroups.length} 个分组 · ${savedCount} 个已保存${selected ? ` · 已选 ${selected}` : ''}`;
  els.librarySelectAll.checked = savedCount > 0 && selected === savedCount;
  els.librarySelectAll.indeterminate = selected > 0 && selected < savedCount;
  els.librarySelectAll.disabled = libraryBusy || savedCount === 0;
  els.libraryRestore.disabled = libraryBusy || selected === 0;
  els.libraryDelete.disabled = libraryBusy || selected === 0;
  els.librarySaveCurrent.disabled = libraryBusy;
}

function makeTabEditor(tab = {}, isNew = false) {
  const row = document.createElement('div');
  row.className = `library-tab-edit${isNew ? ' is-new' : ''}`;
  row.dataset.title = tab.title || '';
  row.dataset.url = tab.url || '';
  if (isNew) {
    const url = document.createElement('input');
    url.type = 'url';
    url.className = 'library-tab-url-input';
    url.placeholder = '输入要添加的网页地址（https://…）';
    url.setAttribute('aria-label', '新标签页网址');
    row.append(url);
  } else {
    const info = document.createElement('div');
    info.className = 'library-tab-info';
    const title = document.createElement('span');
    title.className = 'library-tab-title';
    title.textContent = tab.title || '网页标题由网站提供';
    const url = document.createElement('span');
    url.className = 'library-tab-url';
    url.textContent = tab.url || '';
    info.append(title, url);
    row.append(info);
  }
  const remove = makeLibraryIconButton('library-tab-remove is-danger', 'x', '移除标签', '移除标签');
  remove.addEventListener('click', () => row.remove());
  row.append(remove);
  return row;
}

function renderLibrary() {
  const expanded = new Set([...els.libraryItems.querySelectorAll('details[open]')].map((node) => node.dataset.id));
  els.libraryItems.textContent = '';
  managementGroups = buildManagementGroups();
  els.libraryEmpty.hidden = managementGroups.length > 0;
  for (const entry of managementGroups) {
    const details = document.createElement('details');
    details.className = 'library-group';
    details.dataset.id = entry.key;
    details.open = expanded.has(entry.key);
    const summary = document.createElement('summary');
    if (entry.saved) {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'library-check';
      check.value = entry.saved.id;
      check.setAttribute('aria-label', `选择 ${entry.title}`);
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', updateLibraryActions);
      summary.append(check);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'library-check-spacer';
      summary.append(spacer);
    }
    const bar = document.createElement('span');
    bar.className = 'library-color';
    bar.style.background = GROUP_COLOR_HEX[entry.color] || GROUP_COLOR_HEX.grey;
    const labels = document.createElement('span');
    labels.className = 'library-summary-text';
    const name = document.createElement('strong');
    name.textContent = entry.title || '未命名分组';
    const meta = document.createElement('span');
    meta.textContent = `${entry.domain || entry.saved?.domain || '多个域名'}　${entry.saved?.tabs?.length ?? entry.live?.tabCount ?? 0} 个标签`;
    labels.append(name, meta);
    const state = document.createElement('span');
    state.className = 'management-state';
    if (entry.live) state.append(makeBadge('当前窗口', 'live'));
    if (entry.saved) state.append(makeBadge('已保存', 'saved'));
    if (entry.named) state.append(makeBadge('自动命名', 'named'));

    const rename = makeLibraryIconButton('management-rename', 'pencil', `修改分组名称：${entry.title}`, '改名');
    rename.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (editingGroupName === entry.key) return;
      editingGroupWasExpanded = details.open;
      editingGroupName = entry.key;
      renderLibrary();
    });

    const chevron = document.createElement('span');
    chevron.className = 'library-chevron';
    chevron.innerHTML = icon(details.open ? 'chevron-up' : 'chevron-down', { size: 15 });
    details.addEventListener('toggle', () => {
      chevron.innerHTML = icon(details.open ? 'chevron-up' : 'chevron-down', { size: 15 });
    });
    summary.append(bar, labels, state, rename, chevron);
    summary.addEventListener('click', (event) => {
      if (event.target.closest('.library-check')) event.stopPropagation();
    });

    const editor = document.createElement('div');
    editor.className = 'library-editor';
    const tabs = document.createElement('div');
    tabs.className = 'library-tab-list';
    if (entry.saved) {
      for (const tab of entry.saved.tabs || []) tabs.append(makeTabEditor(tab));
    } else {
      const note = document.createElement('p');
      note.className = 'library-no-snapshot';
      note.textContent = entry.live
        ? '当前分组尚未保存为快照。保存当前窗口后，可在这里编辑标签并用于恢复。'
        : '这是自动命名规则，保存当前分组后即可在这里管理标签快照。';
      tabs.append(note);
    }
    const actions = document.createElement('div');
    actions.className = 'library-editor-actions';
    if (entry.saved) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn-secondary btn-compact';
      add.textContent = '添加标签';
      add.addEventListener('click', () => {
        const row = makeTabEditor({}, true);
        tabs.append(row);
        row.querySelector('.library-tab-url-input').focus();
      });
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn-primary btn-compact library-actions-push';
      save.textContent = '保存修改';
      save.addEventListener('click', () => withLibraryBusy(async () => {
        const draftTabs = [...tabs.querySelectorAll('.library-tab-edit')].map((row) => ({
          title: row.dataset.title || '',
          url: row.querySelector('.library-tab-url-input')?.value ?? row.dataset.url ?? '',
        }));
        await saveEditedGroup(entry.saved.id, { title: entry.title, tabs: draftTabs });
        await refreshLibrary();
        els.libraryStatus.textContent = `已保存「${entry.title}」的标签修改`;
      }));
      actions.append(add, save);
    }
    if (entry.named) {
      const removeName = document.createElement('button');
      removeName.type = 'button';
      removeName.className = 'btn btn-danger-quiet btn-compact';
      if (!entry.saved) removeName.classList.add('library-actions-push');
      removeName.textContent = '删除名称规则';
      removeName.addEventListener('click', () => withLibraryBusy(async () => {
        const next = { ...(await getCustomNames()) };
        delete next[entry.domain];
        await saveCustomNames(next);
        await refreshLibrary();
        els.libraryStatus.textContent = `已删除「${entry.domain}」的自动命名规则`;
      }));
      actions.append(removeName);
    }
    editor.append(tabs);
    if (actions.childElementCount) editor.append(actions);
    details.append(summary, editor);
    if (editingGroupName === entry.key) {
      details.open = true;
      summary.hidden = true;
      editor.hidden = true;
      const titleInput = document.createElement('input');
      titleInput.className = 'management-name-input';
      titleInput.value = entry.title;
      titleInput.setAttribute('aria-label', '分组名称');
      const saveName = makeLibraryIconButton('management-name-save is-primary', 'circle-check', '保存分组名称', '保存');
      const cancelName = makeLibraryIconButton('management-name-cancel', 'x', '取消改名', '取消');
      const nameEditor = document.createElement('div');
      nameEditor.className = 'management-name-editor';
      nameEditor.append(titleInput, saveName, cancelName);
      details.insertBefore(nameEditor, editor);
      const saveEntryName = () => withLibraryBusy(async () => {
        const title = titleInput.value.trim();
        if (!title) throw new Error('分组名称不能为空');
        if (entry.domain) {
          const next = { ...(await getCustomNames()), [entry.domain]: title };
          await saveCustomNames(next);
        }
        if (entry.live) await chrome.tabGroups.update(entry.live.id, { title });
        if (entry.saved) await saveEditedGroup(entry.saved.id, { title, tabs: entry.saved.tabs });
        details.open = editingGroupWasExpanded;
        editingGroupName = null;
        editingGroupWasExpanded = false;
        await refreshLibrary();
        els.libraryStatus.textContent = `已保存「${title}」的分组名称`;
      });
      saveName.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); saveEntryName(); });
      cancelName.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        details.open = editingGroupWasExpanded;
        editingGroupName = null;
        editingGroupWasExpanded = false;
        renderLibrary();
      });
      titleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); saveEntryName(); }
        if (event.key === 'Escape') {
          event.preventDefault();
          details.open = editingGroupWasExpanded;
          editingGroupName = null;
          editingGroupWasExpanded = false;
          renderLibrary();
        }
      });
      requestAnimationFrame(() => titleInput.focus());
    }
    els.libraryItems.append(details);
  }
  updateLibraryActions();
}

function makeBadge(text, kind) {
  const badge = document.createElement('span');
  badge.className = `management-badge management-badge--${kind}`;
  badge.textContent = text;
  return badge;
}

async function refreshLibrary() {
  const [saved, names, snapshot] = await Promise.all([
    getSavedGroups(),
    getCustomNames(),
    libraryWindowId === null ? Promise.resolve({ groups: [] }) : getGroupSnapshot(libraryWindowId),
  ]);
  libraryGroups = saved;
  libraryCustomNames = names;
  libraryCurrentGroups = snapshot.groups;
  renderLibrary();
}

async function withLibraryBusy(action) {
  if (libraryBusy) return;
  libraryBusy = true;
  updateLibraryActions();
  try { await action(); }
  catch (error) { els.libraryStatus.textContent = error?.message || '操作失败，请重试'; }
  finally { libraryBusy = false; updateLibraryActions(); }
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
}

function bindEvents() {
  els.btnOpenShortcuts.addEventListener('click', openShortcutSettings);
  els.btnRefreshCommands.addEventListener('click', async () => {
    await renderCommands();
    els.shortcutHint.textContent = '已刷新快捷键绑定状态。';
  });

  els.librarySelectAll.addEventListener('change', () => {
    for (const check of els.libraryItems.querySelectorAll('.library-check')) {
      check.checked = els.librarySelectAll.checked;
    }
    updateLibraryActions();
  });
  els.librarySaveCurrent.addEventListener('click', () => withLibraryBusy(async () => {
    if (libraryWindowId === null) {
      const win = await chrome.windows.getCurrent();
      libraryWindowId = win?.id ?? null;
    }
    if (libraryWindowId === null) throw new Error('无法读取当前浏览器窗口');
    const result = await saveWindowGroups(libraryWindowId);
    await refreshLibrary();
    els.libraryStatus.textContent = result.saved
      ? `已保存或更新 ${result.saved} 个分组${result.skipped ? `，跳过 ${result.skipped} 个不含网页标签的分组` : ''}`
      : '当前窗口没有可保存的网页分组';
  }));
  els.libraryDelete.addEventListener('click', () => withLibraryBusy(async () => {
    const removed = await deleteSavedGroups(librarySelectedIds());
    await refreshLibrary();
    els.libraryStatus.textContent = `已删除 ${removed} 个保存项`;
  }));
  els.libraryRestore.addEventListener('click', () => withLibraryBusy(async () => {
    if (libraryWindowId === null) throw new Error('无法读取当前浏览器窗口');
    const result = await chrome.runtime.sendMessage({
      type: 'tabmerge:restore-saved-groups',
      ids: librarySelectedIds(),
      windowId: libraryWindowId,
    });
    if (result?.error) throw new Error(result.error);
    els.libraryStatus.textContent = `已恢复 ${result.groups} 组：复用了 ${result.reused} 个标签，新开 ${result.opened} 个${result.skipped ? `，跳过 ${result.skipped} 个` : ''}${result.failed ? `，${result.failed} 项失败` : ''}`;
  }));

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
  globalThis.TabMergeTooltips.init();
  renderStaticIcons();
  els.minTabsInput.min = String(MIN_TABS_RANGE.min);
  els.minTabsInput.max = String(MIN_TABS_RANGE.max);
  bindEvents();
  const refreshNav = initRailNav();
  await loadSettings();
  await renderCommands();
  const win = await chrome.windows.getCurrent().catch(() => null);
  libraryWindowId = win?.id ?? null;
  await refreshLibrary();
  // 内容渲染完成后重算一次高亮，避免拿到空内容时的旧位置
  refreshNav();
  const hash = window.location.hash.slice(1);
  const initialTarget = document.getElementById(
    hash === 'sec-library' || hash === 'sec-names' ? 'sec-groups' : hash,
  );
  if (initialTarget) {
    document.querySelector(`.rail__item[data-target="${initialTarget.id}"]`)?.classList.add('is-active');
    requestAnimationFrame(() => initialTarget.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }
}

init();

