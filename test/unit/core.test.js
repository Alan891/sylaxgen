import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage, languageColor } from '../../src/core/languages.js';
import { computeLayout, GALAXY_RADIUS } from '../../src/core/layout.js';
import { buildGalaxy, formatBytes, isIgnoredPath } from '../../src/core/model.js';
import { parseBirthLog } from '../../src/core/scan.js';
import { parseRepoInput } from '../../src/web/sources.js';

test('detectLanguage maps extensions and special file names', () => {
  assert.equal(detectLanguage('src/app.tsx'), 'TypeScript');
  assert.equal(detectLanguage('lib/x.PY'), 'Python');
  assert.equal(detectLanguage('Dockerfile'), 'Build');
  assert.equal(detectLanguage('docs/README'), 'Markdown');
  assert.equal(detectLanguage('.env'), 'Other');
  assert.equal(detectLanguage('weird.xyz'), 'Other');
  assert.match(languageColor('Nope'), /^#/);
});

test('isIgnoredPath skips vendored and build folders', () => {
  assert.ok(isIgnoredPath('node_modules/a/index.js'));
  assert.ok(isIgnoredPath('pkg/dist/bundle.js'));
  assert.ok(!isIgnoredPath('src/distance.js'));
  assert.ok(!isIgnoredPath('node_modules'));
});

test('buildGalaxy normalizes, dedupes, sorts and computes stats', () => {
  const g = buildGalaxy({
    name: 'x',
    files: [
      { p: './src/b.js', s: 10, t: 200 },
      { p: 'src/a.ts', s: 30, t: 100 },
      { p: 'src/b.js', s: 99 },
      { p: 'node_modules/z.js', s: 1 },
      { p: 'README.md', s: 5 },
    ],
  });
  assert.deepEqual(g.files.map((f) => f.path), ['README.md', 'src/a.ts', 'src/b.js']);
  assert.deepEqual(g.files.map((f) => f.index), [0, 1, 2]);
  assert.equal(g.stats.files, 3);
  assert.equal(g.stats.dirs, 1);
  assert.equal(g.stats.bytes, 45);
  assert.deepEqual(g.stats.timeRange, [100, 200]);
  assert.throws(() => buildGalaxy({}), /Invalid galaxy/);
});

test('formatBytes is human friendly', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MB');
});

function sampleFiles(n) {
  const files = [];
  for (let i = 0; i < n; i++) files.push({ p: `${['src', 'test', 'docs'][i % 3]}/m${i % 7}/f${i}.js`, s: i * 37 });
  files.push({ p: 'package.json', s: 800 });
  return buildGalaxy({ files }).files;
}

test('computeLayout is deterministic and stays inside the galaxy', () => {
  const files = sampleFiles(600);
  const a = computeLayout(files);
  const b = computeLayout(files);
  assert.deepEqual(a.positions, b.positions);
  assert.equal(a.positions.length, files.length * 3);
  for (const v of a.positions) assert.ok(Number.isFinite(v));
  for (let i = 0; i < files.length; i++) {
    const r = Math.hypot(a.positions[i * 3], a.positions[i * 3 + 2]);
    assert.ok(r < GALAXY_RADIUS * 1.35, `star ${i} escaped: r=${r}`);
  }
  assert.deepEqual(a.arms.map((x) => x.name).sort(), ['docs', 'src', 'test']);
  assert.ok(a.dust.positions.length / 3 === a.dust.tints.length);
});

test('root files sit in the bulge', () => {
  const files = sampleFiles(30);
  const { positions } = computeLayout(files);
  const root = files.find((f) => f.path === 'package.json');
  const r = Math.hypot(positions[root.index * 3], positions[root.index * 3 + 2]);
  assert.ok(r < 15);
});

test('computeLayout handles empty and single-file repos', () => {
  assert.equal(computeLayout([]).positions.length, 0);
  const one = buildGalaxy({ files: [{ p: 'a.txt', s: 1 }] }).files;
  assert.equal(computeLayout(one).positions.length, 3);
});

test('parseBirthLog keeps the oldest add time per path', () => {
  const log = ['@@@300', 'b.js', '', '@@@200', 'a.js', 'b.js', '', '@@@100', 'a.js', ''].join('\n');
  const births = parseBirthLog(log);
  assert.equal(births.get('a.js'), 100);
  assert.equal(births.get('b.js'), 200);
});

test('parseRepoInput accepts common GitHub forms', () => {
  assert.deepEqual(parseRepoInput('facebook/react'), { owner: 'facebook', repo: 'react', ref: null });
  assert.deepEqual(parseRepoInput('https://github.com/vuejs/core.git'), { owner: 'vuejs', repo: 'core', ref: null });
  assert.deepEqual(parseRepoInput('github.com/a/b/tree/dev/x'), { owner: 'a', repo: 'b', ref: 'dev/x' });
  assert.deepEqual(parseRepoInput('git@github.com:a/b.git'), { owner: 'a', repo: 'b', ref: null });
  assert.equal(parseRepoInput('not a repo'), null);
  assert.equal(parseRepoInput(''), null);
});
