import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCustomNames,
  resolveGroupTitle,
  sameCustomNames,
  singleGroupKey,
} from '../extension/core/naming.js';

const tab = (groupId, url) => ({ groupId, url });

test('分组键：同域取该域，跨域返回 null', () => {
  assert.equal(singleGroupKey([tab(1, 'https://a.google.com/x')], 'domain'), 'google.com');
  assert.equal(singleGroupKey([tab(1, 'https://a.google.com/x')], 'host'), 'a.google.com');
  assert.equal(
    singleGroupKey([tab(1, 'https://a.google.com/x'), tab(1, 'https://b.notion.so/y')], 'domain'),
    null,
  );
  assert.equal(singleGroupKey([], 'domain'), null);
});

test('重命名被记为自定义名', () => {
  const result = computeCustomNames(
    {},
    [{ id: 1, title: '工作' }],
    [tab(1, 'https://github.com/a'), tab(1, 'https://github.com/b')],
    { granularity: 'domain' },
  );
  assert.deepEqual(result, { 'github.com': '工作' });
});

test('标题等于分组键时视为改回默认名，清除自定义', () => {
  const result = computeCustomNames(
    { 'github.com': '工作' },
    [{ id: 1, title: 'github.com' }],
    [tab(1, 'https://github.com/a')],
    { granularity: 'domain' },
  );
  assert.deepEqual(result, {});
});

test('标题本身就是主机名时不视为自定义名（切换过粒度）', () => {
  const result = computeCustomNames(
    {},
    [{ id: 1, title: 'docs.google.com' }],
    [tab(1, 'https://docs.google.com/a')],
    { granularity: 'domain' },
  );
  assert.deepEqual(result, {});
});

test('跨域分组不参与学习', () => {
  const result = computeCustomNames(
    {},
    [{ id: 1, title: '杂项' }],
    [tab(1, 'https://github.com/a'), tab(1, 'https://notion.so/b')],
    { granularity: 'domain' },
  );
  assert.deepEqual(result, {});
});

test('同一域名同时存在默认名分组与自定义名分组时以自定义名为准', () => {
  const result = computeCustomNames(
    {},
    [
      { id: 1, title: 'github.com' },
      { id: 2, title: '工作' },
    ],
    [tab(1, 'https://github.com/a'), tab(2, 'https://github.com/b')],
    { granularity: 'domain' },
  );
  assert.deepEqual(result, { 'github.com': '工作' });
});

test('主机名粒度下按主机名学习', () => {
  const result = computeCustomNames(
    {},
    [{ id: 1, title: '设计' }],
    [tab(1, 'https://docs.google.com/a')],
    { granularity: 'host' },
  );
  assert.deepEqual(result, { 'docs.google.com': '设计' });
});

test('未分组的标签页不影响结果', () => {
  const result = computeCustomNames(
    {},
    [{ id: 1, title: '工作' }],
    [tab(1, 'https://github.com/a'), tab(-1, 'https://notion.so/b')],
    { granularity: 'domain' },
  );
  assert.deepEqual(result, { 'github.com': '工作' });
});

test('resolveGroupTitle 优先用自定义名', () => {
  assert.equal(resolveGroupTitle('github.com', { 'github.com': '工作' }), '工作');
  assert.equal(resolveGroupTitle('github.com', {}), 'github.com');
  assert.equal(resolveGroupTitle('github.com', { 'github.com': '   ' }), 'github.com');
  assert.equal(resolveGroupTitle('github.com', null), 'github.com');
});

test('sameCustomNames 忽略键顺序', () => {
  assert.equal(sameCustomNames({ a: '1', b: '2' }, { b: '2', a: '1' }), true);
  assert.equal(sameCustomNames({ a: '1' }, { a: '2' }), false);
  assert.equal(sameCustomNames({ a: '1' }, { a: '1', b: '2' }), false);
});