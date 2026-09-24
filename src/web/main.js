import { buildGalaxy, expand, formatBytes } from '../core/model.js';
import { languageColor } from '../core/languages.js';
import { Galaxy, TOUCH_COLORS } from './galaxy.js';
import { loadFileList, loadGithub, loadJsonFile, parseRepoInput } from './sources.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const store = {
  get(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  },
  set(key, value) {
    try {
      value ? localStorage.setItem(key, value) : localStorage.removeItem(key);
    } catch {
      // storage unavailable (private mode): the token just isn't remembered
    }
  },
};

let galaxy; // the renderer
let model; // buildGalaxy() result currently shown
let raw; // galaxy data behind `model`
let pathIndex = new Map();
const filter = { query: '', lang: null };

// ------------------------------------------------------------- bootstrap --

function ensureGalaxy() {
  if (galaxy) return galaxy;
  try {
    galaxy = new Galaxy($('stage'));
  } catch (err) {
    showLandingError('WebGL is not available in this browser.');
    throw err;
  }
  galaxy.on('hover', showTooltip);
  galaxy.on('click', (file, index) => {
    showInfo(file);
    galaxy.focus(index);
  });
  galaxy.on('frame', updateLabels);
  window.sylaxgen = { galaxy }; // handy for debugging and end-to-end tests
  return galaxy;
}

function show(data, { keepCamera = false } = {}) {
  if (Array.isArray(data.dirs)) data = expand(data);
  raw = data;
  model = buildGalaxy(data);
  pathIndex = new Map(model.files.map((f, i) => [f.path, i]));
  ensureGalaxy().setGalaxy(model);
  if (!keepCamera) galaxy.resetView();
  applyFilter();
  renderHud();
  $('landing').hidden = true;
  $('hud').hidden = false;
  document.title = `${model.name} — sylaxgen`;
}

async function withLoading(text, fn) {
  $('loading-text').textContent = text;
  $('loading').hidden = false;
  showLandingError('');
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showLanding();
    showLandingError(err.message || String(err));
  } finally {
    $('loading').hidden = true;
  }
}

function openRepo(input) {
  const parsed = parseRepoInput(input);
  if (!parsed) return showLandingError('Use the form owner/repo, e.g. facebook/react');
  return withLoading(`Charting ${parsed.owner}/${parsed.repo}…`, async () => {
    const data = await loadGithub(input, { token: store.get('sylaxgen-token') });
    show(data);
    const url = new URL(location.href);
    url.search = `?repo=${parsed.owner}/${parsed.repo}${parsed.ref ? `/tree/${parsed.ref}` : ''}`;
    history.replaceState(null, '', url);
  });
}

function showLanding() {
  $('landing').hidden = false;
  $('hud').hidden = true;
  $('tooltip').hidden = true;
  $('labels').replaceChildren();
  history.replaceState(null, '', location.pathname);
  document.title = 'sylaxgen — your code is a galaxy';
  stopRecording();
  pause();
  // A gallery galaxy keeps spinning behind the landing card.
  if (backdrop && model?.source?.gallery !== backdrop.source.gallery) showBackdrop(backdrop);
  if (galaxy) {
    galaxy.setReveal(1);
    galaxy.resetView();
    galaxy.controls.autoRotate = true;
  }
}

function showBackdrop(data) {
  raw = expand(data);
  model = buildGalaxy(raw);
  pathIndex = new Map(model.files.map((f, i) => [f.path, i]));
  ensureGalaxy().setGalaxy(model);
}

function showLandingError(msg) {
  $('landing-error').textContent = msg;
}

// --------------------------------------------------------------- gallery --

let galleryIndex = [];
let backdrop = null; // gallery galaxy spinning behind the landing page
const galleryCache = new Map();

async function fetchGalleryIndex() {
  try {
    const res = await fetch('gallery/index.json');
    galleryIndex = res.ok ? await res.json() : [];
  } catch {
    galleryIndex = [];
  }
  for (const grid of document.querySelectorAll('.gallery-grid')) renderGalleryGrid(grid);
}

async function fetchGalaxy(id) {
  if (!galleryCache.has(id)) {
    const res = await fetch(`gallery/${id}.json`);
    if (!res.ok) throw new Error(`Unknown galaxy: ${id}`);
    galleryCache.set(id, await res.json());
  }
  return galleryCache.get(id);
}

const compactNumber = (n) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function renderGalleryGrid(grid) {
  grid.replaceChildren(
    ...galleryIndex.map((g) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.dataset.galaxy = g.id;
      const img = document.createElement('img');
      img.src = `gallery/${g.id}.webp`;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      const body = document.createElement('span');
      body.className = 'card-body';
      const name = document.createElement('b');
      name.textContent = g.repo;
      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = g.blurb;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `since ${g.since} · ${compactNumber(g.files)} files · ${compactNumber(g.commits)} commits`;
      body.append(name, blurb, meta);
      card.append(img, body);
      card.addEventListener('click', () => openGalaxy(g.id));
      return card;
    }),
  );
}

/** Opens a gallery galaxy and plays its history from the first commit. */
function openGalaxy(id, { autoplay = true } = {}) {
  closeGallery();
  const entry = galleryIndex.find((g) => g.id === id);
  return withLoading(`Charting ${entry?.repo || id}…`, async () => {
    show(await fetchGalaxy(id));
    history.replaceState(null, '', `${location.pathname}?galaxy=${encodeURIComponent(id)}`);
    if (autoplay && model.stats.timeRange) {
      setReveal(0);
      setTimeout(play, 500);
    }
  });
}

function stepGalaxy(delta) {
  const i = galleryIndex.findIndex((g) => g.id === model?.source?.gallery);
  if (i === -1 || !galleryIndex.length) return;
  openGalaxy(galleryIndex[(i + delta + galleryIndex.length) % galleryIndex.length].id);
}

function openGallery() {
  pause();
  $('gallery-overlay').hidden = false;
  $('gallery-overlay').querySelector('.card')?.focus();
}

function closeGallery() {
  $('gallery-overlay').hidden = true;
}

async function boot() {
  $('token-input').value = store.get('sylaxgen-token');
  const repo = params.get('repo');
  if (params.has('local')) {
    await withLoading('Loading your local galaxy…', async () => {
      const res = await fetch('galaxy.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load galaxy.json from the sylaxgen CLI');
      const data = await res.json();
      show(data);
      if (data.live) connectLive();
    });
    return;
  }
  const indexReady = fetchGalleryIndex();
  if (repo) return openRepo(repo);
  if (params.get('galaxy')) {
    await indexReady;
    return openGalaxy(params.get('galaxy'));
  }
  try {
    backdrop = await fetchGalaxy('react');
    if ($('landing').hidden) return; // the user already opened something else
    showBackdrop(backdrop);
  } catch {
    ensureGalaxy();
  }
}

// ------------------------------------------------------------------ hud --

function renderHud() {
  const { stats, source } = model;
  const title = $('title');
  title.textContent = model.name;
  if (source.url) title.href = source.url;
  else title.removeAttribute('href');
  const parts = [
    `${stats.files.toLocaleString()} files`,
    `${stats.dirs.toLocaleString()} folders`,
    formatBytes(stats.bytes),
  ];
  if (source.stars) parts.push(`★ ${source.stars.toLocaleString()} on GitHub`);
  if (source.commits) parts.push(`${source.commits.toLocaleString()} commits`);
  const inGallery = galleryIndex.findIndex((g) => g.id === source.gallery);
  $('gal-nav').hidden = inGallery === -1;
  if (inGallery !== -1) $('gal-pos').textContent = `${inGallery + 1} / ${galleryIndex.length}`;
  $('stats').textContent = parts.join(' · ');
  $('truncated').hidden = !model.truncated;
  $('info').hidden = true;

  const legend = $('legend');
  legend.replaceChildren(
    ...stats.languages.slice(0, 12).map((l) => {
      const b = document.createElement('button');
      b.style.color = languageColor(l.name);
      b.innerHTML = '<span class="swatch"></span><span class="name"></span><span class="count"></span>';
      b.querySelector('.name').textContent = l.name;
      b.querySelector('.name').style.color = 'var(--text)';
      b.querySelector('.count').textContent = l.files.toLocaleString();
      b.classList.toggle('on', filter.lang === l.name);
      b.addEventListener('click', () => {
        filter.lang = filter.lang === l.name ? null : l.name;
        legend.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        if (filter.lang) b.classList.add('on');
        applyFilter();
      });
      return b;
    }),
  );

  $('timeline').hidden = !stats.timeRange;
  if (stats.timeRange) setReveal(1);
  $('live').hidden = !model.live;
  buildLabels();
}

function applyFilter() {
  if (!galaxy?.points) return;
  const q = filter.query.toLowerCase();
  if (!q && !filter.lang) {
    galaxy.setFilter(null);
    $('search-count').textContent = '';
    return;
  }
  let count = 0;
  galaxy.setFilter((f) => {
    const keep = (!q || f.path.toLowerCase().includes(q)) && (!filter.lang || f.lang === filter.lang);
    if (keep) count++;
    return keep;
  });
  $('search-count').textContent = `${count.toLocaleString()} match${count === 1 ? '' : 'es'}`;
}

function showTooltip(file, px) {
  const tip = $('tooltip');
  if (!file || !px) {
    tip.hidden = true;
    return;
  }
  tip.replaceChildren();
  const name = document.createElement('div');
  name.textContent = file.path;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${file.lang} · ${formatBytes(file.size)}${file.time ? ` · born ${fmtDate(file.time)}` : ''}`;
  tip.append(name, sub);
  tip.style.left = `${px[0]}px`;
  tip.style.top = `${px[1]}px`;
  tip.hidden = false;
}

function showInfo(file) {
  const info = $('info');
  info.replaceChildren();
  const path = document.createElement('div');
  path.className = 'path';
  path.textContent = file.path;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${file.lang} · ${formatBytes(file.size)}${file.time ? ` · born ${fmtDate(file.time)}` : ''}`;
  info.append(path, meta);
  if (model.source.type === 'github' && model.source.url) {
    const a = document.createElement('a');
    a.href = `${model.source.url}/blob/${encodeURIComponent(model.source.ref)}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open on GitHub ↗';
    const p = document.createElement('div');
    p.style.marginTop = '8px';
    p.append(a);
    info.append(p);
  }
  info.hidden = false;
}

const fmtDate = (t) => new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ------------------------------------------------------------ arm labels --

let labelEls = [];
function buildLabels() {
  const layer = $('labels');
  const minCount = model.files.length * 0.01;
  labelEls = galaxy.layout.arms.filter((arm) => arm.count >= minCount).slice(0, 10).map((arm) => {
    const el = document.createElement('div');
    el.textContent = arm.name;
    return { el, pos: arm.position };
  });
  layer.replaceChildren(...labelEls.map((l) => l.el));
}

function updateLabels() {
  if ($('hud').hidden) return;
  // Labels are ordered by arm size; smaller arms yield when they would overlap.
  const placed = [];
  for (const l of labelEls) {
    const p = galaxy.project(l.pos);
    if (!p || placed.some((q) => Math.abs(q[0] - p[0]) < 90 && Math.abs(q[1] - p[1]) < 22)) {
      l.el.style.opacity = 0;
      continue;
    }
    placed.push(p);
    l.el.style.opacity = 1;
    l.el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -50%)`;
  }
}

// -------------------------------------------------------------- timeline --

let playing = false;
let reveal = 1;
function setReveal(v) {
  reveal = Math.max(0, Math.min(1, v));
  galaxy.setReveal(reveal);
  $('scrub').value = String(Math.round(reveal * 1000));
  const [t0, t1] = model.stats.timeRange;
  $('date').textContent = fmtDate(t0 + (t1 - t0) * reveal);
}

const TIMELAPSE_MS = 18000;

function play(onEnd) {
  if (!model?.stats.timeRange) return;
  if (reveal >= 1) setReveal(0);
  playing = true;
  $('play-btn').textContent = '❚❚';
  $('play-btn').setAttribute('aria-label', 'Pause timelapse');
  galaxy.controls.autoRotate = true;
  let last = performance.now();
  const step = (now) => {
    if (!playing) return;
    setReveal(reveal + (now - last) / TIMELAPSE_MS);
    last = now;
    if (reveal >= 1) {
      pause();
      if (typeof onEnd === 'function') onEnd();
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function pause() {
  playing = false;
  $('play-btn').textContent = '▶';
  $('play-btn').setAttribute('aria-label', 'Play timelapse');
}

// ------------------------------------------------------------- recording --

let recorder = null;

function pickMimeType() {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

/** Records the canvas: the whole timelapse if there is one, else a 12 s orbit. */
function startRecording() {
  if (recorder || !window.MediaRecorder) {
    if (!window.MediaRecorder) toast('Video recording is not supported in this browser');
    return;
  }
  const canvas = galaxy.renderer.domElement;
  const mimeType = pickMimeType();
  const chunks = [];
  recorder = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const type = recorder?.mimeType || mimeType || 'video/webm';
    recorder = null;
    $('rec-btn').classList.remove('recording');
    $('rec-btn').title = 'Record a video';
    if (!chunks.length) return toast('Nothing was recorded — try again once the galaxy is on screen');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type }));
    a.download = `${model.name.replace(/[^\w.-]+/g, '-')}-galaxy.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Video saved — share your galaxy ✦');
  };
  recorder.start(250);
  $('rec-btn').classList.add('recording');
  $('rec-btn').title = 'Stop recording';
  toast('Recording… click ⏺ again to stop');
  galaxy.controls.autoRotate = true;
  if (model.stats.timeRange) {
    setReveal(0);
    play(() => setTimeout(stopRecording, 1500));
  } else {
    setTimeout(stopRecording, 12_000);
  }
}

function stopRecording() {
  if (recorder?.state === 'recording') recorder.stop();
}

// ------------------------------------------------------------------ live --

function connectLive() {
  const es = new EventSource('api/events');
  const status = $('live-status');
  let reads = 0;
  let writes = 0;
  let rebuild = null;
  const recent = []; // replayed after a rebuild so the agent's trail survives new files
  es.onopen = () => (status.textContent = 'connected — waiting for activity');
  es.onerror = () => (status.textContent = 'reconnecting…');
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.kind === 'create' || ev.kind === 'delete') {
      if (ev.kind === 'create' && !pathIndex.has(ev.path)) raw.files.push({ p: ev.path, s: ev.size || 0, t: Math.floor(Date.now() / 1000) });
      if (ev.kind === 'delete') raw.files = raw.files.filter((f) => (f.p ?? f.path) !== ev.path);
      clearTimeout(rebuild);
      recent.push(ev);
      rebuild = setTimeout(() => {
        show(raw, { keepCamera: true });
        for (const r of recent) if (pathIndex.has(r.path)) galaxy.touch(pathIndex.get(r.path), r.kind);
      }, 300);
    } else {
      const i = pathIndex.get(ev.path);
      if (i !== undefined) {
        galaxy.touch(i, ev.kind);
        recent.push(ev);
      }
    }
    if (recent.length > 24) recent.shift();
    if (ev.kind === 'write' || ev.kind === 'create') writes++;
    else reads++;
    status.textContent = `${reads} reads · ${writes} writes`;
    addFeed(ev);
  };
}

function addFeed(ev) {
  const feed = $('feed');
  const li = document.createElement('li');
  const c = TOUCH_COLORS[ev.kind] || TOUCH_COLORS.read;
  li.style.setProperty('--c', `rgb(${c.map((x) => Math.round(Math.min(1, x) * 255)).join(',')})`);
  const b = document.createElement('b');
  b.textContent = ev.kind === 'create' ? 'new' : ev.kind;
  const span = document.createElement('span');
  span.textContent = ev.path;
  span.title = ev.tool ? `${ev.tool}: ${ev.path}` : ev.path;
  li.append(b, span);
  li.addEventListener('click', () => {
    const i = pathIndex.get(ev.path);
    if (i !== undefined) galaxy.focus(i);
  });
  feed.prepend(li);
  while (feed.children.length > 30) feed.lastChild.remove();
}

// ---------------------------------------------------------------- wiring --

$('repo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  openRepo($('repo-input').value);
});

$('examples').addEventListener('click', (e) => {
  const repo = e.target.dataset?.repo;
  if (repo) {
    $('repo-input').value = repo;
    openRepo(repo);
  }
});

$('folder-input').addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files?.length) return;
  withLoading('Charting your folder…', async () => show(loadFileList(files)));
  e.target.value = '';
});

$('json-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  withLoading('Loading galaxy…', async () => show(await loadJsonFile(file)));
  e.target.value = '';
});


$('token-input').addEventListener('change', (e) => store.set('sylaxgen-token', e.target.value.trim()));

$('search').addEventListener('input', (e) => {
  filter.query = e.target.value.trim();
  applyFilter();
});

$('shot-btn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = galaxy.screenshot();
  a.download = `${model.name.replace(/[^\w.-]+/g, '-')}-galaxy.png`;
  a.click();
});

$('share-btn').addEventListener('click', async () => {
  if (model.source.type !== 'github') return toast('Local galaxies stay on your machine — save a PNG or video instead');
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied — share your galaxy ✦');
  } catch {
    toast(location.href);
  }
});

$('reset-btn').addEventListener('click', () => galaxy.resetView());
$('rec-btn').addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
$('gallery-btn').addEventListener('click', openGallery);
$('landing-gallery-btn')?.addEventListener('click', openGallery);
$('gallery-close').addEventListener('click', closeGallery);
$('gallery-overlay').addEventListener('click', (e) => e.target === e.currentTarget && closeGallery());
$('prev-btn').addEventListener('click', () => stepGalaxy(-1));
$('next-btn').addEventListener('click', () => stepGalaxy(1));

$('new-btn').addEventListener('click', () => {
  pause();
  filter.query = '';
  filter.lang = null;
  $('search').value = '';
  showLanding();
});

$('play-btn').addEventListener('click', () => (playing ? pause() : play()));
$('scrub').addEventListener('input', (e) => {
  pause();
  setReveal(Number(e.target.value) / 1000);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (!$('gallery-overlay').hidden) {
    if (e.key === 'Escape') closeGallery();
    return;
  }
  const hudOpen = !$('hud').hidden;
  if (hudOpen && e.key === 'ArrowRight' && !$('gal-nav').hidden) {
    stepGalaxy(1);
  } else if (hudOpen && e.key === 'ArrowLeft' && !$('gal-nav').hidden) {
    stepGalaxy(-1);
  } else if (hudOpen && e.key.toLowerCase() === 'g') {
    openGallery();
  } else if (e.key === '/') {
    e.preventDefault();
    $('search').focus();
  } else if (e.key === ' ' && !$('timeline').hidden && !$('hud').hidden) {
    e.preventDefault();
    playing ? pause() : play();
  } else if (e.key === 'Escape') {
    $('info').hidden = true;
  }
});

boot();
