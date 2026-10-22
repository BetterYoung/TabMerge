/**
 * 分组执行器：分组、折叠、展开、解散，以及自定义分组名的学习与应用。
 * 弹窗与 service worker 共用；窗口 id 由调用方显式传入，避免 currentWindow 在
 * service worker 中指向最后聚焦窗口的歧义。
 */

import { planGroups, applyMinTabs, getGroupKey, isExcluded, isGroupableTab } from './domain.js';
import { getSettings, getCustomNames, saveCustomNames } from './settings.js';
import {
  computeCustomNames,
  resolveGroupTitle,
  sameCustomNames,
  singleGroupKey,
} from './naming.js';

/** Chrome 标签组的 8 种原生配色，按此顺序轮转。 */
export const GROUP_COLOR_ORDER = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan',
];

/** 与 Chrome 标签组一致的色值，用于界面上的色条。 */
export const GROUP_COLOR_HEX = {
  grey: '#9AA0A6',
  blue: '#1A73E8',
  red: '#D93025',
  yellow: '#F9AB00',
  green: '#1E8E3E',
  pink: '#F538A0',
  purple: '#9334E6',
  cyan: '#12B5CB',
};

/** chrome.tabs.groupId 为该值时表示未分组。 */
const NO_GROUP = -1;

const MANAGED_KEY = 'managedGroups';
/** groupId → 分组键，用于在分组被改名后仍能找回它。 */
const INDEX_KEY = 'groupIndex';

/* ------------------------------------------------------------ 会话内索引 */

/**
 * 读取本扩展在某窗口内创建的分组 id 列表。
 * @param {number} windowId
 * @returns {Promise<number[]>}
 */
export async function getManagedGroupIds(windowId) {
  try {
    const stored = await chrome.storage.session.get(MANAGED_KEY);
    const map = stored?.[MANAGED_KEY] || {};
    const ids = map[String(windowId)];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * 记录本扩展创建的分组 id（按窗口隔离）。
 * @param {number} windowId
 * @param {number[]} groupIds
 */
export async function rememberManagedGroupIds(windowId, groupIds) {
  try {
    const stored = await chrome.storage.session.get(MANAGED_KEY);
    const map = stored?.[MANAGED_KEY] || {};
    map[String(windowId)] = groupIds;
    await chrome.storage.session.set({ [MANAGED_KEY]: map });
  } catch {
    /* 会话存储不可用时静默降级，不影响主流程 */
  }
}

/**
 * 清空某窗口内记录的分组 id。
 * @param {number} windowId
 */
export async function clearManagedGroupIds(windowId) {
  try {
    const stored = await chrome.storage.session.get(MANAGED_KEY);
    const map = stored?.[MANAGED_KEY] || {};
    delete map[String(windowId)];
    await chrome.storage.session.set({ [MANAGED_KEY]: map });
  } catch {
    /* 同上 */
  }
}

/**
 * 读取窗口内「分组 id → 分组键」索引。
 * @param {number} windowId
 * @returns {Promise<Record<string,string>>}
 */
export async function getGroupIndex(windowId) {
  try {
    const stored = await chrome.storage.session.get(INDEX_KEY);
    const map = stored?.[INDEX_KEY] || {};
    const index = map[String(windowId)];
    return index && typeof index === 'object' ? index : {};
  } catch {
    return {};
  }
}

/**
 * 写入窗口内「分组 id → 分组键」索引。
 * @param {number} windowId
 * @param {Record<string,string>} index
 */
export async function setGroupIndex(windowId, index) {
  try {
    const stored = await chrome.storage.session.get(INDEX_KEY);
    const map = stored?.[INDEX_KEY] || {};
    map[String(windowId)] = index;
    await chrome.storage.session.set({ [INDEX_KEY]: map });
  } catch {
    /* 同上 */
  }
}

/* ---------------------------------------------------------------- 查询 */

/**
 * 取出窗口内所有标签页。
 * @param {number} windowId
 */
export async function getWindowTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/**
 * 取出窗口内所有标签组。
 * @param {number} windowId
 */
export async function getWindowGroups(windowId) {
  return chrome.tabGroups.query({ windowId });
}

/* -------------------------------------------------------- 自定义分组名 */

/**
 * 学习窗口内被用户重命名过的分组，写入设置。
 *
 * 必须在解散分组之前调用——分组一旦解除就再也读不到它的标题了。
 *
 * @param {number} windowId
 * @returns {Promise<Record<string,string>>} 当前生效的自定义名映射
 */
export async function captureCustomNames(windowId) {
  const settings = await getSettings();
  const current = await getCustomNames();
  const [tabs, groups] = await Promise.all([
    getWindowTabs(windowId),
    getWindowGroups(windowId),
  ]);
  const next = computeCustomNames(current, groups, tabs, {
    granularity: settings.granularity,
  });
  if (!sameCustomNames(next, current)) {
    await saveCustomNames(next);
  }
  return next;
}

/* ---------------------------------------------------------------- 分组 */

/**
 * 解除本扩展此前创建的分组（不触碰用户手工创建的组）。
 * @param {number} windowId
 */
export async function dissolveManagedGroups(windowId) {
  const managed = await getManagedGroupIds(windowId);
  if (managed.length === 0) return 0;
  const groups = await getWindowGroups(windowId);
  const alive = new Set(groups.map((g) => g.id));
  const tabIds = [];
  for (const group of groups) {
    if (!managed.includes(group.id)) continue;
    const tabs = await chrome.tabs.query({ groupId: group.id });
    for (const tab of tabs) tabIds.push(tab.id);
  }
  if (tabIds.length > 0) {
    // tabs.ungroup 的签名是位置参数（单个 id 或 id 数组），不是对象
    await chrome.tabs.ungroup(tabIds);
  }
  await clearManagedGroupIds(windowId);
  await setGroupIndex(windowId, {});
  return alive.size;
}

/**
 * 按域名把窗口内标签页分组。同域名沿用用户自定义过的分组名。
 * @param {number} windowId
 * @param {object} [options]
 * @returns {Promise<{groups: number, tabs: number, skipped: number, belowThreshold: number, failed: number}>}
 */
export async function groupTabsByDomain(windowId, options = {}) {
  const settings = { ...(await getSettings()), ...(options || {}) };

  // 先学习用户做过的重命名，再解散旧组——解除后就读不到原标题了
  const customNames = await captureCustomNames(windowId);
  await dissolveManagedGroups(windowId);

  const tabs = await getWindowTabs(windowId);
  const rawPlan = planGroups(tabs, {
    granularity: settings.granularity,
    skipPinned: settings.skipPinned,
    excludedDomains: settings.excludedDomains,
  });
  // 标签页数量不足阈值的域名不建组，避免标签栏里出现一长串单标签分组
  const plan = applyMinTabs(rawPlan, settings.minTabsPerGroup);
  const belowThreshold = rawPlan.length - plan.length;

  const created = [];
  const index = {};
  let failed = 0;
  for (let i = 0; i < plan.length; i += 1) {
    const entry = plan[i];
    if (entry.tabIds.length === 0) continue;
    const color = GROUP_COLOR_ORDER[i % GROUP_COLOR_ORDER.length];
    const title = resolveGroupTitle(entry.key, customNames);
    try {
      // tabs.group 的 createProperties 只支持 windowId；标题与颜色要用 tabGroups.update 设置
      const groupId = await chrome.tabs.group({ tabIds: entry.tabIds });
      await chrome.tabGroups.update(groupId, { title, color });
      created.push(groupId);
      index[String(groupId)] = entry.key;
    } catch (error) {
      failed += 1;
      console.error('[TabMerge] 创建分组失败：', title, error);
    }
  }
  await rememberManagedGroupIds(windowId, created);
  await setGroupIndex(windowId, index);

  const groupedTabs = plan.reduce((sum, entry) => sum + entry.tabIds.length, 0);
  return {
    groups: created.length,
    tabs: groupedTabs,
    skipped: tabs.length - groupedTabs,
    belowThreshold,
    failed,
  };
}

/**
 * 批量折叠 / 展开窗口内所有分组。
 * @param {number} windowId
 * @param {boolean} collapsed
 * @returns {Promise<number>} 受影响的分组数
 */
export async function setGroupsCollapsed(windowId, collapsed) {
  const groups = await getWindowGroups(windowId);
  let affected = 0;
  for (const group of groups) {
    if (group.collapsed === collapsed) continue;
    try {
      await chrome.tabGroups.update(group.id, { collapsed });
      affected += 1;
    } catch {
      /* 忽略单个失败 */
    }
  }
  return affected;
}

/**
 * 切换单个分组的折叠状态。
 * @param {number} groupId
 * @param {boolean} collapsed
 */
export async function setGroupCollapsed(groupId, collapsed) {
  await chrome.tabGroups.update(groupId, { collapsed });
  return collapsed;
}

/**
 * 解散窗口内所有分组（保留全部标签页）。自定义分组名会保留下来。
 * @param {number} windowId
 * @returns {Promise<number>} 被解散的分组数
 */
export async function dissolveAllGroups(windowId) {
  // 解散前先学习重命名，否则标题会随分组一起消失
  await captureCustomNames(windowId);
  const groups = await getWindowGroups(windowId);
  if (groups.length === 0) return 0;
  const tabIds = [];
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    for (const tab of tabs) tabIds.push(tab.id);
  }
  if (tabIds.length > 0) {
    await chrome.tabs.ungroup(tabIds);
  }
  await clearManagedGroupIds(windowId);
  await setGroupIndex(windowId, {});
  return groups.length;
}

/**
 * 读取窗口内的分组快照，用于界面渲染。
 * @param {number} windowId
 * @returns {Promise<{tabCount: number, groups: Array<object>}>}
 */
export async function getGroupSnapshot(windowId) {
  const settings = await getSettings();
  const [tabs, groups] = await Promise.all([
    getWindowTabs(windowId),
    getWindowGroups(windowId),
  ]);
  const byGroup = new Map();
  for (const tab of tabs) {
    if (tab.groupId === undefined || tab.groupId === NO_GROUP) continue;
    if (!byGroup.has(tab.groupId)) byGroup.set(tab.groupId, []);
    byGroup.get(tab.groupId).push(tab);
  }
  return {
    tabCount: tabs.length,
    groups: groups.map((group) => {
      const groupTabs = byGroup.get(group.id) || [];
      const title = group.title || '';
      const domain = singleGroupKey(groupTabs, settings.granularity);
      return {
        id: group.id,
        title,
        domain,
        custom: Boolean(domain && title !== domain),
        color: group.color || 'grey',
        collapsed: Boolean(group.collapsed),
        tabCount: groupTabs.length,
        tabIds: groupTabs.map((tab) => tab.id),
      };
    }),
  };
}

/**
 * 把单个标签页并入匹配的域名分组；没有匹配分组时新建一个。
 * @param {number} tabId
 * @returns {Promise<string|null>} 归入的分组名
 */
export async function autoGroupTab(tabId) {
  const settings = await getSettings();
  const joinEnabled = settings.autoJoinGroup;
  const createEnabled = settings.autoCreateGroup;
  if (!joinEnabled && !createEnabled) return null;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
  if (!isGroupableTab(tab, { skipPinned: settings.skipPinned })) return null;

  const key = getGroupKey(tab.url, { granularity: settings.granularity });
  if (!key || isExcluded(key, settings.excludedDomains)) return null;

  const windowId = tab.windowId;
  const customNames = await getCustomNames();
  const title = resolveGroupTitle(key, customNames);

  const groups = await getWindowGroups(windowId);
  const index = await getGroupIndex(windowId);

  // 先按索引找（分组可能已被改名），再按标题找
  let target = groups.find((group) => index[String(group.id)] === key);
  if (!target) target = groups.find((group) => group.title === key || group.title === title);

  if (target) {
    // 有对应分组：只有开启「并入」才动它
    if (!joinEnabled) return null;
    try {
      await chrome.tabs.group({ tabIds: [tabId], groupId: target.id });
      return key;
    } catch {
      return null;
    }
  }

  // 没有对应分组：只有开启「新建」才建
  if (!createEnabled) return null;

  // 阈值大于 1 时，先看窗口内同域名的散放标签页够不够数：
  // 不够就继续散放，等攒够了再把它们一起归入新组
  const minTabs = settings.minTabsPerGroup || 1;
  let tabIds = [tabId];
  if (minTabs > 1) {
    const siblings = await getWindowTabs(windowId);
    const candidates = siblings.filter((tab) => {
      if (tab.groupId !== undefined && tab.groupId !== NO_GROUP) return false;
      if (!isGroupableTab(tab, { skipPinned: settings.skipPinned })) return false;
      return getGroupKey(tab.url, { granularity: settings.granularity }) === key;
    });
    if (candidates.length < minTabs) return null;
    const ids = candidates.map((tab) => tab.id).filter((id) => typeof id === 'number');
    if (!ids.includes(tabId)) ids.push(tabId);
    tabIds = ids;
  }

  const color = GROUP_COLOR_ORDER[groups.length % GROUP_COLOR_ORDER.length];
  try {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title, color });
    const managed = await getManagedGroupIds(windowId);
    await rememberManagedGroupIds(windowId, [...managed, groupId]);
    const nextIndex = await getGroupIndex(windowId);
    nextIndex[String(groupId)] = key;
    await setGroupIndex(windowId, nextIndex);
    return key;
  } catch (error) {
    console.error('[TabMerge] 自动归组失败：', key, error);
    return null;
  }
}

