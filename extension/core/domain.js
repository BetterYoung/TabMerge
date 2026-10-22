/**
 * 可注册域名（eTLD+1）解析与标签页过滤。
 * 零依赖 ESM：service worker、弹窗、设置页与 node --test 共用同一份实现。
 */

/** 公共后缀表中的「多级后缀」条目（2 段或 3 段），命中后 eTLD+1 需要再多取一段。 */
const MULTI_LABEL_SUFFIXES = new Set([
  // 中国大陆
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  // 港澳台
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  'com.mo', 'org.mo', 'net.mo', 'gov.mo', 'edu.mo',
  // 日韩
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'lg.jp', 'ad.jp', 'ed.jp', 'gr.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr', 'ac.kr',
  // 亚太
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz', 'school.nz',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'gov.in', 'ac.in', 'edu.in', 'res.in',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
  'co.id', 'or.id', 'ac.id', 'go.id', 'web.id', 'my.id', 'biz.id', 'sch.id',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'edu.sa',
  'com.eg', 'net.eg', 'org.eg', 'gov.eg', 'edu.eg',
  'com.ng', 'net.ng', 'org.ng', 'gov.ng', 'edu.ng',
  'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'edu.pk',
  'com.bd', 'net.bd', 'org.bd', 'gov.bd', 'edu.bd',
  'com.lk', 'net.lk', 'org.lk', 'gov.lk', 'edu.lk',
  // 欧洲
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'muni.il', 'k12.il',
  'com.gr', 'net.gr', 'org.gr', 'gov.gr', 'edu.gr',
  'com.cy', 'net.cy', 'org.cy', 'gov.cy', 'ac.cy',
  'com.es', 'org.es', 'nom.es', 'gob.es', 'edu.es',
  'com.pt', 'edu.pt', 'gov.pt', 'org.pt', 'net.pt',
  'com.it', 'edu.it', 'gov.it', 'org.it',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl',
  'com.ua', 'net.ua', 'org.ua', 'gov.ua', 'edu.ua', 'in.ua', 'kiev.ua',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'bel.tr',
  'com.ro', 'net.ro', 'org.ro', 'tm.ro', 'store.ro',
  'com.hr', 'com.rs', 'com.ba', 'com.mk', 'com.al', 'com.mt',
  'co.at', 'or.at', 'ac.at', 'gv.at', 'priv.at',
  'co.hu', 'info.hu', 'org.hu', 'priv.hu', 'sport.hu',
  // 美洲
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
  'com.co', 'net.co', 'org.co', 'gov.co', 'edu.co',
  'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.do', 'com.gt',
  'com.sv', 'com.hn', 'com.ni', 'com.pa', 'com.cu', 'com.pr', 'com.bs', 'com.tt',
  'co.cr', 'co.zw', 'co.zm', 'co.ug', 'co.ke', 'co.tz',
  // 常见托管 / SaaS 公共后缀
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'notion.site',
  'sharepoint.com', 'azurewebsites.net', 's3.amazonaws.com', 'cloudfront.net',
]);

/** 明确不参与分组的 URL 协议前缀。 */
const BLOCKED_PREFIXES = [
  'about:',
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'chrome-search:',
  'edge:',
  'devtools:',
  'view-source:',
  'brave:',
  'opera:',
  'vivaldi:',
];

/** 应用商店页面不参与分组。 */
const WEB_STORE_HOSTS = new Set([
  'chrome.google.com',
  'chromewebstore.google.com',
  'microsoftedge.microsoft.com',
]);

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 从 URL 中取出主机名（小写、去尾点）。
 * 只接受 http / https：浏览器内部页（chrome://、about: 等）没有可分组的域名。
 * 无法解析时返回 null。
 * @param {string} url
 * @returns {string|null}
 */
export function getHostname(url) {
  if (typeof url !== 'string' || !url) return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.hostname.toLowerCase().replace(/\.$/, '');
}

/**
 * 判断主机名是否为 IP 字面量（IPv4 / IPv6）。
 * @param {string} hostname
 */
export function isIpAddress(hostname) {
  if (!hostname) return false;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  return IPV4_RE.test(hostname);
}

/**
 * 取可注册域名（eTLD+1）。IP、单段主机名原样返回。
 * @param {string} hostname
 * @returns {string|null}
 */
export function getRegistrableDomain(hostname) {
  if (typeof hostname !== 'string') return null;
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (isIpAddress(host)) return host;

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 1) return host;

  const last3 = labels.slice(-3).join('.');
  if (MULTI_LABEL_SUFFIXES.has(last3)) {
    return labels.length >= 4 ? labels.slice(-4).join('.') : host;
  }
  const last2 = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(last2)) {
    return labels.length >= 3 ? labels.slice(-3).join('.') : host;
  }
  return last2;
}

/**
 * 判断该标签页是否可以被分组。
 * @param {{url?: string, pinned?: boolean, incognito?: boolean}} tab
 * @param {{skipPinned?: boolean}} [options]
 */
export function isGroupableTab(tab, options = {}) {
  const { skipPinned = true } = options;
  if (!tab || typeof tab.url !== 'string') return false;
  if (skipPinned && tab.pinned) return false;
  if (tab.incognito) return false;

  const url = tab.url.trim();
  if (!url) return false;
  const lower = url.toLowerCase();
  if (BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return false;
  if (WEB_STORE_HOSTS.has(hostname)) return false;
  return true;
}

/**
 * 计算标签页所属的分组键。
 * @param {string} url
 * @param {{granularity?: 'domain'|'host'}} [options]
 * @returns {string|null}
 */
export function getGroupKey(url, options = {}) {
  const { granularity = 'domain' } = options;
  const hostname = getHostname(url);
  if (!hostname) return null;
  if (granularity === 'host') return hostname;
  return getRegistrableDomain(hostname);
}

/**
 * 判断域名是否命中排除列表。
 * @param {string} key
 * @param {string[]} excludedDomains
 */
export function isExcluded(key, excludedDomains) {
  if (!key || !Array.isArray(excludedDomains) || excludedDomains.length === 0) return false;
  const target = key.toLowerCase();
  return excludedDomains.some((entry) => {
    if (typeof entry !== 'string') return false;
    const item = entry.trim().toLowerCase();
    if (!item) return false;
    return target === item || target.endsWith(`.${item}`) || item.endsWith(`.${target}`);
  });
}

/**
 * 依据标签页列表生成分组计划。组顺序按标签页首次出现位置，组内保持原有顺序。
 * @param {Array<{id?: number, url?: string, index?: number, pinned?: boolean}>} tabs
 * @param {{granularity?: 'domain'|'host', skipPinned?: boolean, excludedDomains?: string[]}} [options]
 * @returns {Array<{key: string, title: string, tabIds: number[]}>}
 */
export function planGroups(tabs, options = {}) {
  const {
    granularity = 'domain',
    skipPinned = true,
    excludedDomains = [],
  } = options;

  if (!Array.isArray(tabs)) return [];

  const buckets = new Map();
  for (const tab of tabs) {
    if (!isGroupableTab(tab, { skipPinned })) continue;
    const key = getGroupKey(tab.url, { granularity });
    if (!key) continue;
    if (isExcluded(key, excludedDomains)) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab.id);
  }

  return [...buckets.entries()].map(([key, tabIds]) => ({
    key,
    title: key,
    tabIds: tabIds.filter((id) => typeof id === 'number'),
  }));
}

/**
 * 按「最少标签页数」过滤分组计划：标签页数量不足阈值的域名不建组。
 * 阈值为 1（或非法值）表示不做限制。
 * @param {Array<{key: string, title: string, tabIds: number[]}>} plan
 * @param {number} minTabsPerGroup
 * @returns {Array<{key: string, title: string, tabIds: number[]}>}
 */
export function applyMinTabs(plan, minTabsPerGroup = 1) {
  if (!Array.isArray(plan)) return [];
  const num = Number(minTabsPerGroup);
  if (!Number.isFinite(num)) return plan;
  const min = Math.max(1, Math.floor(num));
  if (min <= 1) return plan;
  return plan.filter((entry) => Array.isArray(entry?.tabIds) && entry.tabIds.length >= min);
}
