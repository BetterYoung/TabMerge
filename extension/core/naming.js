/**
 * 自定义分组名：学习与应用。
 *
 * 用户在 Chrome 里重命名分组后，下次按域名分组时，同一域名沿用该名字。
 * 「域名」按当前分组粒度计算（可注册域名 / 完整主机名）。
 *
 * 本文件只放纯函数，便于单元测试；与 Chrome API 的交互在 groups.js。
 */

import { getGroupKey, isGroupableTab } from './domain.js';

/**
 * 取一组标签页共同的分组键；若标签页跨域则返回 null。
 * @param {Array<{url?: string}>} tabs
 * @param {'domain'|'host'} [granularity]
 * @returns {string|null}
 */
export function singleGroupKey(tabs, granularity = 'domain') {
  if (!Array.isArray(tabs)) return null;
  let key = null;
  for (const tab of tabs) {
    if (!isGroupableTab(tab, { skipPinned: false })) continue;
    const current = getGroupKey(tab.url, { granularity });
    if (!current) continue;
    if (key === null) {
      key = current;
    } else if (key !== current) {
      return null;
    }
  }
  return key;
}

/**
 * 依据当前分组状态推算自定义名映射。
 *
 * 规则：
 * - 分组标题与它的分组键不同 → 视为用户重命名，记为自定义名；
 * - 分组标题就是分组键 → 视为改回了默认名，清除该键的自定义名；
 * - 分组标题本身就是某个标签页的主机名 → 不视为自定义名（切换过分组粒度时会出现）。
 *
 * 同一域名若同时存在默认名分组与自定义名分组，以自定义名分组为准。
 *
 * @param {Record<string,string>} current 现有映射
 * @param {Array<{id:number,title:string}>} groups
 * @param {Array<{groupId:number,url:string}>} tabs
 * @param {{granularity?: 'domain'|'host'}} [options]
 * @returns {Record<string,string>}
 */
export function computeCustomNames(current, groups, tabs, options = {}) {
  const { granularity = 'domain' } = options;
  const result = { ...(current || {}) };

  const byGroup = new Map();
  for (const tab of tabs || []) {
    if (tab.groupId === undefined || tab.groupId === null || tab.groupId < 0) continue;
    if (!byGroup.has(tab.groupId)) byGroup.set(tab.groupId, []);
    byGroup.get(tab.groupId).push(tab);
  }

  const renamed = new Map();
  const defaulted = new Set();

  for (const group of groups || []) {
    const groupTabs = byGroup.get(group.id) || [];
    const key = singleGroupKey(groupTabs, granularity);
    if (!key) continue;
    const title = (group.title || '').trim();
    if (!title) continue;

    if (title === key) {
      defaulted.add(key);
      continue;
    }
    const isHostname = groupTabs.some(
      (tab) => getGroupKey(tab.url, { granularity: 'host' }) === title,
    );
    if (isHostname) continue;
    if (!renamed.has(key)) renamed.set(key, title);
  }

  for (const [key, title] of renamed) result[key] = title;
  for (const key of defaulted) {
    if (!renamed.has(key)) delete result[key];
  }
  return result;
}

/**
 * 取分组应显示的名称：有自定义名就用自定义名，否则用分组键本身。
 * @param {string} key
 * @param {Record<string,string>} customNames
 * @returns {string}
 */
export function resolveGroupTitle(key, customNames) {
  const custom = customNames ? customNames[key] : undefined;
  return typeof custom === 'string' && custom.trim() ? custom.trim() : key;
}

/**
 * 比较两个映射是否等价（忽略键顺序）。
 * @param {Record<string,string>} a
 * @param {Record<string,string>} b
 */
export function sameCustomNames(a, b) {
  const left = a || {};
  const right = b || {};
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}