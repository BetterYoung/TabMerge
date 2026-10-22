import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(projectRoot, 'extension');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(extensionDir);
const read = (rel) => readFileSync(join(extensionDir, rel), 'utf8');

test('manifest 可解析且权限最小化', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['storage', 'tabGroups', 'tabs']);
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(manifest.action.default_popup);
  assert.ok(manifest.options_ui.page);
});

test('manifest 声明了 4 条带建议键位的命令', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const names = Object.keys(manifest.commands);
  assert.equal(names.length, 4);
  for (const name of names) {
    assert.ok(manifest.commands[name].description, `${name} 缺少描述`);
    assert.ok(manifest.commands[name].suggested_key?.default, `${name} 缺少默认键位`);
  }
});

test('页面与脚本不含远程资源与 eval', () => {
  const remotePatterns = [
    /https?:\/\/[^"'\s)]+\.(?:js|css|woff2?|png|jpg|svg)/i,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
  ];
  for (const file of files) {
    if (!['.html', '.js', '.css'].includes(extname(file))) continue;
    const content = readFileSync(file, 'utf8');
    for (const pattern of remotePatterns) {
      assert.equal(pattern.test(content), false, `${file} 命中禁止模式 ${pattern}`);
    }
  }
});

test('核心模块不依赖 Chrome 专属 API（便于单元测试）', () => {
  const content = read('core/domain.js');
  const apiUsage = /\bchrome\.(tabs|storage|runtime|windows|tabGroups|commands|action)\b/;
  assert.equal(apiUsage.test(content), false);
});