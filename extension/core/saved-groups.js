/**
 * 跨浏览器重启保存的分组快照。网址与标题只写入 storage.local。
 */

import { getGroupSnapshot } from './groups.js';

export const SAVED_GROUPS_KEY = 'savedGroups';

export async function getSavedGroups() {
  const data = await chrome.storage.local.get(SAVED_GROUPS_KEY);
  const groups = data?.[SAVED_GROUPS_KEY];
  return Array.isArray(groups) ? groups : [];
}

/** 将当前窗口的分组保存到本地库；同一组再次保存时覆盖旧快照。 */
export async function saveWindowGroups(windowId) {
  const snapshot = await getGroupSnapshot(windowId);
  const saved = await getSavedGroups();
  const next = [...saved];
  let savedCount = 0;
  let skippedCount = 0;
  for (const group of snapshot.groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const entries = tabs
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .filter((tab) => typeof tab.url === 'string' && /^https?:\/\//i.test(tab.url))
      .map((tab) => ({ url: tab.url, title: tab.title || tab.url }));
    if (entries.length === 0) {
      skippedCount += 1;
      continue;
    }

    const hostKey = [...new Set(entries.map(({ url }) => {
      try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
    }).filter(Boolean))].sort();
    const sourceKey = JSON.stringify([group.title, group.domain, hostKey]);
    const previousIndex = next.findIndex((item) => item.sourceKey === sourceKey);
    const item = {
      id: previousIndex >= 0 ? next[previousIndex].id : crypto.randomUUID(),
      sourceKey,
      title: group.title || group.domain || '未命名分组',
      domain: group.domain || hostKey.join('、'),
      color: group.color || 'grey',
      collapsed: Boolean(group.collapsed),
      tabs: entries,
      savedAt: new Date().toISOString(),
    };
    if (previousIndex >= 0) next[previousIndex] = item;
    else next.unshift(item);
    savedCount += 1;
  }

  await chrome.storage.local.set({ [SAVED_GROUPS_KEY]: next });
  return { saved: savedCount, skipped: skippedCount };
}

export async function deleteSavedGroups(ids) {
  const remove = new Set(Array.isArray(ids) ? ids : []);
  const groups = await getSavedGroups();
  const next = groups.filter((item) => !remove.has(item.id));
  await chrome.storage.local.set({ [SAVED_GROUPS_KEY]: next });
  return groups.length - next.length;
}

/** 保存分组库中的手动编辑内容。 */
export async function saveEditedGroup(id, draft) {
  const groups = await getSavedGroups();
  const index = groups.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('这个保存项已不存在');
  const title = String(draft?.title || '').trim();
  if (!title) throw new Error('分组名称不能为空');
  const tabs = (Array.isArray(draft.tabs) ? draft.tabs : []).map((tab) => {
    const url = String(tab?.url || '').trim();
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error(`网址无效：${url || '空白网址'}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 HTTP 或 HTTPS 网址');
    return { url: parsed.href, title: String(tab?.title || '').trim() || parsed.hostname };
  });
  if (tabs.length === 0) throw new Error('至少保留一个标签页');
  const previous = groups[index];
  const hostKey = [...new Set(tabs.map(({ url }) => new URL(url).hostname.toLowerCase()))].sort();
  groups[index] = {
    ...previous,
    title,
    domain: hostKey.join('、'),
    sourceKey: JSON.stringify([title, hostKey.join('、'), hostKey]),
    tabs,
    savedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [SAVED_GROUPS_KEY]: groups });
  return groups[index];
}

/**
 * 在目标窗口恢复所选快照：按 URL 多重集合复用现有未固定标签，缺少的才新建。
 */
export async function restoreSavedGroups(ids, windowId) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  const saved = await getSavedGroups();
  const selected = saved.filter((item) => wanted.has(item.id));
  if (selected.length === 0) return { groups: 0, reused: 0, opened: 0, skipped: 0, failed: 0 };

  const win = await chrome.windows.get(windowId);
  if (!win || win.type !== 'normal') throw new Error('找不到要恢复到的浏览器窗口');
  const currentTabs = await chrome.tabs.query({ windowId });
  const byUrl = new Map();
  for (const tab of currentTabs) {
    const url = tab.url || tab.pendingUrl;
    if (tab.pinned || !url || url.startsWith('chrome-extension://')) continue;
    const queue = byUrl.get(url) || [];
    queue.push(tab);
    byUrl.set(url, queue);
  }

  const used = new Set();
  const result = { groups: 0, reused: 0, opened: 0, skipped: 0, failed: 0, touchedTabIds: [] };
  for (const item of selected) {
    const tabIds = [];
    for (const entry of Array.isArray(item.tabs) ? item.tabs : []) {
      if (!entry?.url || !/^https?:\/\//i.test(entry.url)) {
        result.skipped += 1;
        continue;
      }
      const candidates = byUrl.get(entry.url) || [];
      const match = candidates.find((tab) => !used.has(tab.id));
      if (match) {
        used.add(match.id);
        tabIds.push(match.id);
        result.touchedTabIds.push(match.id);
        result.reused += 1;
        continue;
      }
      try {
        const tab = await chrome.tabs.create({ windowId, url: entry.url, active: false });
        if (typeof tab.id === 'number') {
          used.add(tab.id);
          tabIds.push(tab.id);
          result.touchedTabIds.push(tab.id);
          result.opened += 1;
        } else result.failed += 1;
      } catch {
        result.failed += 1;
      }
    }

    if (tabIds.length === 0) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: item.title || '',
        color: item.color || 'grey',
      });
      if (item.collapsed) await chrome.tabGroups.update(groupId, { collapsed: true });
      result.groups += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
