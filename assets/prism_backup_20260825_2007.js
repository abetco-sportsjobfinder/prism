/* ============================================================
   PRISM — independent, embeddable AV module. Piece 008.
   • ONE bottom control strip: α brand · layout select · ☰ GUIDE
     toggle · + PLAYER · CLOSE ALL · caret. No plugins/presets UI.
   • Single collapsible drawer: search + SORT (A–Z / CATEGORY /
     COUNTRY) + WORKING. CATEGORY = horizontal logo-card rows
     (~2 visible, vertical scroll through all). A–Z/COUNTRY =
     bracket tree with ★ favorites pinned.
   • Stage auto-hides nothing: players snap-lock (14px intent
     dead-zone), grid select materializes idle containers,
     solo+FREE = near-fullscreen player.
   • Footer auto-hides after 4s idle (all devices), returns on any
     pointer/touch/key activity, and never hides while drawer open.
   • Last-stream memory; streams proxied once through worker.
   ============================================================ */

import { loadCatalog, query, countries, categories, stats, getStatus, hasStream, pickStream } from './catalog.js';

const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const PRESETS_KEY = 'prism.presets';
const FAVS_KEY = 'prism.favs';
const LAST_KEY = 'prism.last';
const DEFAULT_SOURCE = 'https://propee33f9c2.airspace-cdn.cbsivideo.com/index.m3u8';
const BRAND_CAP = 300;
const GUIDE_ROW_ORDER = ['sports', 'news', 'movies', 'kids', 'music', 'entertainment', 'documentary', 'series', 'general'];
const PROXY = 'https://iptv-stream-proxy.abetscrape.workers.dev';

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
/* casino-chip spinner */
const chip = (size = '') => `<span class="poker-chip ${size}"><i></i></span>`;
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
function getPresets() { try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; } }
function savePresets(l) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(l.slice(0, 30))); } catch {} }
function getFavs() { try { return new Set(JSON.parse(localStorage.getItem(FAVS_KEY)) || []); } catch { return new Set(); } }
function saveFavs(set) { try { localStorage.setItem(FAVS_KEY, JSON.stringify([...set])); } catch {} }

let toastEl = null;
function toast(msg) {
  if (!toastEl) { toastEl = el('div', 'toast'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._h);
  toastEl._h = setTimeout(() => toastEl.classList.remove('show'), 2400);
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
      if (r.ok) { for (const [id, url] of Object.entries(await r.json())) logoMap.set(id, url); onReady?.(); }
    } catch {}
  }, 1500);
}
const logoFor = id => logoMap.get(id) || '';
const flagFor = cc => cc?.length === 2 ? `https://flagcdn.com/w40/${cc.toLowerCase()}.png` : '';

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
    <div class="popover-hint">Or tap a channel in the GUIDE drawer.</div>`;
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

/* ================= player window ================= */
let zTop = 500;

function groupChannels(list, mode) {
  const top = new Map();
  const put = (g, c) => {
    if (!top.has(g)) top.set(g, new Map());
    const bk = brandOf(c), m = top.get(g);
    if (!m.has(bk)) m.set(bk, []);
    m.get(bk).push(c);
  };
  for (const c of list) {
    if (mode === 'category') {
      const cats = (c.categories || []).filter(Boolean);
      for (const k of (cats.length ? cats.slice(0, 2) : ['general'])) put(k, c);
    } else if (mode === 'country') {
      put((c.country || '??').toUpperCase(), c);
    } else {
      const bk = brandOf(c);
      put(/^[A-Z]/.test(bk[0]) ? bk[0] : '#', c);
    }
  }
  return top;
}

export function createWindow({ stage, title = 'LIVE', idle = false }) {
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
    <div class="pwin-idle">${chip('big')}<span>PICK A CHANNEL BELOW</span></div>
    <div class="pwin-loading" style="display:none">${chip()}</div>
    <div class="pwin-err"></div>`;
  stage.appendChild(cell);

  const video = cell.querySelector('video');
  const errEl = cell.querySelector('.pwin-err');
  const loading = cell.querySelector('.pwin-loading');
  const idleEl = cell.querySelector('.pwin-idle');

  let engine = null, objectUrl = null, currentUrl = '', engineLabel = idle ? '—' : '';

  const fail = m => { errEl.textContent = m; errEl.classList.add('show'); toast(m); loading.style.display = 'none'; };
  const isIdle = () => idleEl.style.display !== 'none';
  video.addEventListener('waiting', () => { if (!isIdle()) loading.style.display = ''; });
  video.addEventListener('playing', () => { loading.style.display = 'none'; });
  video.addEventListener('canplay', () => { if (!isIdle()) loading.style.display = 'none'; });

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

  const n = stage.querySelectorAll('.pwin').length;
  const mobile = matchMedia('(max-width:820px)').matches;
  const w = Math.min(stage.clientWidth * (mobile ? 0.94 : 0.46), 620);
  Object.assign(cell.style, {
    width: w + 'px',
    height: Math.round(w * 9 / 16 + 42) + 'px',
    left: Math.min(18 + (n % 5) * 28, Math.max(0, stage.clientWidth - w - 8)) + 'px',
    top: Math.min(12 + (n % 5) * 24, 150) + 'px',
  });
  return api;
}

function showMuteBadge(cell) {
  if (!cell || cell.querySelector('.mute-badge')) return;
  const b = el('button', 'mute-badge', '🔇 TAP FOR SOUND');
  b.addEventListener('click', e => {
    e.stopPropagation();
    const v = cell.querySelector('video');
    if (v) { v.muted = false; v.volume = Math.max(v.volume, .8); }
    b.remove();
  });
  cell.appendChild(b);
}

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
      if (api.cell.dataset.slotL !== undefined && engaged) {
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

/* ================= grouping / branding ================= */
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
export function mountPrism({
  target,
  title = 'prism | α · any stream, any screen',
  defaultSource = DEFAULT_SOURCE,
} = {}) {
  document.title = title;

  /* ---------- DOM ---------- */
  const toolbar = el('div', 'stage-toolbar');
  toolbar.innerHTML = `
    <button class="strip-btn primary" id="addWin"><i class="fas fa-plus"></i> PLAYER</button>
    <select class="strip-btn" id="layoutSel">
      <option value="free" selected>FREE PLACE</option>
      <option value="2x2">2×2</option><option value="3x2">3×2</option>
      <option value="2x3">2×3</option><option value="4x2">4×2</option>
      <option value="2x4">2×4</option><option value="1x1">1×1</option>
    </select>
    <span class="win-count" id="winCount">0</span>`;
  const stage = el('div', 'stage-area');
  const emptyState = el('div', 'stage-empty',
    `<button class="stage-add">${chip('big')}<span>+ PLAYER</span></button>`);
  stage.appendChild(emptyState);

  const main = el('div', 'app');
  main.append(toolbar, stage);

  const dock = el('div', 'dock');
  const dockBar = el('div', 'dock-bar');
  dockBar.innerHTML = `
    <span class="dock-brand"><span class="alpha-mark">α</span><span class="wordmark">PRISM</span></span>
    <span class="dock-meta" id="dockMeta">${chip('sm')} LOADING…</span>
    <span class="dock-tools">
      <button class="dock-tool primary" id="addWin" title="New player"><i class="fas fa-plus"></i></button>
      <button class="dock-tool danger" id="closeAll" title="Close all"><i class="fas fa-xmark"></i></button>
    </span>
    <button class="dock-menu-btn" id="menuToggle">
      <i class="fas fa-list-ul"></i> GUIDE <i class="fas fa-chevron-up" id="dockCaret"></i>
    </button>`;
  const sheet = el('div', 'dock-sheet');

  const filters = el('div', 'tree-filters');
  filters.innerHTML = `
    <input id="treeQ" class="url-input tree-q" type="search" placeholder="⌕ search channels…" />
    <select id="sortSel" class="strip-btn tree-sort">
      <option value="az" selected>A–Z</option>
      <option value="category">CATEGORY</option>
      <option value="country">COUNTRY</option>
    </select>
    <label class="tree-working"><input type="checkbox" id="treeW" checked /> WORKING</label>`;
  const catRows = el('div', 'cat-rows', '<div class="tree-boot">…</div>');
  const treeBox = el('div', 'tree-box');
  sheet.append(filters, catRows, treeBox);
  dock.append(dockBar, sheet);
  main.append(dock);
  target.appendChild(main);

  /* ---------- state ---------- */
  const $ = id => document.getElementById(id);
  const winCountEl = $('winCount');
  const wins = [];
  let layoutMode = 'free';
  let drawerOpen = false;
  const favs = getFavs();

  /* ---------- layout ---------- */
  function apply(mode) {
    if (mode !== 'free') {
      const [cols, rows] = mode.split('x').map(Number);
      const gap = 0.9;
      const cw = (100 - gap * (cols + 1)) / cols;
      const ch = (100 - gap * (rows + 1)) / rows;
      wins.forEach((w, i) => {
        if (i >= cols * rows) { w.cell.style.opacity = '.25'; return; }
        w.cell.style.opacity = '';
        const L = gap + (i % cols) * (cw + gap);
        const T = gap + Math.floor(i / cols) * (ch + gap);
        Object.assign(w.cell.style, { left: L + '%', top: T + '%', width: cw + '%', height: ch + '%' });
        w.cell.dataset.slotL = L; w.cell.dataset.slotT = T;
        w.cell.dataset.slotW = cw; w.cell.dataset.slotH = ch;
        w.cell.classList.add('snapped');
      });
    }
    /* stage height adapts */
    let h;
    if (mode === 'free') {
      const sTop = stage.getBoundingClientRect().top;
      h = innerHeight - sTop - 62;                       // dock height
      for (const w of wins) {
        const r = w.cell.getBoundingClientRect();
        h = Math.max(h, r.bottom - sTop + 16);
      }
    } else {
      const [cols, rowsCap] = mode.split('x').map(Number);
      const laid = Math.min(Math.max(1, Math.ceil(wins.length / cols)), rowsCap) || 1;
      const cw = (stage.clientWidth - 12 * (cols + 1)) / cols;
      h = laid * (cw * 9 / 16 + 42) + 12 * (laid + 1);
    }
    stage.style.height = `${Math.round(Math.max(h, innerHeight * 0.45))}px`;

    /* solo FREE = near-fullscreen window */
    if (mode === 'free' && wins.length === 1) {
      const w0 = wins[0];
      w0.cell.classList.add('solo-win');
      Object.assign(w0.cell.style, {
        left: '8px', top: '8px',
        width: (stage.clientWidth - 16) + 'px',
        height: (parseFloat(stage.style.height) - 16) + 'px',
      });
    } else {
      wins.forEach(w => w.cell.classList.remove('solo-win'));
    }
  }

  function refreshChrome() {
    emptyState.style.display = wins.length ? 'none' : '';
    winCountEl.textContent = `${wins.length} WIN`;
    apply(layoutMode);
  }

  function addPlayer(url, name) {
    const w = createWindow({ stage });
    const origLoad = w.load.bind(w);
    w.load = (src, opts = {}) => {
      if (!opts.isFile && typeof src === 'string') setLast(rawOf(src), name || '');
      return origLoad(src, opts);
    };
    w.onDestroy = api => {
      const i = wins.indexOf(api); if (i >= 0) wins.splice(i, 1);
      apply(layoutMode); refreshChrome();
    };
    wins.push(w);
    apply(layoutMode); refreshChrome();
    w.focus();
    if (url) { w.load(url); if (name) w.setTitle(name.slice(0, 30)); }
    return w;
  }

  emptyState.querySelector('.stage-add').addEventListener('click', () => addPlayer());
  $('addWin').addEventListener('click', () => addPlayer());
  $('closeAll').addEventListener('click', () => { while (wins.length) wins[0].close(); });
  $('layoutSel').addEventListener('change', e => {
    layoutMode = e.target.value;
    if (layoutMode !== 'free') {
      const [c, r] = layoutMode.split('x').map(Number);
      while (wins.length < c * r) addPlayer();       // materialize containers
    }
    apply(layoutMode);
  });
  addEventListener('resize', () => apply(layoutMode));

  const focused = () => wins.reduce((a, b) =>
    (+a.cell.style.zIndex || 0) >= (+b.cell.style.zIndex || 0) ? a : b, wins.find(w => !w.isEmpty) || wins[0]);

  function playIntoTarget(ch) {
    const url = pickStream(ch.id);
    if (!url) return;
    let w = focused();
    if (!w) w = addPlayer();
    if (w.isEmpty) w.fill(url, ch.name);
    else { w.load(url); w.setTitle(ch.name.slice(0, 30)); }
    setLast(rawOf(url), ch.name);
    setDrawer(false);
  }
  function playNewWindow(ch) {
    const url = pickStream(ch.id);
    if (!url) return;
    const w = addPlayer();
    w.load(url);
    w.setTitle(ch.name.slice(0, 30));
    setLast(rawOf(url), ch.name);
  }

  /* ---------- favorites ---------- */
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    saveFavs(favs);
    rerenderContent();
    updateMeta();
  }

  /* ---------- drawer ---------- */
  const sheetBodyMax = () =>
    getPresets; // noop keep minifier happy
  function setDrawer(open) {
    drawerOpen = open;
    dock.classList.toggle('open', open);
    $('dockCaret').className = `fas fa-chevron-${open ? 'down' : 'up'}`;
    if (open) updateMeta();
  }
  $('menuToggle').addEventListener('click', e => { e.stopPropagation(); setDrawer(!drawerOpen); });

  /* auto-hide footer */
  let hideTimer = null;
  function poke() {
    dock.classList.remove('autohidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!drawerOpen) dock.classList.add('autohidden'); }, 4000);
  }
  ['pointermove', 'pointerdown', 'touchstart', 'keydown'].forEach(evt =>
    document.addEventListener(evt, poke, { passive: true }));
  poke();

  /* ---------- content: category rows vs bracket tree ---------- */
  const treeOpts = { q: '', country: 'all', workingOnly: true, sort: 'az', all: [], list: [] };

  function gcard(ch) {
    const st = getStatus(ch.id);
    const stream = hasStream(ch.id);
    const card = el('button', 'gcard' + (stream ? '' : ' dead'));
    const logo = logoFor(ch.id) || flagFor(ch.country);
    card.innerHTML = `
      <span class="gcard-media">${logo
        ? `<img loading="lazy" src="${esc(logo)}" onerror="this.replaceWith(document.createTextNode(''))" alt="">`
        : esc((ch.name || '?')[0].toUpperCase())}</span>
      <span class="gcard-name">${esc(ch.name)}</span>
      <span class="dot ${st}${stream ? '' : ' none'}"></span>`;
    card.title = ch.name + ' · tap = replace current · long-coming: new window';
    card.addEventListener('click', () => {
      if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 24)}`); return; }
      playIntoTarget(ch);
    });
    return card;
  }

  function renderCategoryRows(container) {
    container.replaceChildren();
    const cats = categories().filter(([c]) => !['xxx', 'adult'].includes(c.toLowerCase()));
    const prio = [...cats].sort((a, b) => {
      const ia = GUIDE_ROW_ORDER.indexOf(a[0]), ib = GUIDE_ROW_ORDER.indexOf(b[0]);
      return ((ia >= 0 ? ia : 99) - (ib >= 0 ? ib : 99)) || (b[1] - a[1]);
    });
    if (favs.size) {
      const row = el('div', 'guide-row');
      row.appendChild(el('div', 'guide-row-title',
        `<span style="color:var(--accent-secondary)">★ FAVORITES</span> <span class="count">${favs.size}</span>`));
      const strip = el('div', 'guide-cards');
      [...favs].map(id => treeOpts.byIdGet(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(c => strip.appendChild(gcard(c)));
      row.appendChild(strip);
      container.appendChild(row);
    }
    for (const [cat] of prio) {
      const chans = query({ q: '', country: 'all', workingOnly: true })
        .filter(c => (c.categories || []).map(x => x.toLowerCase()).includes(cat))
        .slice(0, 24);
      if (chans.length < 3) continue;
      const row = el('div', 'guide-row');
      row.appendChild(el('div', 'guide-row-title',
        `${esc(cat.toUpperCase())} <span class="count">${chans.length}</span>`));
      const strip = el('div', 'guide-cards');
      chans.forEach(c => strip.appendChild(gcard(c)));
      row.appendChild(strip);
      container.appendChild(row);
    }
    if (!container.children.length)
      container.innerHTML = '<div class="tree-empty">No categorized channels yet.</div>';
  }

  function channelButton(ch, onPlay, onPlayNew) {
    const st = getStatus(ch.id);
    const stream = hasStream(ch.id);
    const b = el('button', 'tree-channel' + (stream ? '' : ' nostream'));
    const logo = logoFor(ch.id);
    const flag = !logo ? flagFor(ch.country) : '';
    b.innerHTML = `
      <span class="dot ${st}${stream ? '' : ' none'}"></span>
      ${logo ? `<img class="ch-logo" loading="lazy" src="${esc(logo)}" onerror="this.replaceWith(document.createTextNode(''))" alt="">`
             : flag ? `<img class="ch-flag" loading="lazy" src="${flag}" onerror="this.style.display='none'" alt="">` : ''}
      <span class="tree-ch-name">${esc(ch.name)}</span>
      <span class="ch-actions">
        <button class="row-new" title="Open in NEW player">＋</button>
        <button class="fav-star${favs.has(ch.id) ? ' on' : ''}" title="Favorite">★</button>
      </span>`;
    b.title = ch.name + (stream ? '' : ' · no stream');
    b.addEventListener('click', e => {
      if (e.target.closest('.fav-star') || e.target.closest('.row-new')) return;
      if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
      onPlay(ch);
    });
    b.querySelector('.row-new').addEventListener('click', e => { e.stopPropagation(); onPlayNew(ch); });
    b.querySelector('.fav-star').addEventListener('click', e => { e.stopPropagation(); toggleFav(ch.id); });
    return b;
  }

  function renderTree(container, list, onPlay, onPlayNew) {
    const openKeys = new Set([...container.querySelectorAll('details[open]')].map(d => d.dataset.k));
    container.replaceChildren();
    if (favs.size) {
      const fc = [...favs].map(id => treeOpts.byIdGet(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      const det = el('details', 'tree-letter fav-group');
      det.dataset.k = '★FAV';
      if (openKeys.has('★FAV')) det.open = true;
      det.appendChild(el('summary', null,
        `<span class="tree-letter-mark">★</span><span class="tree-group-name">FAVORITES</span><span class="count">${fc.length}</span>`));
      for (const ch of fc) det.appendChild(channelButton(ch, onPlay, onPlayNew));
      container.appendChild(det);
    }
    const grouped = groupChannels(list, treeOpts.sort);
    for (const [g, subs] of grouped) {
      let count = 0; for (const l of subs.values()) count += l.length;
      const det = el('details', 'tree-letter');
      det.dataset.k = 'G:' + g;
      if (openKeys.has(det.dataset.k)) det.open = true;
      det.appendChild(el('summary', null,
        `<span class="tree-letter-mark">${esc(g)}</span><span class="count">${count.toLocaleString()}</span>`));
      for (const [sub, chans] of [...subs.entries()].sort((a, b) => (b.length - a.length) || a[0].localeCompare(b[0]))) {
        const bd = el('details', 'tree-brand');
        bd.dataset.k = `G:${g}|${sub}`;
        if (openKeys.has(bd.dataset.k)) bd.open = true;
        bd.appendChild(el('summary', null,
          `<span class="tree-brand-name">${esc(sub)}</span><span class="count">${chans.length.toLocaleString()}</span>`));
        for (const ch of chans.slice(0, BRAND_CAP))
          bd.appendChild(channelButton(ch, onPlay, onPlayNew));
        if (chans.length > BRAND_CAP)
          bd.appendChild(el('div', 'tree-more', `+${(chans.length - BRAND_CAP).toLocaleString()} more…`));
        det.appendChild(bd);
      }
      container.appendChild(det);
    }
    if (!container.children.length)
      container.appendChild(el('div', 'tree-empty',
        treeOpts.workingOnly ? 'No verified-working matches. Untick WORKING.' : 'Nothing matches.'));
  }

  function rerenderContent() {
    if (treeOpts.sort === 'category') {
      treeBox.style.display = 'none';
      catRows.style.display = '';
      renderCategoryRows(catRows);
    } else {
      catRows.style.display = 'none';
      treeBox.style.display = '';
      renderTree(treeBox, query(treeOpts), playIntoTarget, playNewWindow);
    }
  }
  let qT;
  filters.querySelector('#treeQ').addEventListener('input', e => {
    clearTimeout(qT);
    qT = setTimeout(() => { treeOpts.q = e.target.value; rerenderContent(); }, 250);
  });
  filters.querySelector('#treeW').addEventListener('change', e => { treeOpts.workingOnly = e.target.checked; rerenderContent(); });
  filters.querySelector('#sortSel').addEventListener('change', e => { treeOpts.sort = e.target.value; rerenderContent(); });

  function updateMeta() {
    const s = stats();
    $('dockMeta').innerHTML =
      `<b>${s.totalAll.toLocaleString()}</b> CH · <b class="ok">${s.working.toLocaleString()} ✓</b>` +
      (favs.size ? ` · <b style="color:var(--accent-secondary)">★${favs.size}</b>` : '');
  }

  /* expose channel lookup for favorites rendering */
  treeOpts.byIdGet = id => query({ q: '', country: 'all', workingOnly: false }).find(c => c.id === id);

  /* ---------- boot ---------- */
  (async () => {
    try {
      const s = await loadCatalog(m => {
        catRows.innerHTML = `<div class="tree-boot">${chip('big')}<div>${esc(m || 'working…')}</div></div>`;
        $('dockMeta').innerHTML = `${chip('sm')} ${esc(m || 'loading…')}`;
      });
      treeOpts.all = query({ q: '', country: 'all', workingOnly: false });
      rerenderContent();
      updateMeta();
      requestLogos(rerenderContent);
      toast(`${s.total.toLocaleString()} READY · ${s.working.toLocaleString()} VERIFIED`);
    } catch (e) {
      catRows.innerHTML = `<div class="tree-boot">⚠ catalog failed: ${esc(e.message)}</div>`;
      $('dockMeta').textContent = 'catalog offline — players still work';
    }
    const qp = new URLSearchParams(location.search).get('src');
    const last = getLast();
    const boot = qp || (last ? rawOf(last.url) : null) || defaultSource;
    const w = addPlayer(boot);
    if (!qp && last?.name) w.setTitle(last.name.slice(0, 30));
  })();

  return { app: main, addPlayer, wins, rerenderContent, setDrawer, player() { return focused(); } };
}
