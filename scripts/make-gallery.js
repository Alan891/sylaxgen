// Builds the gallery of famous repositories from local clones.
//   node scripts/make-gallery.js <folder with clones>
// Each clone lives in <folder>/<owner>_<repo> (e.g. `git clone --filter=blob:none`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compact } from '../src/core/model.js';
import { scanDirectory } from '../src/core/scan.js';

export const GALLERY = [
  { id: 'react', repo: 'facebook/react', blurb: 'The library for web and native user interfaces' },
  { id: 'cpython', repo: 'python/cpython', blurb: 'Three decades of Python, since 1990' },
  { id: 'git', repo: 'git/git', blurb: 'The version control system that tracks all the others' },
  { id: 'vscode', repo: 'microsoft/vscode', blurb: 'The editor half of us are reading this in' },
  { id: 'deno', repo: 'denoland/deno', blurb: 'A modern runtime for JavaScript and TypeScript' },
  { id: 'svelte', repo: 'sveltejs/svelte', blurb: 'Cybernetically enhanced web apps' },
  { id: 'redis', repo: 'redis/redis', blurb: 'The in-memory data store behind half the internet' },
  { id: 'vue', repo: 'vuejs/core', blurb: 'The progressive JavaScript framework, rewritten' },
];

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/make-gallery.js <folder with clones>');
  process.exit(1);
}
const out = new URL('../public/gallery/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const index = [];
for (const g of GALLERY) {
  const dir = join(src, g.repo.replace('/', '_'));
  if (!existsSync(dir)) {
    console.warn(`skip ${g.repo}: no clone at ${dir}`);
    continue;
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const ref = git('rev-parse', '--abbrev-ref', 'HEAD');
  const commits = Number(git('rev-list', '--count', 'HEAD'));
  const data = scanDirectory(dir);
  const times = data.files.map((f) => f.t).filter(Boolean);
  const since = new Date(Math.min(...times) * 1000).getUTCFullYear();
  data.name = g.repo;
  data.source = { type: 'github', url: `https://github.com/${g.repo}`, ref, commits, gallery: g.id };
  writeFileSync(join(out, `${g.id}.json`), JSON.stringify(compact(data)));
  index.push({ ...g, files: data.files.length, commits, since });
  console.log(`${g.repo}: ${data.files.length} files since ${since}`);
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
