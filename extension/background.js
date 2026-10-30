/**
 * TabMerge service worker。
 * 负责：快捷键命令分发、新标签页自动归组。
 * 分组操作由弹窗与设置页调用；跨页面恢复请求在此串行协调。
 */

import {
  groupTabsByDomain,
  setGroupsCollapsed,
  dissolveAllGroups,
  autoGroupTab,
  captureCustomNames,
} from './core/groups.js';
import { getSettings } from './core/settings.js';
import { restoreSavedGroups } from './core/saved-groups.js';

/**
 * 取命令的目标窗口。service worker 里的 currentWindow 指向最后聚焦窗口，
 * 这里显式取最后聚焦的普通窗口，避免歧义。
 * @returns {Promise<number|null>}
 */
async function getTargetWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win?.id ?? null;
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  console.info('[TabMerge] 已安装，当前设置：', settings);
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[TabMerge] 浏览器启动');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-saved-groups') {
    const windowId = await getTargetWindowId();
    await chrome.tabs.create({
      ...(windowId === null ? {} : { windowId }),
      url: chrome.runtime.getURL('options/options.html#sec-groups'),
    });
    return;
  }
  const windowId = await getTargetWindowId();
  if (windowId === null) return;
  try {
    switch (command) {
      case 'group-tabs':
        await groupTabsByDomain(windowId);
        break;
      case 'collapse-all':
        await setGroupsCollapsed(windowId, true);
        break;
      case 'expand-all':
        await setGroupsCollapsed(windowId, false);
        break;
      case 'dissolve-all':
        await dissolveAllGroups(windowId);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error('[TabMerge] 命令执行失败：', command, error);
  }
});

/**
 * 恢复操作期间暂停自动归组，避免它与恢复流程同时移动标签页。
 */
let activeRestoreCount = 0;
const restoredTabIds = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'tabmerge:restore-saved-groups' || sender.id !== chrome.runtime.id) {
    return false;
  }
  activeRestoreCount += 1;
  restoreSavedGroups(message.ids, message.windowId)
    .then(({ touchedTabIds = [], ...result }) => {
      for (const tabId of touchedTabIds) {
        restoredTabIds.add(tabId);
        setTimeout(() => restoredTabIds.delete(tabId), 5000);
      }
      sendResponse(result);
    })
    .catch((error) => sendResponse({ error: error?.message || '恢复失败' }))
    .finally(() => {
      activeRestoreCount = Math.max(0, activeRestoreCount - 1);
    });
  return true;
});

/** 自动归组的新标签页做去抖，避免同一批标签页重复触发。 */
const pendingTabs = new Map();

function scheduleAutoGroup(tabId) {
  if (activeRestoreCount > 0 || restoredTabIds.has(tabId)) return;
  if (pendingTabs.has(tabId)) return;
  pendingTabs.set(tabId, true);
  setTimeout(async () => {
    pendingTabs.delete(tabId);
    if (activeRestoreCount > 0 || restoredTabIds.has(tabId)) return;
    try {
      const settings = await getSettings();
      if (!settings.autoJoinGroup && !settings.autoCreateGroup) return;
      await autoGroupTab(tabId);
    } catch (error) {
      console.error('[TabMerge] 自动归组失败：', tabId, error);
    }
  }, 400);
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined) scheduleAutoGroup(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) scheduleAutoGroup(tabId);
});

/**
 * 标签页被关闭时分组可能随之被 Chrome 回收，趁还在时把用户的重命名记下来。
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;
  captureCustomNames(removeInfo.windowId).catch(() => {});
});
