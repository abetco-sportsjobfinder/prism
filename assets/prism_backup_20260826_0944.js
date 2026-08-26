/* ============================================================
   PRISM — independent AV module. Piece R3-clean.
   ONE player (boots instantly on your last stream) + ONE drawer:
   CATEGORY sort default (logo-card rows), A–Z selectable,
   COUNTRY filter, WORKING toggle, caret-minimized footer that
   auto-hides. All controls pinned in fixed positions — nothing
   shifts when modes change. Loader = the real ABET chip flip.
   ============================================================ */

import { loadCatalog, db, countries, categories, stats, getStatus, hasStream, pickStream } from './catalog.js';
import { createGuide } from './prism-guide.js';

const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const LAST_KEY = 'prism.last';
const DEFAULT_SOURCE = 'https://propee33f9c2.airspace-cdn.cbsivideo.com/index.m3u8';
const PROXY = 'https://iptv-stream-proxy.abetscrape.workers.dev';
const CHUNK = 200;
const BRAND_CAP = 300;

/* ---------------- utils ---------------- */
const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) loadedScripts.set(src, new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('load fail ' + src));
    document.head.appendChild(s);
  }));
  return loadedScripts.get(src);
}
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const proxied = url => `${PROXY}?u=${encodeURIComponent(url)}`;
function rawOf(u) {
  try {
    if (typeof u === 'string' && u.startsWith(PROXY + '?u='))
      return decodeURIComponent(new URL(u).searchParams.get('u') || '');
  } catch {}
  return u;
}

function getLast() { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || null; } catch { return null; } }
function setLast(url, name) { try { localStorage.setItem(LAST_KEY, JSON.stringify({ url, name: name || '', t: Date.now() })); } catch {} }
function getFavs() { try { return new Set(JSON.parse(localStorage.getItem('prism.favs')) || []); } catch { return new Set(); } }
function saveFavs(set) { try { localStorage.setItem('prism.favs', JSON.stringify([...set])); } catch {} }

let toastEl = null;
function toast(msg) {
  if (!toastEl) { toastEl = el('div', 'toast'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._h);
  toastEl._h = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ---------------- popovers ---------------- */
let openPopover = null;
function closeOpenPopover() { if (openPopover) { openPopover.remove(); openPopover = null; } }
document.addEventListener('pointerdown', e => { if (openPopover && !openPopover.contains(e.target)) closeOpenPopover(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpenPopover(); });
function showSmart(anchor, node) {
  closeOpenPopover();
  document.body.appendChild(node);
  const vw = innerWidth, vh = innerHeight;
  let w = Math.max(320, Math.round(anchor.getBoundingClientRect().width));
  w = Math.min(w, vw - 20);
  node.style.width = `${w}px`;
  node.style.visibility = 'hidden'; node.style.display = 'block';
  const nh = node.offsetHeight;
  const r = anchor.getBoundingClientRect();
  node.style.visibility = '';
  let left, top;
  if (matchMedia('(max-width:820px)').matches) {
    left = (vw - w) / 2;
    top = Math.max(12, (vh - nh) / 2 - 40);
  } else {
    left = Math.max(10, Math.min(r.left, vw - w - 10));
    top = r.top - nh - 10;
    if (top < 10) top = r.bottom + 10;
    if (top + nh > vh - 10) top = Math.max(10, vh - nh - 10);
  }
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
  openPopover = node;
  setTimeout(() => node.querySelector('input')?.focus(), 30);
}

/* logos */
const logoMap = new Map();
let logosRequested = false;
function requestLogos(onReady) {
  if (logosRequested) return;
  logosRequested = true;
  setTimeout(async () => {
    try {
      const r = await fetch('/logos.json');
      if (r.ok) {
        for (const [id, url] of Object.entries(await r.json())) logoMap.set(id, url);
        onReady?.();
      }
    } catch {}
  }, 1200);
}
const logoFor = id => logoMap.get(id) || '';
const flagFor = cc => cc?.length === 2 ? `https://flagcdn.com/w40/${cc.toLowerCase()}.png` : '';

/* ================= THE ABET CHIP LOADER (verbatim port) ================= */
const CHIP_CSS = `
.abet-chip-perspective{perspective:620px;width:64px;height:64px}
.abet-chip-spinner{width:100%;height:100%;position:relative;transform-style:preserve-3d;animation:abet-chip-flip 2.4s cubic-bezier(.45,.05,.35,1) infinite}
.abet-chip-face{position:absolute;inset:0;border-radius:50%;background:#0b0f17;display:flex;align-items:center;justify-content:center;backface-visibility:hidden}
.abet-chip-seg{position:absolute;left:50%;top:5px;width:9px;height:16px;margin-left:-4.5px;border-radius:3px;background:rgba(253,181,21,0.85)}
.abet-chip-txt{font-family:Georgia,'Times New Roman',serif;font-size:15px;letter-spacing:1px;color:#FDB515;text-shadow:0 0 8px rgba(253,181,21,.65)}
.abet-chip-back{transform:rotateY(180deg)}
@keyframes abet-chip-flip{
  0%{transform:rotateY(0deg) translateY(0)}
  45%{transform:rotateY(540deg) translateY(-10px)}
  70%{transform:rotateY(720deg) translateY(0)}
  78%{transform:rotateY(720deg) translateY(-4px)}
  100%{transform:rotateY(1080deg) translateY(0)}
}`;
let chipCssInjected = false;
const chipSegs = () => Array.from({ length: 8 }, (_, o) =>
  `<span class="abet-chip-seg" style="transform:rotate(${o * 45}deg)"></span>`).join('');
const chipHTML = (label = '') => {
  let css = '';
  if (!chipCssInjected) {
    css = `<style>${CHIP_CSS}</style>`;
    chipCssInjected = true;
  }
  return `${css}<div class="abet-chip-loader" role="status" aria-live="polite">
    <div class="abet-chip-perspective"><div class="abet-chip-spinner">
      <div class="abet-chip-face">${chipSegs()}<span class="abet-chip-txt">ABET</span></div>
      <div class="abet-chip-face abet-chip-back">${chipSegs()}<span class="abet-chip-txt">ABET</span></div>
    </div></div>
    ${label ? `<span class="chip-label">${esc(label)}</span>` : ''}
  </div>`;
};

/* ================= the ONE player ================= */
export function createPlayer({ stage }) {
  const shell = el('div', 'player-shell');
  shell.innerHTML = `
    <video controls playsinline preload="metadata"></video>
    <div class="player-loading">${chipHTML()}</div>
    <div class="player-err"></div>`;
  stage.appendChild(shell);

  const video = shell.querySelector('video');
  const errEl = shell.querySelector('.player-err');
  const loading = shell.querySelector('.player-loading');

  let engine = null, objectUrl = null, engineLabel = '';

  const fail = m => { errEl.textContent = m; errEl.classList.add('show'); toast(m); loading.style.display = 'none'; };
  video.addEventListener('waiting', () => { loading.style.display = ''; });
  video.addEventListener('playing', () => { loading.style.display = 'none'; });
  video.addEventListener('canplay', () => { loading.style.display = 'none'; });

  function attemptPlay() {
    const p = video.play();
    if (!p) return;
    p.catch(err => {
      if (err && err.name === 'NotAllowedError') {
        video.muted = true;
        video.play().then(() => showMuteBadge(shell)).catch(() => {});
      }
    });
  }

  function teardown() {
    if (engine?.destroy) try { engine.destroy(); } catch {}
    if (engine?.reset) try { engine.reset(); } catch {}
    engine = null; video.removeAttribute('src'); video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function load(src, opts = {}) {
    errEl.classList.remove('show'); teardown();

    let kind = opts.kind, target = src;
    if (!opts.isFile && typeof src === 'string') {
      kind = kind || (/\.mpd($|\?)/i.test(src) ? 'dash' : (/\.m3u8($|\?)/i.test(src) ? 'hls' : 'native'));
      target = proxied(src);
    } else if (opts.isFile) {
      objectUrl = URL.createObjectURL(src);
      target = objectUrl;
    }
    loading.style.display = '';
    try {
      if (kind === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) { video.src = target; engineLabel = 'native-hls'; }
        else {
          await loadScript(CDN.hls);
          if (!window.Hls?.isSupported()) { video.src = target; engineLabel = 'native-hls'; }
          else {
            engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
            engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`stream error (${d.details})`); });
            engine.loadSource(target); engine.attachMedia(video); engineLabel = 'hls.js';
          }
        }
      } else if (kind === 'dash') {
        await loadScript(CDN.dash);
        engine = window.dashjs.MediaPlayer().create();
        engine.initialize(video, target, true);
        engineLabel = 'dash.js';
      } else { video.src = target; engineLabel = 'native'; }
      attemptPlay();
    } catch (e) { fail(e.message || String(e)); }
  }

  return {
    video,
    load,
    playChannel(ch) {
      const url = pickStream(ch.id);
      if (!url) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
      setLast(url, ch.name);
      document.title = `${ch.name} · prism`;
      load(url);
    },
  };
}

function showMuteBadge(shell) {
  if (!shell || shell.querySelector('.mute-badge')) return;
  const b = el('button', 'mute-badge', '🔇 TAP FOR SOUND');
  b.addEventListener('click', e => {
    e.stopPropagation();
    const v = shell.querySelector('video');
    if (v) { v.muted = false; v.volume = Math.max(v.volume, .8); }
    b.remove();
  });
  shell.appendChild(b);
}

/* ================= grouping / rows ================= */
const QUALIFIERS = new Set(['PLUS', 'EXTRA', 'HD', 'FHD', 'SD', 'UHD', '4K', '8K', 'EAST', 'WEST', 'NORTH', 'SOUTH', 'FEED']);
const NUMBERY = /^\+?\d+(\.\d+)?$/;
function brandOf(c) {
  if (c.brand) return c.brand;
  let s = String(c.name || '').toUpperCase()
    .replace(/[\u2019'`]/g, '')
    .replace(/\([^\)]*\)|\[[^\]]*\]|\{[^\}]*\}/g, ' ')
    .split(/[|•·–—:\/\\]/)[0]
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  let toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && (QUALIFIERS.has(toks.at(-1)) || NUMBERY.test(toks.at(-1)))) toks.pop();
  c.brand = toks.join(' ') || String(c.name || '?').toUpperCase().trim() || '?';
  return c.brand;
}


/* ================= bootstrap ================= */
export function mountPrism({ target, title = 'prism | α', defaultSource = DEFAULT_SOURCE } = {}) {
  document.title = title;

  /* ---------- DOM: controls pinned in FIXED slots (never shift) ---------- */
  const toolbar = el('div', 'stage-toolbar');
  toolbar.innerHTML = `
    <button class="strip-btn primary" id="addWin"><i class="fas fa-plus"></i> PLAYER</button>
    <select class="strip-btn" id="layoutSel">
      <option value="full" selected>FULL</option>
      <option value="2x2">2×2</option><option value="3x2">3×2</option>
      <option value="2x3">2×3</option><option value="4x2">4×2</option>
      <option value="2x4">2×4</option>
    </select>
    <span class="win-count" id="winCount"></span>`;

  const stage = el('div', 'stage-area');
  const emptyState = el('div', 'stage-empty',
    `<button class="stage-add">${chipHTML('')}<span>+ PLAYER</span></button>`);

  const main = el('div', 'app');
  main.append(toolbar, stage);

  /* bottom bar: fixed slot order — brand | WORKING | SORT | COUNTRY | + | ✕✕ | caret | status */
  const dock = el('div', 'dock');
  const dockBar = el('div', 'dock-bar');
  dockBar.innerHTML = `
    <span class="dock-brand"><span class="alpha-mark">α</span></span>
    <label class="tree-working"><input type="checkbox" id="workChk" checked /> WORKING</label>
    <select id="sortSel" class="dock-select">
      <option value="category" selected>CATEGORY</option>
      <option value="az">A–Z</option>
    </select>
    <select id="countrySel" class="dock-select"><option value="all">🌍</option></select>
    <span class="dock-tools">
      <button class="dock-tool primary" id="addWin2" title="New player"><i class="fas fa-plus"></i></button>
      <button class="dock-tool danger" id="closeAll" title="Close all"><i class="fas fa-xmark"></i></button>
    </span>
    <button class="caret-btn" id="drawerCaret" title="Channels"><i class="fas fa-chevron-up"></i></button>
    <span class="dock-meta" id="dockMeta">${chipHTML('LOADING')}</span>`;

  const drawer = el('div', 'drawer');
  dock.append(dockBar, drawer);

  main.append(dock);
  target.appendChild(main);

  /* ---------- GUIDE-UX-A1 seam: guide owns filter/sort/render ---------- */
  const guide = createGuide({
    host: drawer,
    controls: { workChk: $('workChk'), sortSel: $('sortSel'), countrySel: $('countrySel') },
    data: {
      getChannels: () => db.channels,
      getStatus,
      hasStream,
      getCountries: () => countries(),
    },
    pickStream,
    logos: { for: logoFor, flag: flagFor },
    favs,
    onPlay: payload => playUrlFocused(payload),
    onPlayNew: payload => playUrlNewWindow(payload),
    onToggleFav: toggleFav,
  });
  document.addEventListener('prism:drawer', e => {
    if (e.detail && e.detail.open === false) setDrawer(false);
  });
  document.addEventListener('prism:toast', e => {
    if (e.detail && e.detail.msg) toast(e.detail.msg);
  });

  /* ---------- state ---------- */
  const wins = [];
  let layoutMode = 'full';
  const favs = getFavs();

  const $ = id => document.getElementById(id);

  /* ---------- windows (single or grid; no drag complexity beyond lock) ---------- */
  function applyLayout() {
    const n = wins.length;
    $('winCount').textContent = n ? `${n}` : '';
    stage.classList.toggle('solo', n <= 1);

    if (layoutMode === 'full') {
      wins.forEach((w, i) => {
        if (i > 0) { w.cell.style.opacity = '.25'; return; }
        w.cell.style.opacity = '';
        Object.assign(w.cell.style, { left: '0.5%', top: '0.5%', width: '99%', height: '99%' });
        w.cell.classList.add('snapped');
      });
      fitFull();
      return;
    }
    const [cols, rows] = layoutMode.split('x').map(Number);
    const gap = 0.9;
    const cw = (100 - gap * (cols + 1)) / cols;
    const ch = (100 - gap * (rows + 1)) / rows;
    wins.forEach((w, i) => {
      if (i >= cols * rows) { w.cell.style.opacity = '.25'; return; }
      w.cell.style.opacity = '';
      Object.assign(w.cell.style, {
        left: `${gap + (i % cols) * (cw + gap)}%`,
        top: `${gap + Math.floor(i / cols) * (ch + gap)}%`,
        width: `${cw}%`, height: `${ch}%`,
      });
      w.cell.classList.add('snapped');
    });
  }

  function fitFull() {
    const top = stage.getBoundingClientRect().top;
    stage.style.height = `${Math.max(innerHeight - top - 66, 240)}px`;
    const w0 = wins[0];
    if (w0 && layoutMode === 'full') {
      Object.assign(w0.cell.style, {
        width: (stage.clientWidth - 12) + 'px',
        height: (parseFloat(stage.style.height) - 12) + 'px',
      });
    }
  }

  function addWindow(url, name) {
    const w = spawnWindow(stage);
    const origLoad = w.load.bind(w);
    w.load = (src, opts = {}) => {
      if (!opts.isFile && typeof src === 'string') setLast(rawOf(src), name || '');
      return origLoad(src, opts);
    };
    w.onDestroy = api => {
      const i = wins.indexOf(api); if (i >= 0) wins.splice(i, 1);
      refreshChrome();
    };
    wins.push(w);
    refreshChrome();
    w.focus();
    if (url) { w.load(url); if (name) w.setTitle(name.slice(0, 30)); }
    return w;
  }

  function refreshChrome() {
    emptyState.style.display = wins.length ? 'none' : '';
    $('winCount').textContent = wins.length ? String(wins.length) : '';
    applyLayout();
  }

  emptyState.querySelector('.stage-add').addEventListener('click', () => addWindow());
  $('addWin').addEventListener('click', () => addWindow());
  $('addWin2').addEventListener('click', () => addWindow());
  $('closeAll').addEventListener('click', () => { while (wins.length) wins[0].close(); });
  $('layoutSel').addEventListener('change', e => {
    layoutMode = e.target.value;
    if (layoutMode !== 'full') {
      const [c, r] = layoutMode.split('x').map(Number);
      while (wins.length < c * r) addWindow();     // materialize containers
    }
    applyLayout();
  });
  addEventListener('resize', () => applyLayout());

  const focused = () => wins.reduce((a, b) =>
    (+a.cell.style.zIndex || 0) >= (+b.cell.style.zIndex || 0) ? a : b, wins[0]);

  /* ---------- favorites ---------- */
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    saveFavs(favs);
    guide.rerender(); updateMeta();
  }

  /* ---------- filtering ---------- */
  /* moved to assets/prism-guide.js (filterChannels + controller) */

/* guide state/filter/render lives in assets/prism-guide.js (GUIDE-UX-A1);
   prism.js keeps only the integration seam below. */

  function rerenderDrawer() { guide.rerender(); updateMeta(); }
  function playUrlFocused(payload) {
    if (!payload?.url) return;
    let w = focused();
    if (!w) w = addWindow();
    if (w.isEmpty && w.fill) w.fill(payload.url, payload.name);
    else { w.load(payload.url); w.setTitle((payload.name || '').slice(0, 30)); }
    setLast(rawOf(payload.url), payload.name || '');
  }
  function playUrlNewWindow(payload) {
    if (!payload?.url) return;
    const w = addWindow();
    w.load(payload.url);
    w.setTitle((payload.name || '').slice(0, 30));
    setLast(rawOf(payload.url), payload.name || '');
  }

  /* ---------- drawer open/close (fixed-height, compact) ---------- */
  let drawerOpen = false;
  function setDrawer(open) {
    drawerOpen = open;
    dock.classList.toggle('open', open);
    $('drawerCaret').querySelector('i').className =
      `fas fa-chevron-${open ? 'down' : 'up'}`;
    document.body.classList.toggle('drawer-open', open);
    if (open) guide.rerender();
  }
  $('drawerCaret').addEventListener('click', e => { e.stopPropagation(); setDrawer(!drawerOpen); });
  dockBar.addEventListener('click', e => {
    if (e.target.closest('.dock-tool') || e.target.closest('.dock-select') ||
        e.target.closest('#workChk') || e.target.closest('.caret-btn')) return;
    setDrawer(!drawerOpen);
  });

  function updateMeta() {
    const s = stats();
    let working = 0;
    for (const c of db.channels) if (getStatus(c.id) === 'working') working++;
    $('dockMeta').innerHTML =
      `<b>${db.totalIndexed.toLocaleString()}</b> CH · <b class="ok">${working.toLocaleString()} ✓</b>` +
      (favs.size ? ` · <b style="color:var(--accent-secondary)">★${favs.size}</b>` : '');
  }

  /* ---------- footer auto-hide ---------- */
  let hideTimer = null;
  function poke() {
    dock.classList.remove('autohidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!drawerOpen) dock.classList.add('autohidden'); }, 4000);
  }
  ['pointermove', 'pointerdown', 'touchstart', 'keydown'].forEach(evt =>
    document.addEventListener(evt, poke, { passive: true }));

  /* ---------- boot: PLAYER FIRST, then catalog ---------- */
  const qp = new URLSearchParams(location.search).get('src');
  const last = getLast();
  const bootUrl = qp || (last ? rawOf(last.url) : null) || defaultSource;
  const bootWin = addWindow(bootUrl);
  if (!qp && last?.name) bootWin.setTitle(last.name.slice(0, 30));

  (async () => {
    try {
      const s = await loadCatalog(
        m => { $('dockMeta').innerHTML = `${chipHTML(m || 'loading.')}`; },
        () => { rerenderDrawer(); updateMeta(); },
      );
      guide.initCountries();
      rerenderDrawer();
      updateMeta();
      requestLogos(rerenderDrawer);
      toast(`${s.total.toLocaleString()} READY · ${s.working.toLocaleString()} VERIFIED`);
    } catch (e) {
      drawer.innerHTML = `<div class="tree-empty">⚠ catalog failed: ${esc(e.message)}</div>`;
      $('dockMeta').textContent = 'catalog offline — players still work';
    }
  })();

  return { app: main, addWindow, wins, rerenderDrawer, setDrawer, player() { return focused(); } };
}

/* ================= window factory + snap-lock drag ================= */
let zTop = 500;

export function createWindow({ stage, title = 'LIVE', idle = false }) {
  if (!stage || typeof stage.appendChild !== 'function') {
    throw new TypeError('createWindow requires a valid stage element');
  }
  const cell = el('section', 'pwin');
  cell.innerHTML = `
    <div class="pwin-bar">
      <span class="pwin-drag"><i class="fas fa-grip-lines"></i> <span class="pwin-title">${esc(title)}</span></span>
      <span class="pwin-actions">
        <button class="pwin-src" title="Change source">SOURCE</button>
        <button class="pwin-close" title="Close this player" aria-label="Close this player">✕</button>
      </span>
    </div>
    <video controls playsinline preload="metadata"></video>
    <div class="pwin-loading">${chipHTML('LOADING')}</div>
    <div class="pwin-idle">${chipHTML('')}<span>PICK A CHANNEL BELOW</span></div>
    <div class="player-err"></div>`;
  stage.appendChild(cell);

  const video = cell.querySelector('video');
  const errEl = cell.querySelector('.player-err');
  const loading = cell.querySelector('.pwin-loading');
  const idleEl = cell.querySelector('.pwin-idle');

  let engine = null, objectUrl = null, currentUrl = '', engineLabel = '—';
  let isEmpty = !!idle;
  if (isEmpty) { loading.style.display = 'none'; } else { idleEl.style.display = 'none'; }

  const fail = m => { errEl.textContent = m; errEl.classList.add('show'); toast(m); loading.style.display = 'none'; };
  video.addEventListener('waiting', () => { if (!isIdle()) loading.style.display = ''; });
  video.addEventListener('playing', () => { loading.style.display = 'none'; });
  video.addEventListener('canplay', () => { if (!isIdle()) loading.style.display = 'none'; });

  function isIdle() { return idleEl.style.display !== 'none'; }
  function attemptPlay() {
    const p = video.play();
    if (!p) return;
    p.catch(err => {
      if (err && err.name === 'NotAllowedError') {
        video.muted = true;
        video.play().then(() => showMuteBadge(cell)).catch(() => {});
      }
    });
  }

  function teardown() {
    if (engine?.destroy) try { engine.destroy(); } catch {}
    if (engine?.reset) try { engine.reset(); } catch {}
    engine = null; video.removeAttribute('src'); video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function load(src, opts = {}) {
    isEmpty = false;
    idleEl.style.display = 'none';
    errEl.classList.remove('show'); teardown();

    let kind = opts.kind, target = src;
    if (!opts.isFile && typeof src === 'string') {
      kind = kind || (/\.mpd($|\?)/i.test(src) ? 'dash' : (/\.m3u8($|\?)/i.test(src) ? 'hls' : 'native'));
      target = proxied(src);
    } else if (opts.isFile) {
      objectUrl = URL.createObjectURL(src);
      target = objectUrl; currentUrl = `file:${src.name}`; engineLabel = 'FILE';
    }
    loading.style.display = '';
    try {
      if (!opts.isFile) currentUrl = src;
      if (kind === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) { video.src = target; engineLabel = 'native-hls'; }
        else {
          await loadScript(CDN.hls);
          if (!window.Hls?.isSupported()) { video.src = target; engineLabel = 'native-hls'; }
          else {
            engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
            engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`stream error (${d.details})`); });
            engine.loadSource(target); engine.attachMedia(video); engineLabel = 'hls.js';
          }
        }
      } else if (kind === 'dash') {
        await loadScript(CDN.dash);
        engine = window.dashjs.MediaPlayer().create();
        engine.initialize(video, target, true);
        engineLabel = 'dash.js';
      } else { video.src = target; engineLabel = 'native'; }
      attemptPlay();
    } catch (e) { fail(e.message || String(e)); }
  }

  const api = {
    cell, video,
    get currentUrl() { return currentUrl; },
    get engineLabel() { return engineLabel; },
    get isEmpty() { return isEmpty; },
    setTitle(t) { cell.querySelector('.pwin-title').textContent = t; },
    focus() { cell.style.zIndex = ++zTop; },
    load,
    fill(url, name) { api.load(url); api.setTitle((name || 'LIVE').slice(0, 30)); },
    close() { api.onDestroy?.(api); api.destroy(); },
    destroy() { teardown(); cell.remove(); },
  };

  bar_drag(api, cell.querySelector('.pwin-bar'), stage);
  cell.addEventListener('pointerdown', () => api.focus());
  createSourceMenu(api, cell.querySelector('.pwin-src'));

  return api;
}

/* spawn alias kept so mountPrism reads cleanly */
const spawnWindow = stage => createWindow({ stage });

const DRAG_THRESHOLD = 14;
const SNAP_RETURN = 34;

function bar_drag(api, bar, stage) {
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    api.focus();
    const r = api.cell.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const startX = e.clientX, startY = e.clientY;
    let engaged = false;

    const move = ev => {
      if (!engaged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      engaged = true;
      api.cell.classList.add('dragging');
      api.cell.style.left = `${Math.max(0, Math.min(ev.clientX - s.left - ox, s.width - 56))}px`;
      api.cell.style.top = `${Math.max(0, Math.min(ev.clientY - s.top - oy, s.height - 44))}px`;
      api.cell.classList.add('free');
      api.cell.classList.remove('snapped');
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      api.cell.classList.remove('dragging');
      if (engaged && api.cell.dataset.slotL !== undefined) {
        const cw = stage.clientWidth, chh = stage.clientHeight;
        const curL = parseFloat(api.cell.style.left) || 0;
        const curT = parseFloat(api.cell.style.top) || 0;
        const sL = parseFloat(api.cell.dataset.slotL) / 100 * cw;
        const sT = parseFloat(api.cell.dataset.slotT) / 100 * chh;
        const sW = parseFloat(api.cell.dataset.slotW) / 100 * cw;
        const sH = parseFloat(api.cell.dataset.slotH) / 100 * chh;
        const near = Math.hypot(curL - sL, curT - sT) < SNAP_RETURN;
        const over = curL < sL + sW && curL + r.width > sL && curT < sT + sH;
        if (near || over) {
          Object.assign(api.cell.style, {
            left: api.cell.dataset.slotL + '%', top: api.cell.dataset.slotT + '%',
            width: api.cell.dataset.slotW + '%', height: api.cell.dataset.slotH + '%',
          });
          api.cell.classList.add('snapped');
          api.cell.classList.remove('free');
        }
      }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}

/* SOURCE popover for one window (smart placement) */
export function createSourceMenu(win, anchorBtn) {
  const menu = el('div', 'popover');
  menu.innerHTML = `
    <div class="strip-title"><i class="fas fa-tv" style="color:var(--accent-primary)"></i>
      OPEN A SOURCE <span class="strip-sep">|</span> <span class="engine-badge">${esc(win.engineLabel)}</span></div>
    <input class="url-input" type="text" spellcheck="false" autocomplete="off"
           placeholder="URL — .m3u8 / .mpd / .mp4 / webm / mkv…" />
    <div class="popover-actions">
      <button class="strip-btn" data-act="file">FILE…</button>
      <button class="strip-btn primary" data-act="play">PLAY</button>
    </div>
    <input type="file" accept="video/*,audio/*,.mkv,.m3u8" style="display:none" />
    <div class="menu-divider"></div>
    <div class="popover-hint">Or pick a channel from the GUIDE drawer.</div>`;
  const input = menu.querySelector('.url-input');
  menu.querySelector('[data-act="play"]').addEventListener('click', () => {
    const v = input.value.trim(); if (!v) return;
    win.load(v); closeOpenPopover();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') menu.querySelector('[data-act="play"]').click(); });
  const fi = menu.querySelector('input[type=file]');
  menu.querySelector('[data-act="file"]').addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => {
    const f = fi.files?.[0];
    if (f) { win.load(f, { isFile: true }); closeOpenPopover(); }
    fi.value = '';
  });
  anchorBtn.addEventListener('click', e => {
    e.stopPropagation();
    menu.querySelector('.engine-badge').textContent = win.engineLabel || '—';
    if (openPopover === menu) { closeOpenPopover(); return; }
    showSmart(anchorBtn, menu);
  });
}
