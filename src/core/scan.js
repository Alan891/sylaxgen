// Node-only: scans a directory (git-aware) into galaxy data.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { FORMAT_VERSION, IGNORED_DIRS, isIgnoredPath } from './model.js';

const MAX_FILES = 250_000;
const GIT_BUFFER = 1024 * 1024 * 512;

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: GIT_BUFFER,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function isGitRepo(dir) {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Parses `git log --diff-filter=A --name-only --format=@@@%ct` output into a
 * map of path -> unix time the path was first added. The log is newest-first,
 * so later (older) entries overwrite earlier ones.
 */
export function parseBirthLog(output) {
  const births = new Map();
  let time = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('@@@')) {
      time = Number(line.slice(3)) || 0;
    } else if (line) {
      births.set(line, time);
    }
  }
  return births;
}

function listGitFiles(dir) {
  const out = git(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return out.split('\0').filter(Boolean);
}

function walk(dir) {
  const files = [];
  const stack = [''];
  while (stack.length && files.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) stack.push(p);
      } else if (e.isFile()) {
        files.push(p);
      }
    }
  }
  return files;
}

/** Scans `dir` and returns galaxy data (see model.js for the format). */
export function scanDirectory(dir, { history = true } = {}) {
  const root = resolve(dir);
  const gitRepo = isGitRepo(root);
  let paths = gitRepo ? listGitFiles(root) : walk(root);
  paths = paths.filter((p) => !isIgnoredPath(p));
  const truncated = paths.length > MAX_FILES;
  if (truncated) paths = paths.slice(0, MAX_FILES);

  let births = new Map();
  if (gitRepo && history) {
    try {
      births = parseBirthLog(
        git(root, ['log', '--diff-filter=A', '--no-renames', '--name-only', '--format=@@@%ct']),
      );
    } catch {
      // Shallow clones or empty repos: no timeline, still a galaxy.
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const files = [];
  for (const p of paths) {
    let size = 0;
    try {
      size = statSync(join(root, p)).size;
    } catch {
      continue; // deleted but still in the index
    }
    const f = { p, s: size };
    if (gitRepo && history) f.t = births.get(p) || now; // untracked files are born "now"
    files.push(f);
  }

  return {
    version: FORMAT_VERSION,
    name: basename(root),
    source: { type: 'cli' },
    truncated,
    files,
  };
}
