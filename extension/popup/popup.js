/** TabMerge 弹窗：当前分组与保存快照合并呈现。 */

import {
  groupTabsByDomain,
  setGroupsCollapsed,
  dissolveAllGroups,
  setGroupCollapsed,
  getGroupSnapshot,
  captureCustomNames,
  GROUP_COLOR_HEX,
} from '../core/groups.js';
import { getCustomNames, saveCustomNames } from '../core/settings.js';
import {
  deleteSavedGroups,
  getSavedGroups,
  saveEditedGroup,
  saveWindowGroups,
} from '../core/saved-groups.js';

const { icon } = globalThis.TabMergeIcons;
const els = {
  tabCount: document.getElementById('tab-count'),
  btnGroup: document.getElementById('btn-group'),
  btnCollapse: document.getElementById('btn-collapse'),
  btnExpand: document.getElementById('btn-expand'),
  btnDissolve: document.getElementById('btn-dissolve'),
  btnSaveGroups: document.getElementById('btn-save-current-groups'),
  btnSettings: document.getElementById('btn-settings'),
  selectAll: document.getElementById('group-select-all'),
  selectionCount: document.getElementById('group-selection-count'),
  btnRestore: document.getElementById('btn-restore-selected'),
  btnDeleteSelected: document.getElementById('btn-delete-selected'),
  list: document.getElementById('group-list'),
  empty: document.getElementById('empty-state'),
  status: document.getElementById('status'),
};

let windowId = null;
let busy = false;
let liveGroupCount = 0;
let customNames = {};
let entries = [];
const expandedKeys = new Set();

function renderStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((node) => {
    node.innerHTML = icon(node.dataset.icon, { size: Number(node.dataset.size || 18) });
  });
}

function makeIconButton(className, iconName, label, tooltip) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = icon(iconName, { size: 15 });
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = tooltip;
  button.setAttribute('aria-describedby', 'action-tooltip');
  return button;
}

function setStatus(text) {
  els.status.textContent = text || '';
}

function updateActions() {
  els.btnGroup.disabled = busy;
  els.btnCollapse.disabled = busy || liveGroupCount === 0;
  els.btnExpand.disabled = busy || liveGroupCount === 0;
  els.btnDissolve.disabled = busy || liveGroupCount === 0;
  els.btnSaveGroups.disabled = busy || liveGroupCount === 0;
  for (const check of els.list.querySelectorAll('.group-row__check')) {
    check.disabled = busy || !check.value;
  }
  const checks = [...els.list.querySelectorAll('.group-row__check:not(:disabled)')];
  const selected = checks.filter((check) => check.checked).length;
  els.selectionCount.textContent = `${entries.length} 个分组 · 已选 ${selected}`;
  els.selectAll.checked = checks.length > 0 && selected === checks.length;
  els.selectAll.indeterminate = selected > 0 && selected < checks.length;
  els.selectAll.disabled = busy || checks.length === 0;
  els.btnRestore.disabled = busy || selected === 0;
  els.btnDeleteSelected.disabled = busy || selected === 0;
}

function selectedSavedIds() {
  return [...els.list.querySelectorAll('.group-row__check:checked')].map((check) => check.value);
}

function mergeGroups(liveGroups, savedGroups) {
  const merged = [];
  const usedSaved = new Set();
  for (const live of liveGroups) {
    const saved = savedGroups.find((item) => !usedSaved.has(item.id) && item.domain && item.domain === live.domain);
    if (saved) usedSaved.add(saved.id);
    const liveTitle = live.title && live.title !== live.domain ? live.title : '';
    merged.push({
      key: `live:${live.id}`,
      live,
      saved: saved || null,
      title: customNames[live.domain] || liveTitle || saved?.title || live.domain || '未命名分组',
      domain: live.domain || saved?.domain || '',
      color: live.color || saved?.color || 'grey',
      count: saved?.tabs?.length ?? live.tabCount,
    });
  }
  for (const saved of savedGroups) {
    if (usedSaved.has(saved.id)) continue;
    merged.push({
      key: `saved:${saved.id}`,
      live: null,
      saved,
      title: customNames[saved.domain] || saved.title || '未命名分组',
      domain: saved.domain || '',
      color: saved.color || 'grey',
      count: saved.tabs?.length || 0,
    });
  }
  return merged;
}

function makeBadge(text, kind) {
  const badge = document.createElement('span');
  badge.className = `group-row__badge group-row__badge--${kind}`;
  badge.textContent = text;
  return badge;
}

function startRename(entry, row) {
  if (row.classList.contains('is-renaming')) return;
  row.classList.add('is-renaming');
  row.querySelector('.group-row__toggle').hidden = true;
  row.querySelector('.group-row__rename').hidden = true;
  row.querySelector('.group-row__details').hidden = true;

  const input = document.createElement('input');
  input.className = 'group-row__name-input';
  input.value = entry.title;
  input.setAttribute('aria-label', '分组名称');
  const save = makeIconButton('group-row__icon-action group-row__name-save is-primary', 'circle-check', '保存分组名称', '保存');
  const cancel = makeIconButton('group-row__icon-action group-row__name-cancel', 'x', '取消改名', '取消');
  const editor = document.createElement('div');
  editor.className = 'group-row__name-editor';
  editor.append(input, save, cancel);
  row.insertBefore(editor, row.querySelector('.group-row__count'));
  input.focus();

  const finish = (commit) => {
    if (!commit) return refresh();
    const title = input.value.trim();
    if (!title) {
      setStatus('分组名称不能为空');
      input.focus();
      return;
    }
    run(async () => {
      if (entry.domain) {
        await saveCustomNames({ ...(await getCustomNames()), [entry.domain]: title });
      }
      if (entry.live) await chrome.tabGroups.update(entry.live.id, { title });
      if (entry.saved) await saveEditedGroup(entry.saved.id, { title, tabs: entry.saved.tabs });
      setStatus(`已保存「${title}」的分组名称`);
    });
  };
  save.addEventListener('click', (event) => { event.stopPropagation(); finish(true); });
  cancel.addEventListener('click', (event) => { event.stopPropagation(); finish(false); });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
}

function makeTabRow(tab, index, removable, onRemove, isNew = false) {
  const row = document.createElement('div');
  row.className = `group-editor__tab${isNew ? ' is-new' : ''}`;
  row.dataset.title = tab.title || '';
  row.dataset.url = tab.url || '';
  if (isNew) {
    const url = document.createElement('input');
    url.className = 'group-editor__tab-url-input';
    url.type = 'url';
    url.placeholder = '输入要添加的网页地址（https://…）';
    url.setAttribute('aria-label', `新标签页 ${index + 1} 网址`);
    row.append(url);
  } else {
    const info = document.createElement('div');
    info.className = 'group-editor__tab-info';
    const title = document.createElement('span');
    title.className = 'group-editor__tab-title';
    title.textContent = tab.title || '网页标题由网站提供';
    const url = document.createElement('span');
    url.className = 'group-editor__tab-url';
    url.textContent = tab.url || '';
    info.append(title, url);
    row.append(info);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'group-editor__remove-tab icon-action is-danger';
  if (removable) {
    remove.innerHTML = icon('x', { size: 14 });
    remove.setAttribute('aria-label', '移除标签页');
    remove.dataset.tooltip = '移除标签';
    remove.setAttribute('aria-describedby', 'action-tooltip');
  }
  remove.disabled = !removable;
  remove.addEventListener('click', onRemove);
  row.append(remove);
  return row;
}

function makeGroupEditor(entry) {
  const editor = document.createElement('div');
  editor.className = 'group-editor';
  if (!entry.saved) {
    const note = document.createElement('p');
    note.className = 'group-editor__note';
    note.textContent = '此分组尚未保存快照。保存当前窗口分组后，可在这里编辑标签并用于恢复。';
    const saveCurrent = document.createElement('button');
    saveCurrent.type = 'button';
    saveCurrent.className = 'btn btn-primary btn-compact';
    saveCurrent.textContent = '保存当前窗口分组';
    saveCurrent.addEventListener('click', () => run(async () => {
      const result = await saveWindowGroups(windowId);
      setStatus(result.saved ? `已保存 ${result.saved} 个当前分组` : '当前窗口没有可保存的分组');
    }));
    editor.append(note, saveCurrent);
    return editor;
  }

  const tabs = document.createElement('div');
  tabs.className = 'group-editor__tabs';
  const appendTab = (tab, index) => {
    const row = makeTabRow(tab, index, true, () => row.remove());
    tabs.append(row);
  };
  (entry.saved.tabs || []).forEach(appendTab);

  const toolbar = document.createElement('div');
  toolbar.className = 'group-editor__toolbar';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'group-editor__text-action';
  add.textContent = '添加标签';
  add.addEventListener('click', () => {
    const row = makeTabRow({}, tabs.children.length, true, () => row.remove(), true);
    tabs.append(row);
    row.querySelector('.group-editor__tab-url-input').focus();
  });
  const save = makeIconButton('group-editor__icon-action is-primary', 'circle-check', '保存修改', '保存修改');
  save.addEventListener('click', () => run(async () => {
    const draftTabs = [...tabs.querySelectorAll('.group-editor__tab')].map((row) => ({
      title: row.dataset.title || '',
      url: row.querySelector('.group-editor__tab-url-input')?.value ?? row.dataset.url ?? '',
    }));
    await saveEditedGroup(entry.saved.id, { title: entry.title, tabs: draftTabs });
    setStatus(`已保存「${entry.title}」的标签修改`);
  }));
  toolbar.append(add, save);
  editor.append(tabs, toolbar);
  return editor;
}

function renderGroups() {
  els.empty.hidden = entries.length > 0;
  els.list.textContent = '';
  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = `group-item${expandedKeys.has(entry.key) ? ' is-expanded' : ''}`;
    item.dataset.key = entry.key;
    const row = document.createElement('div');
    row.className = 'group-row';
    row.dataset.groupId = entry.live ? String(entry.live.id) : '';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'group-row__check';
    check.value = entry.saved?.id || '';
    check.disabled = !entry.saved || busy;
    check.setAttribute('aria-label', `选择已保存分组 ${entry.title}`);
    check.addEventListener('change', updateActions);

    const bar = document.createElement('span');
    bar.className = 'group-row__bar';
    bar.style.background = GROUP_COLOR_HEX[entry.color] || GROUP_COLOR_HEX.grey;

    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'group-row__toggle';
    nameButton.setAttribute('aria-label', entry.live
      ? `${entry.title}，${entry.live.tabCount} 个标签页，点击${entry.live.collapsed ? '展开' : '收起'}`
      : `${entry.title}，${entry.count} 个标签页`);
    const name = document.createElement('span');
    name.className = 'group-row__name';
    const title = document.createElement('span');
    title.className = 'group-row__title';
    title.textContent = entry.title;
    name.append(title);
    if (entry.domain) {
      const domain = document.createElement('span');
      domain.className = 'group-row__domain';
      domain.textContent = entry.domain;
      name.append(domain);
    }
    const badges = document.createElement('span');
    badges.className = 'group-row__badges';
    if (entry.live) badges.append(makeBadge('当前窗口', 'live'));
    if (entry.saved) badges.append(makeBadge('已保存', 'saved'));
    nameButton.append(name, badges);
    nameButton.addEventListener('click', () => {
      if (!entry.live) {
        item.classList.toggle('is-expanded');
        expandedKeys.has(entry.key) ? expandedKeys.delete(entry.key) : expandedKeys.add(entry.key);
        refresh();
        return;
      }
      run(async () => {
        await setGroupCollapsed(entry.live.id, !entry.live.collapsed);
        setStatus(entry.live.collapsed ? '已展开该分组' : '已收起该分组');
      });
    });

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'group-row__icon-action group-row__rename';
    rename.innerHTML = icon('pencil', { size: 15 });
    rename.setAttribute('aria-label', `改名：${entry.title}`);
    rename.dataset.tooltip = '改名';
    rename.setAttribute('aria-describedby', 'action-tooltip');
    rename.addEventListener('click', () => startRename(entry, row));

    const count = document.createElement('span');
    count.className = 'group-row__count';
    count.textContent = String(entry.count);

    const expand = document.createElement('button');
    expand.type = 'button';
    const isExpanded = expandedKeys.has(entry.key);
    expand.className = 'group-row__icon-action group-row__details';
    expand.innerHTML = icon(isExpanded ? 'chevron-up' : 'chevron-down', { size: 15 });
    expand.setAttribute('aria-expanded', String(isExpanded));
    expand.setAttribute('aria-label', isExpanded ? '收起标签列表' : '展开标签列表');
    expand.dataset.tooltip = isExpanded ? '收起' : '展开';
    expand.setAttribute('aria-describedby', 'action-tooltip');
    expand.addEventListener('click', () => {
      if (expandedKeys.has(entry.key)) expandedKeys.delete(entry.key);
      else expandedKeys.add(entry.key);
      renderGroups();
    });

    row.append(check, bar, nameButton, count, rename, expand);
    item.append(row);
    const editor = makeGroupEditor(entry);
    editor.hidden = !expandedKeys.has(entry.key);
    item.append(editor);
    els.list.append(item);
  }
  updateActions();
}

async function refresh() {
  if (windowId === null) return;
  const [snapshot, names, saved] = await Promise.all([
    getGroupSnapshot(windowId),
    getCustomNames(),
    getSavedGroups(),
  ]);
  els.tabCount.textContent = `${snapshot.tabCount} 个标签页`;
  liveGroupCount = snapshot.groups.length;
  customNames = names;
  entries = mergeGroups(snapshot.groups, saved);
  renderGroups();
}

async function refreshShortcuts() {
  let commands = [];
  try { commands = await chrome.commands.getAll(); }
  catch (error) { console.error('[TabMerge] 读取快捷键失败：', error); }
  const byName = new Map(commands.map((command) => [command.name, command.shortcut || '']));
  document.querySelectorAll('.action[data-command]').forEach((button) => {
    const tip = button.querySelector('[data-tip]');
    if (tip) tip.textContent = byName.get(button.dataset.command) || '未绑定快捷键';
  });
}

async function run(task) {
  if (busy) return;
  busy = true;
  updateActions();
  try {
    await task();
  } catch (error) {
    console.error('[TabMerge] 操作失败：', error);
    setStatus(error?.message || '操作失败，请重试');
  }
  try { await refresh(); }
  finally { busy = false; updateActions(); }
}

els.btnGroup.addEventListener('click', () => run(async () => {
  const result = await groupTabsByDomain(windowId);
  if (result.groups === 0) {
    if (result.failed > 0) setStatus(`有 ${result.failed} 个分组创建失败，请重试`);
    else if (result.belowThreshold > 0) setStatus(`有 ${result.belowThreshold} 个域名的标签页少于阈值，未分组`);
    else setStatus('当前窗口没有可分组的标签页');
  } else {
    const failed = result.failed > 0 ? `，${result.failed} 组失败` : '';
    const threshold = result.belowThreshold > 0 ? `，${result.belowThreshold} 个域名因阈值未分组` : '';
    setStatus(`已按域名将 ${result.tabs} 个标签页分为 ${result.groups} 组${failed}${threshold}`);
  }
}));
els.btnCollapse.addEventListener('click', () => run(async () => {
  const affected = await setGroupsCollapsed(windowId, true);
  setStatus(affected > 0 ? `已收起 ${affected} 个分组` : '所有分组都已处于收起状态');
}));
els.btnExpand.addEventListener('click', () => run(async () => {
  const affected = await setGroupsCollapsed(windowId, false);
  setStatus(affected > 0 ? `已展开 ${affected} 个分组` : '所有分组都已处于展开状态');
}));
els.btnDissolve.addEventListener('click', () => run(async () => {
  const affected = await dissolveAllGroups(windowId);
  setStatus(affected > 0 ? `已解散 ${affected} 个分组，标签页全部保留` : '当前窗口没有分组');
}));
els.btnSaveGroups.addEventListener('click', () => run(async () => {
  const result = await saveWindowGroups(windowId);
  setStatus(result.saved
    ? `已保存或更新 ${result.saved} 个分组${result.skipped ? `，跳过 ${result.skipped} 个不含网页标签的分组` : ''}`
    : '当前窗口没有可保存的网页分组');
}));
els.btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.selectAll.addEventListener('change', () => {
  for (const check of els.list.querySelectorAll('.group-row__check:not(:disabled)')) check.checked = els.selectAll.checked;
  updateActions();
});
els.btnRestore.addEventListener('click', () => run(async () => {
  const result = await chrome.runtime.sendMessage({
    type: 'tabmerge:restore-saved-groups',
    ids: selectedSavedIds(),
    windowId,
  });
  if (result?.error) throw new Error(result.error);
  setStatus(`已恢复 ${result.groups} 组：复用了 ${result.reused} 个标签，新开 ${result.opened} 个${result.skipped ? `，跳过 ${result.skipped} 个` : ''}${result.failed ? `，${result.failed} 项失败` : ''}`);
}));
els.btnDeleteSelected.addEventListener('click', () => run(async () => {
  const ids = selectedSavedIds();
  await deleteSavedGroups(ids);
  setStatus(`已删除 ${ids.length} 个已选分组`);
}));

async function init() {
  globalThis.TabMergeTooltips.init();
  renderStaticIcons();
  try { windowId = (await chrome.windows.getCurrent())?.id ?? null; }
  catch { windowId = null; }
  if (windowId === null) {
    els.tabCount.textContent = '无法读取当前窗口';
    return;
  }
  await refreshShortcuts();
  await captureCustomNames(windowId);
  await refresh();
}

init();
