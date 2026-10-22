/**
 * 扩展设置：读写 chrome.storage.sync，并做类型归一化。
 */

export const SETTINGS_KEY = 'settings';
/** 自定义分组名单独存一条，避免和设置项共用 8KB 同步配额。 */
export const CUSTOM_NAMES_KEY = 'customNames';

/** 自定义分组名的条数上限，避免同步存储超限。 */
const MAX_CUSTOM_NAMES = 120;

export const DEFAULT_SETTINGS = {
  /** 'domain' = 可注册域名；'host' = 完整主机名 */
  granularity: 'domain',
  /** 不参与分组的域名列表 */
  excludedDomains: [],
  /** 跳过固定标签页 */
  skipPinned: true,
  /** 新打开的标签页自动并入已有的同域名分组 */
  autoJoinGroup: false,
  /** 没有对应分组时自动新建一个 */
  autoCreateGroup: false,
  /** 同一域名至少要有多少个标签页才建组；1 = 不限制 */
  minTabsPerGroup: 1,
};

/** 最少标签页数的取值区间。 */
export const MIN_TABS_RANGE = { min: 1, max: 20 };

/**
 * 归一化「最少标签页数」：只接受整数，落在 1~20，越界截断，非法值回落到 1。
 * @param {any} value
 * @returns {number}
 */
export function normalizeMinTabsPerGroup(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  const int = Math.floor(num);
  if (int < MIN_TABS_RANGE.min) return MIN_TABS_RANGE.min;
  if (int > MIN_TABS_RANGE.max) return MIN_TABS_RANGE.max;
  return int;
}

function normalizeExcludedDomains(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const item = entry.trim().toLowerCase();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeCustomNames(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  let count = 0;
  for (const [rawKey, rawName] of Object.entries(value)) {
    if (count >= MAX_CUSTOM_NAMES) break;
    if (typeof rawKey !== 'string' || typeof rawName !== 'string') continue;
    const key = rawKey.trim().toLowerCase();
    const name = rawName.trim();
    if (!key || !name || name === key) continue;
    out[key] = name;
    count += 1;
  }
  return out;
}

/**
 * 把任意输入归一化为合法设置对象。
 * @param {any} raw
 */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // 兼容旧版单一的 autoGroupNewTabs 开关：拆成两个后沿用原值
  const legacyAuto = source.autoGroupNewTabs === true;
  const hasSplitFlags =
    'autoJoinGroup' in source || 'autoCreateGroup' in source;
  return {
    granularity: source.granularity === 'host' ? 'host' : 'domain',
    excludedDomains: normalizeExcludedDomains(source.excludedDomains),
    skipPinned: source.skipPinned !== false,
    autoJoinGroup: hasSplitFlags ? source.autoJoinGroup === true : legacyAuto,
    autoCreateGroup: hasSplitFlags ? source.autoCreateGroup === true : legacyAuto,
    minTabsPerGroup: normalizeMinTabsPerGroup(source.minTabsPerGroup),
  };
}

/**
 * 读取当前设置。
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    return normalizeSettings(stored?.[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 读取已记住的自定义分组名（分组键 → 分组名）。
 * @returns {Promise<Record<string,string>>}
 */
export async function getCustomNames() {
  try {
    const stored = await chrome.storage.sync.get(CUSTOM_NAMES_KEY);
    return normalizeCustomNames(stored?.[CUSTOM_NAMES_KEY]);
  } catch {
    return {};
  }
}

/**
 * 覆盖写入自定义分组名。
 * @param {Record<string,string>} names
 */
export async function saveCustomNames(names) {
  const next = normalizeCustomNames(names);
  try {
    await chrome.storage.sync.set({ [CUSTOM_NAMES_KEY]: next });
  } catch (error) {
    // 配额超限时退回「删掉最旧的若干条再存」，保证至少能记住一部分
    console.error('[TabMerge] 保存自定义分组名失败：', error);
    const entries = Object.entries(next);
    while (entries.length > 1) {
      entries.shift();
      try {
        await chrome.storage.sync.set({ [CUSTOM_NAMES_KEY]: Object.fromEntries(entries) });
        return Object.fromEntries(entries);
      } catch {
        /* 继续缩减 */
      }
    }
    return {};
  }
  return next;
}

/**
 * 合并写入设置。
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...(patch || {}) });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}
