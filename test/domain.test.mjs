import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHostname,
  getRegistrableDomain,
  getGroupKey,
  isExcluded,
  isGroupableTab,
  planGroups,
  applyMinTabs,
} from '../extension/core/domain.js';

test('getHostname 归一化大小写与尾点', () => {
  assert.equal(getHostname('https://Docs.Google.com/path'), 'docs.google.com');
  assert.equal(getHostname('https://example.com./'), 'example.com');
  assert.equal(getHostname('not a url'), null);
  assert.equal(getHostname(''), null);
  assert.equal(getHostname(undefined), null);
});

test('可注册域名：普通多级子域归并到 eTLD+1', () => {
  assert.equal(getRegistrableDomain('docs.google.com'), 'google.com');
  assert.equal(getRegistrableDomain('mail.google.com'), 'google.com');
  assert.equal(getRegistrableDomain('www.example.com'), 'example.com');
});

test('可注册域名：多段公共后缀', () => {
  assert.equal(getRegistrableDomain('a.b.co.uk'), 'b.co.uk');
  assert.equal(getRegistrableDomain('oa.corp.com.cn'), 'corp.com.cn');
  assert.equal(getRegistrableDomain('shop.example.co.jp'), 'example.co.jp');
  assert.equal(getRegistrableDomain('user.github.io'), 'user.github.io');
});

test('可注册域名：IP、localhost、单段主机名各自成组', () => {
  assert.equal(getRegistrableDomain('192.168.1.10'), '192.168.1.10');
  assert.equal(getRegistrableDomain('localhost'), 'localhost');
  assert.equal(getRegistrableDomain('intranet'), 'intranet');
  assert.equal(getRegistrableDomain(''), null);
});

test('分组键：domain 与 host 两种粒度', () => {
  assert.equal(getGroupKey('https://mail.google.com/x'), 'google.com');
  assert.equal(getGroupKey('https://mail.google.com/x', { granularity: 'host' }), 'mail.google.com');
  assert.equal(getGroupKey('chrome://settings'), null);
});

test('过滤：浏览器内部页与应用商店不参与分组', () => {
  assert.equal(isGroupableTab({ url: 'chrome://settings' }), false);
  assert.equal(isGroupableTab({ url: 'chrome-extension://abc/options.html' }), false);
  assert.equal(isGroupableTab({ url: 'about:blank' }), false);
  assert.equal(isGroupableTab({ url: 'https://chromewebstore.google.com/x' }), false);
  assert.equal(isGroupableTab({ url: 'chrome://newtab/' }), false);
});

test('过滤：固定标签页按设置跳过', () => {
  assert.equal(isGroupableTab({ url: 'https://a.com', pinned: true }), false);
  assert.equal(
    isGroupableTab({ url: 'https://a.com', pinned: true }, { skipPinned: false }),
    true,
  );
});

test('过滤：非法 URL 安全跳过', () => {
  assert.equal(isGroupableTab({ url: 'http://' }), false);
  assert.equal(isGroupableTab({}), false);
  assert.equal(isGroupableTab(null), false);
});

test('排除列表匹配自身与子域', () => {
  assert.equal(isExcluded('google.com', ['google.com']), true);
  assert.equal(isExcluded('mail.google.com', ['google.com']), true);
  assert.equal(isExcluded('notgoogle.com', ['google.com']), false);
  assert.equal(isExcluded('google.com', []), false);
  assert.equal(isExcluded('google.com', null), false);
});

test('分组计划：按域名归并，保留首次出现顺序', () => {
  const tabs = [
    { id: 1, url: 'https://github.com/a' },
    { id: 2, url: 'https://docs.google.com/b' },
    { id: 3, url: 'https://mail.google.com/c' },
    { id: 4, url: 'https://notion.so/d' },
  ];
  const plan = planGroups(tabs);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan[0], { key: 'github.com', title: 'github.com', tabIds: [1] });
  assert.deepEqual(plan[1], { key: 'google.com', title: 'google.com', tabIds: [2, 3] });
  assert.deepEqual(plan[2], { key: 'notion.so', title: 'notion.so', tabIds: [4] });
});

test('分组计划：跳过固定标签页与排除域名', () => {
  const tabs = [
    { id: 1, url: 'https://github.com/a', pinned: true },
    { id: 2, url: 'https://notion.so/d' },
    { id: 3, url: 'https://mail.google.com/c' },
  ];
  const plan = planGroups(tabs, { excludedDomains: ['google.com'] });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].tabIds, [2]);
});

test('分组计划：空输入不报错', () => {
  assert.deepEqual(planGroups([]), []);
  assert.deepEqual(planGroups(null), []);
  assert.deepEqual(planGroups(undefined), []);
});
test('最少标签页数：不足阈值的域名被剔除', () => {
  const plan = [
    { key: 'github.com', title: 'github.com', tabIds: [1] },
    { key: 'google.com', title: 'google.com', tabIds: [2, 3] },
    { key: 'notion.so', title: 'notion.so', tabIds: [4, 5, 6] },
  ];
  const filtered = applyMinTabs(plan, 2);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((e) => e.key), ['google.com', 'notion.so']);
});

test('最少标签页数：阈值为 1 或非法值时不限制', () => {
  const plan = [{ key: 'a.com', title: 'a.com', tabIds: [1] }];
  assert.equal(applyMinTabs(plan, 1).length, 1);
  assert.equal(applyMinTabs(plan, 0).length, 1);
  assert.equal(applyMinTabs(plan, -3).length, 1);
  assert.equal(applyMinTabs(plan, 'x').length, 1);
  assert.equal(applyMinTabs(plan, undefined).length, 1);
});

test('最少标签页数：阈值大于组内标签页数时全部剔除', () => {
  const plan = [{ key: 'a.com', title: 'a.com', tabIds: [1] }];
  assert.deepEqual(applyMinTabs(plan, 3), []);
});

test('最少标签页数：空输入不报错', () => {
  assert.deepEqual(applyMinTabs(null, 2), []);
  assert.deepEqual(applyMinTabs(undefined, 2), []);
});
