import { detectLanguage } from './languages.js';

// Galaxy data format (what the CLI writes and the viewer reads):
// {
//   version: 1,
//   name: "owner/repo",
//   source: { type: "github" | "local" | "cli", url?: string, ref?: string },
//   truncated?: boolean,
//   live?: boolean,             // served by `sylaxgen` CLI with /api/events
//   files: [{ p: "src/a.js", s: 1234, t?: 1700000000 }]  // path, bytes, birth (unix s)
// }
//
// Compact variant (used for the gallery, ~3x smaller): folder names are listed
// once in `dirs`, and each file is [dirIndex, name, size, birth?].

export const FORMAT_VERSION = 1;

// Directories that are never interesting to look at.
export const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.venv', 'venv', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.idea', '.vscode', '.gradle', 'vendor', 'Pods',
]);

export function isIgnoredPath(path) {
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (IGNORED_DIRS.has(parts[i])) return true;
  }
  const base = parts[parts.length - 1];
  return base === '.DS_Store' || base === 'Thumbs.db';
}

/**
 * Turns raw galaxy data into the structure the renderer uses: files sorted by
 * path with language + depth, and summary stats.
 */
export function buildGalaxy(data) {
  if (!data || !Array.isArray(data.files)) throw new Error('Invalid galaxy data: missing files');
  if (Array.isArray(data.dirs)) data = expand(data);
  const seen = new Set();
  const files = [];
  for (const f of data.files) {
    const path = String(f.p ?? f.path ?? '').replace(/^\.?\/+/, '');
    if (!path || seen.has(path) || isIgnoredPath(path)) continue;
    seen.add(path);
    const slash = path.lastIndexOf('/');
    files.push({
      path,
      dir: slash === -1 ? '' : path.slice(0, slash),
      name: path.slice(slash + 1),
      depth: path.split('/').length - 1,
      size: Math.max(0, Number(f.s ?? f.size ?? 0) || 0),
      time: Number(f.t ?? f.time ?? 0) || 0,
      lang: detectLanguage(path),
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files.forEach((f, i) => (f.index = i));

  return {
    name: data.name || 'galaxy',
    source: data.source || { type: 'local' },
    truncated: Boolean(data.truncated),
    live: Boolean(data.live),
    files,
    stats: computeStats(files),
  };
}

/** Converts galaxy data to the compact form (see top of file). */
export function compact(data) {
  const dirIndex = new Map();
  const dirs = [];
  const files = data.files.map((f) => {
    const slash = f.p.lastIndexOf('/');
    const dir = slash === -1 ? '' : f.p.slice(0, slash);
    if (!dirIndex.has(dir)) {
      dirIndex.set(dir, dirs.length);
      dirs.push(dir);
    }
    const row = [dirIndex.get(dir), f.p.slice(slash + 1), f.s];
    if (f.t) row.push(f.t);
    return row;
  });
  return { ...data, dirs, files };
}

/** Inverse of compact(). */
export function expand(data) {
  const { dirs } = data;
  const files = data.files.map(([d, name, s, t]) => {
    const f = { p: dirs[d] ? `${dirs[d]}/${name}` : name, s };
    if (t) f.t = t;
    return f;
  });
  const { dirs: _, ...rest } = data;
  return { ...rest, files };
}

export function computeStats(files) {
  const langs = new Map();
  const dirs = new Set();
  let bytes = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const f of files) {
    bytes += f.size;
    const l = langs.get(f.lang) || { name: f.lang, files: 0, bytes: 0 };
    l.files++;
    l.bytes += f.size;
    langs.set(f.lang, l);
    let d = f.dir;
    while (d && !dirs.has(d)) {
      dirs.add(d);
      const s = d.lastIndexOf('/');
      d = s === -1 ? '' : d.slice(0, s);
    }
    if (f.time) {
      if (f.time < tMin) tMin = f.time;
      if (f.time > tMax) tMax = f.time;
    }
  }
  const languages = [...langs.values()].sort((a, b) => b.files - a.files);
  return {
    files: files.length,
    dirs: dirs.size,
    bytes,
    languages,
    timeRange: Number.isFinite(tMin) ? [tMin, tMax] : null,
  };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
