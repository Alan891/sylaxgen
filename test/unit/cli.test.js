import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { scanDirectory } from '../../src/core/scan.js';

const CLI = new URL('../../bin/sylaxgen.js', import.meta.url).pathname;
let repo;

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'sylaxgen-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const commitAt = (date) =>
    execFileSync('git', ['commit', '-qm', date], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: date }, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'node_modules'));
  writeFileSync(join(repo, 'README.md'), '# hi\n');
  writeFileSync(join(repo, 'node_modules', 'x.js'), '');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  git('add', '.');
  commitAt('2020-01-01T00:00:00Z');
  writeFileSync(join(repo, 'src', 'app.js'), 'console.log(1)\n');
  git('add', '.');
  commitAt('2021-01-01T00:00:00Z');
  writeFileSync(join(repo, 'src', 'untracked.js'), '');
});

after(() => rmSync(repo, { recursive: true, force: true }));

test('scanDirectory lists git files with sizes and birth times', () => {
  const data = scanDirectory(repo);
  const byPath = Object.fromEntries(data.files.map((f) => [f.p, f]));
  assert.deepEqual(Object.keys(byPath).sort(), ['.gitignore', 'README.md', 'src/app.js', 'src/untracked.js']);
  assert.equal(byPath['README.md'].s, 5);
  assert.equal(byPath['src/app.js'].t, Date.parse('2021-01-01T00:00:00Z') / 1000);
  assert.equal(byPath['README.md'].t, Date.parse('2020-01-01T00:00:00Z') / 1000);
});

test('scanDirectory works without git and without history', () => {
  const plain = mkdtempSync(join(tmpdir(), 'sylaxgen-plain-'));
  mkdirSync(join(plain, 'a', 'node_modules'), { recursive: true });
  writeFileSync(join(plain, 'a', 'b.txt'), 'abc');
  writeFileSync(join(plain, 'a', 'node_modules', 'skip.js'), '');
  const data = scanDirectory(plain);
  assert.deepEqual(data.files, [{ p: 'a/b.txt', s: 3 }]);
  rmSync(plain, { recursive: true, force: true });
  assert.ok(scanDirectory(repo, { history: false }).files.every((f) => f.t === undefined));
});

test('CLI serves galaxy.json and relays hook events over SSE', async (t) => {
  execFileSync('npm', ['run', 'build'], { cwd: new URL('../..', import.meta.url).pathname, stdio: 'ignore' });
  const port = 4900 + Math.floor(Math.random() * 500);
  const server = spawn('node', [CLI, repo, '--no-open', '-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => server.kill());
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('Galaxy of') && resolve());
    server.on('exit', (code) => reject(new Error(`CLI exited ${code}`)));
  });

  const data = await (await fetch(`http://127.0.0.1:${port}/galaxy.json`)).json();
  assert.equal(data.live, true);
  assert.ok(data.files.some((f) => f.p === 'src/app.js'));
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /sylaxgen/);

  const res = await fetch(`http://127.0.0.1:${port}/api/events`);
  const reader = res.body.getReader();
  const hookInput = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: join(repo, 'src', 'app.js') }, cwd: repo });
  execFileSync('node', [CLI, 'hook', '-p', String(port)], { input: hookInput });
  // Paths outside the project are dropped.
  execFileSync('node', [CLI, 'hook', '-p', String(port)], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' }, cwd: repo }),
  });

  let text = '';
  const deadline = Date.now() + 5000;
  while (!text.includes('"kind":"read"') && Date.now() < deadline) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
  }
  reader.cancel();
  assert.match(text, /"kind":"read","path":"src\/app.js","tool":"Read","agent":"claude-code"/);
  assert.doesNotMatch(text, /passwd/);
});

test('hook never fails, even with garbage input or no server', () => {
  execFileSync('node', [CLI, 'hook', '-p', '1'], { input: 'not json' });
  execFileSync('node', [CLI, 'hook', '-p', '1'], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'x.js' } }),
  });
});
