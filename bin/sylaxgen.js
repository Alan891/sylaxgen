#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnoredPath } from '../src/core/model.js';
import { scanDirectory } from '../src/core/scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');
const DEFAULT_PORT = Number(process.env.SYLAXGEN_PORT) || 4777;
const VERSION = JSON.parse(readFileSync(resolve(HERE, '..', 'package.json'), 'utf8')).version;

const HELP = `sylaxgen ${VERSION} — turn any codebase into an explorable 3D galaxy

Usage
  sylaxgen [dir]                 Open the galaxy of dir (default: .) with live agent view
  sylaxgen export [dir] [-o f]   Write galaxy JSON (default: galaxy.json), load it at the web app
  sylaxgen hook                  Claude Code hook: forward the tool call on stdin to the viewer
  sylaxgen hook-config           Print the Claude Code settings snippet for live agent view

Options
  -p, --port <n>     Port for the local viewer (default ${DEFAULT_PORT}, env SYLAXGEN_PORT)
  --no-open          Don't open the browser
  --no-history       Skip git history (no timelapse; faster on huge repos)
  --no-watch         Don't watch the file system for changes
  -h, --help         Show this help
  -v, --version      Show version
`;

function parseArgs(argv) {
  const opts = { cmd: 'serve', dir: '.', port: DEFAULT_PORT, open: true, history: true, watch: true, out: 'galaxy.json' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.cmd = 'help';
    else if (a === '-v' || a === '--version') opts.cmd = 'version';
    else if (a === '-p' || a === '--port') opts.port = Number(argv[++i]);
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '--no-open') opts.open = false;
    else if (a === '--no-history') opts.history = false;
    else if (a === '--no-watch') opts.watch = false;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else rest.push(a);
  }
  if (['export', 'hook', 'hook-config', 'serve'].includes(rest[0]) && opts.cmd === 'serve') opts.cmd = rest.shift();
  if (rest[0]) opts.dir = rest[0];
  return opts;
}

// ---------------------------------------------------------------- serve --

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // No browser available (CI, SSH): the URL is printed anyway.
  }
}

function serve(opts) {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`Viewer not built (${DIST} missing). Run \`npm run build\` first.`);
  }
  const root = resolve(opts.dir);
  const started = Date.now();
  const data = scanDirectory(root, { history: opts.history });
  data.live = opts.watch;
  const known = new Set(data.files.map((f) => f.p));
  console.log(`✦ Scanned ${data.files.length.toLocaleString()} files in ${Date.now() - started} ms`);

  const clients = new Set();
  const hookWrites = new Map(); // path -> time, to avoid double-reporting an agent's edit
  const broadcast = (event) => {
    const msg = `data: ${JSON.stringify({ ...event, at: Date.now() })}\n\n`;
    for (const res of clients) res.write(msg);
  };

  const toRelative = (p) => {
    const abs = resolve(root, p);
    const rel = relative(root, abs);
    if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
    return rel.split(sep).join('/');
  };

  const onFsChange = (rel) => {
    if (!rel || isIgnoredPath(rel)) return;
    let st = null;
    try {
      st = statSync(join(root, rel));
    } catch {
      // deleted
    }
    if (st && !st.isFile()) return;
    if (!st) {
      if (!known.has(rel)) return;
      known.delete(rel);
      data.files = data.files.filter((f) => f.p !== rel);
      broadcast({ kind: 'delete', path: rel });
    } else if (!known.has(rel)) {
      known.add(rel);
      const f = { p: rel, s: st.size, t: Math.floor(Date.now() / 1000) };
      data.files.push(f);
      broadcast({ kind: 'create', path: rel, size: st.size });
    } else {
      // Give the agent's PostToolUse hook a moment to report the same edit first.
      setTimeout(() => {
        if (Date.now() - (hookWrites.get(rel) || 0) > 2500) broadcast({ kind: 'write', path: rel, size: st.size });
      }, 700);
    }
  };

  if (opts.watch) {
    const pending = new Map();
    try {
      watch(root, { recursive: true }, (_type, filename) => {
        if (!filename) return;
        const rel = String(filename).split(sep).join('/');
        if (isIgnoredPath(rel) || rel.startsWith('.git/')) return;
        clearTimeout(pending.get(rel));
        pending.set(rel, setTimeout(() => (pending.delete(rel), onFsChange(rel)), 120));
      });
    } catch (err) {
      console.warn(`! File watching unavailable (${err.message}); agent hooks still work.`);
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/galaxy.json') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => (clearInterval(ping), clients.delete(res)));
      return;
    }
    if (url.pathname === '/api/event' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c.length + body.length < 65536 ? c : ''));
      req.on('end', () => {
        try {
          const ev = JSON.parse(body);
          const rel = toRelative(String(ev.path || ''));
          const kind = ['read', 'write', 'search'].includes(ev.kind) ? ev.kind : 'read';
          if (rel && kind === 'write') hookWrites.set(rel, Date.now());
          if (rel) broadcast({ kind, path: rel, tool: String(ev.tool || '').slice(0, 40), agent: String(ev.agent || '').slice(0, 40) });
          res.writeHead(204).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    // Static viewer.
    let file;
    try {
      file = join(DIST, decodeURIComponent(url.pathname));
    } catch {
      return res.writeHead(400).end();
    }
    if (!file.startsWith(DIST)) return res.writeHead(403).end();
    if (url.pathname === '/' || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`✗ Port ${opts.port} is in use. Try: sylaxgen -p ${opts.port + 1}`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(opts.port, '127.0.0.1', () => {
    const url = `http://localhost:${opts.port}/?local=1`;
    console.log(`✦ Galaxy of ${data.name} → ${url}`);
    if (opts.watch) console.log('✦ Live: file changes light up as they happen. Ctrl+C to stop.');
    if (opts.open) openBrowser(url);
  });
}

// ----------------------------------------------------------------- hook --

// Maps Claude Code tool calls to viewer events. Reads stdin JSON as documented
// for hooks: { tool_name, tool_input, cwd }. Never fails the agent's tool call.
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'LS']);

async function hook(opts) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }
  const tool = payload.tool_name || '';
  const ti = payload.tool_input || {};
  const kind = WRITE_TOOLS.has(tool) ? 'write' : READ_TOOLS.has(tool) ? 'read' : SEARCH_TOOLS.has(tool) ? 'search' : null;
  const target = ti.file_path || ti.notebook_path || ti.path;
  if (!kind || !target) return;
  const path = resolve(payload.cwd || process.cwd(), target);
  const body = JSON.stringify({ kind, path, tool, agent: 'claude-code' });
  await new Promise((done) => {
    const req = request(
      { host: '127.0.0.1', port: opts.port, path: '/api/event', method: 'POST', timeout: 500, headers: { 'content-type': 'application/json' } },
      (res) => (res.resume(), res.on('end', done)),
    );
    req.on('error', done);
    req.on('timeout', () => (req.destroy(), done()));
    req.end(body);
  });
}

const HOOK_CONFIG = {
  hooks: {
    PostToolUse: [
      {
        matcher: 'Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob',
        hooks: [{ type: 'command', command: 'sylaxgen hook', timeout: 2 }],
      },
    ],
  },
};

// ----------------------------------------------------------------- main --

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.cmd) {
    case 'help':
      return console.log(HELP);
    case 'version':
      return console.log(VERSION);
    case 'hook':
      return hook(opts);
    case 'hook-config':
      console.log('Add this to .claude/settings.json (project) or ~/.claude/settings.json (global):\n');
      return console.log(JSON.stringify(HOOK_CONFIG, null, 2));
    case 'export': {
      const data = scanDirectory(opts.dir, { history: opts.history });
      writeFileSync(opts.out, JSON.stringify(data));
      return console.log(`✦ Wrote ${data.files.length.toLocaleString()} stars to ${opts.out}`);
    }
    default:
      return serve(opts);
  }
}

main().catch((err) => {
  if (process.argv.includes('hook')) process.exit(0); // hooks must never break the agent
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
