import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const versions = JSON.parse(read('versions.json'));
assert.equal(manifest.id, 'dragon-scroll-home');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(pkg.license, 'MIT');
assert.equal(typeof manifest.isDesktopOnly, 'boolean');
assert.match(read('LICENSE'), /^MIT License/);
assert.match(read('LICENSE'), /Copyright \(c\) 2026 Jack \(jackyoung022\)/);
execFileSync(process.execPath, ['--check', path.join(root, 'main.js')]);
for (const name of ['main.js', 'styles.css', 'manifest.json', 'README.md', 'LICENSE']) {
  assert.ok(fs.statSync(path.join(root, name)).size > 0, `${name} is empty`);
}
const images = [...read('README.md').matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[^)]+)\)/g)];
assert.ok(images.length >= 4, 'README must show overview, theme, interaction and settings screenshots');
for (const [, image] of images) assert.ok(fs.statSync(path.join(root, image)).size > 1000, image);
const requires = [...read('main.js').matchAll(/require\(["']([^"']+)["']\)/g)].map(m => m[1]);
assert.deepEqual(requires, ['obsidian'], 'The installed plugin should not need unbundled dependencies');
assert.ok(!fs.existsSync(path.join(root, 'data.json')), 'Do not publish personal settings');
assert.ok(!fs.existsSync(path.join(root, '.obsidian')), 'Do not publish an Obsidian vault');
console.log(`Checks passed: ${manifest.name} ${manifest.version}, ${images.length} README screenshots.`);
