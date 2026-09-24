import { FORMAT_VERSION, isIgnoredPath } from '../core/model.js';

const API = 'https://api.github.com';

/** Accepts "owner/repo", "github.com/owner/repo", full URLs, optional /tree/<ref>. */
export function parseRepoInput(input) {
  const s = String(input || '')
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)(?:\/tree\/(.+))?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] || null };
}

async function gh(path, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.ok) return res.json();
  if (res.status === 404) throw new Error('Repository not found (or private). For private code, use the CLI: npx sylaxgen');
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub API rate limit reached (60 requests/hour without a token). Add a token in settings, or try again later.');
  }
  throw new Error(`GitHub API error ${res.status}`);
}

/** Loads a public GitHub repository's file tree as galaxy data. */
export async function loadGithub(input, { token } = {}) {
  const parsed = parseRepoInput(input);
  if (!parsed) throw new Error('Use the form owner/repo, e.g. facebook/react');
  const { owner, repo } = parsed;
  const meta = await gh(`/repos/${owner}/${repo}`, token);
  const ref = parsed.ref || meta.default_branch;
  const tree = await gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
  const files = tree.tree
    .filter((e) => e.type === 'blob' && !isIgnoredPath(e.path))
    .map((e) => ({ p: e.path, s: e.size || 0 }));
  return {
    version: FORMAT_VERSION,
    name: meta.full_name,
    source: { type: 'github', url: meta.html_url, ref, stars: meta.stargazers_count },
    truncated: Boolean(tree.truncated),
    files,
  };
}

/** Builds galaxy data from an <input webkitdirectory> FileList. */
export function loadFileList(fileList) {
  const list = [...fileList];
  if (!list.length) throw new Error('The folder is empty');
  const first = (list[0].webkitRelativePath || list[0].name).split('/')[0];
  const files = [];
  for (const f of list) {
    const rel = f.webkitRelativePath || f.name;
    const p = rel.startsWith(`${first}/`) ? rel.slice(first.length + 1) : rel;
    if (!p || isIgnoredPath(p)) continue;
    files.push({ p, s: f.size });
  }
  return { version: FORMAT_VERSION, name: first, source: { type: 'local' }, files };
}

/** Reads a galaxy JSON file (as written by `sylaxgen export`). */
export async function loadJsonFile(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.files)) throw new Error('Not a sylaxgen galaxy file');
  return data;
}
