import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSettings,
  normalizeMinTabsPerGroup,
  DEFAULT_SETTINGS,
  MIN_TABS_RANGE,
} from '../extension/core/settings.js';

test('默认两个自动归组开关都关闭', () => {
  const settings = normalizeSettings({});
  assert.equal(settings.autoJoinGroup, false);
  assert.equal(settings.autoCreateGroup, false);
  assert.equal(DEFAULT_SETTINGS.autoJoinGroup, false);
  assert.equal(DEFAULT_SETTINGS.autoCreateGroup, false);
});

test('旧版 autoGroupNewTabs 会迁移成两个开关', () => {
  const settings = normalizeSettings({ autoGroupNewTabs: true });
  assert.equal(settings.autoJoinGroup, true);
  assert.equal(settings.autoCreateGroup, true);
});

test('旧版 autoGroupNewTabs 为 false 时两个开关都关闭', () => {
  const settings = normalizeSettings({ autoGroupNewTabs: false });
  assert.equal(settings.autoJoinGroup, false);
  assert.equal(settings.autoCreateGroup, false);
});

test('两个开关可以独立设置', () => {
  assert.equal(normalizeSettings({ autoJoinGroup: true }).autoCreateGroup, false);
  assert.equal(normalizeSettings({ autoCreateGroup: true }).autoJoinGroup, false);
});

test('新字段存在时不再读旧字段', () => {
  const settings = normalizeSettings({ autoGroupNewTabs: true, autoJoinGroup: false, autoCreateGroup: true });
  assert.equal(settings.autoJoinGroup, false);
  assert.equal(settings.autoCreateGroup, true);
});
test('最少标签页数默认不限制', () => {
  assert.equal(normalizeSettings({}).minTabsPerGroup, 1);
  assert.equal(DEFAULT_SETTINGS.minTabsPerGroup, 1);
});

test('最少标签页数归一化：只留整数并夹在区间内', () => {
  assert.equal(normalizeMinTabsPerGroup(3), 3);
  assert.equal(normalizeMinTabsPerGroup('4'), 4);
  assert.equal(normalizeMinTabsPerGroup(2.9), 2);
  assert.equal(normalizeMinTabsPerGroup(0), MIN_TABS_RANGE.min);
  assert.equal(normalizeMinTabsPerGroup(-1), MIN_TABS_RANGE.min);
  assert.equal(normalizeMinTabsPerGroup(999), MIN_TABS_RANGE.max);
  assert.equal(normalizeMinTabsPerGroup('x'), 1);
  assert.equal(normalizeMinTabsPerGroup(undefined), 1);
  assert.equal(normalizeMinTabsPerGroup(null), 1);
});

test('设置归一化保留最少标签页数', () => {
  assert.equal(normalizeSettings({ minTabsPerGroup: 3 }).minTabsPerGroup, 3);
  assert.equal(normalizeSettings({ minTabsPerGroup: 999 }).minTabsPerGroup, MIN_TABS_RANGE.max);
});
