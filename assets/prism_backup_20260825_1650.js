/* ============================================================
   PRISM — independent, embeddable AV module. Piece 003.
   • No header. α branding lives in the bottom dock.
   • Bottom-dock CHANNELS drawer: collapsible, bracket tree
     (letter > brand > channels), search/country/WORKING filters.
   • Floating draggable players: ✕ per window, CLOSE ALL, + PLAYER.
   • Stage height adapts to player count; snap grids:
     free / 1x1 / 2x2 / 3x2 / 2x3 / 4x2 / 2x4.
   Engines: .m3u8→hls.js(lazy)→native-HLS · .mpd→dash.js(lazy) ·
            everything else native · local files via object URLs.

   Embed: import { mountPrism } from '/assets/prism.js'
   ============================================================ */

import { loadCatalog, query, hierarchy, countries, stats, getStatus, pickStream } from './catalog.js';

const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const PRESETS_KEY = 'prism.presets';
const DEFAULT_SOURCE = 'https://propee33f9c2.airspace-cdn.cbsivideo.com/index.m3u8';

/* ================= utils ================= */
const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) loadedScripts.set(src, new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('load fail ' + src));
    document.head.appendChild(s);
  }));
  return loadedScripts.get(src);
}
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chip = (size = '') => `<i class="fas fa-microchip fa-spin spin-chip ${size}"></i>`;

function getPresets() { try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; } }
function savePresets(l) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(l.slice(0, 30))); } catch {} }

/* ================= popovers ================= */
let openPopover = null;
function closeOpenPopover() { if (openPopover) { openPopover.remove(); openPopover = null; } }
document.addEventListener('pointerdown', e => { if (openPopover && !openPopover.contains(e.target)) closeOpenPopover(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpenPopover(); });

function showAbove(anchor, node) {
  closeOpenPopover();
  document.body.appendChild(node);
  const r = anchor.getBoundingClientRect();
  const w = Math.max(320, Math.round(r.width));
  node.style.cssText =
    `position:fixed;bottom:${innerHeight - r.top + 10}px;left:${Math.max(10, Math.min(r.left, innerWidth - w - 10))}px;width:${w}px`;
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
    <div class="popover-hint">Or tap a channel in the CHANNELS dock — it plays in the focused window.</div>`;
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
    showAbove(anchorBtn, menu);
  });
}

export function createPresetMenu(getWin, anchorBtn) {
  const menu = el('div', 'popover');
  const render = () => {
    const presets = getPresets();
    menu.innerHTML = `
      <div class="strip-title"><i class="fas fa-plug" style="color:var(--accent-primary)"></i>SAVED SOURCES</div>
      <div class="preset-list">
        ${presets.length ? presets.map((p, i) => `
          <div class="preset-row" data-i="${i}">
            <button class="preset-name">${esc(p.name)}</button><button class="preset-del">✕</button>
          </div>`).join('') : '<div class="popover-hint">Nothing saved yet — play something, then SAVE.</div>'}
      </div>
      <div class="save-row">
        <input class="preset-name-input" maxlength="40" placeholder="Name for FOCUSED stream…" />
        <button class="strip-btn primary" data-act="save">SAVE</button>
      </div>`;
    menu.querySelectorAll('.preset-name').forEach(b => b.addEventListener('click', () => {
      const p = getPresets()[+b.closest('.preset-row').dataset.i];
      if (p) { getWin().load(p.url); closeOpenPopover(); }
    }));
    menu.querySelectorAll('.preset-del').forEach(b => b.addEventListener('click', () => {
      const l = getPresets(); l.splice(+b.closest('.preset-row').dataset.i, 1); savePresets(l); render();
    }));
    menu.querySelector('[data-act="save"]').addEventListener('click', () => {
      const url = getWin().currentUrl;
      if (!url) return;
      const nameEl = menu.querySelector('.preset-name-input');
      const list = getPresets();
      list.unshift({ name: nameEl.value.trim() || url.split('/').pop().slice(0, 32), url });
      savePresets(list); render();
    });
  };
  anchorBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (openPopover === menu) { closeOpenPopover(); return; }
    render(); showAbove(anchorBtn, menu);
  });
}

/* ================= player window ================= */
let zTop = 500;

export function createWindow({ stage, title = 'LIVE' }) {
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
    <div class="pwin-loading">${chip()}</div>
    <div class="pwin-err"></div>`;
  stage.appendChild(cell);

  const video = cell.querySelector('video');
  const errEl = cell.querySelector('.pwin-err');
  const loading = cell.querySelector('.pwin-loading');

  let engine = null, objectUrl = null, currentUrl = '', engineLabel = '—';

  const fail = m => { errEl.textContent = m; errEl.classList.add('show'); loading.style.display = 'none'; };
  video.addEventListener('waiting', () => { loading.style.display = ''; });
  video.addEventListener('playing', () => { loading.style.display = 'none'; });

  function teardown() {
    if (engine?.destroy) try { engine.destroy(); } catch {}
    if (engine?.reset) try { engine.reset(); } catch {}
    engine = null; video.removeAttribute('src'); video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function load(src, { isFile = false } = {}) {
    errEl.classList.remove('show'); teardown(); loading.style.display = '';
    try {
      if (isFile) {
        objectUrl = URL.createObjectURL(src);
        video.src = objectUrl; currentUrl = `file:${src.name}`; engineLabel = 'FILE';
      } else {
        currentUrl = src;
        const kind = /\.mpd($|\?)/i.test(src) ? 'dash' : (/\.m3u8($|\?)/i.test(src) ? 'hls' : 'native');
        if (kind === 'hls') {
          if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) { video.src = src; engineLabel = 'native-hls'; }
          else {
            await loadScript(CDN.hls);
            if (!window.Hls?.isSupported()) { video.src = src; engineLabel = 'native-hls'; }
            else {
              engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
              engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`stream error (${d.details})`); });
              engine.loadSource(src); engine.attachMedia(video); engineLabel = 'hls.js';
            }
          }
        } else if (kind === 'dash') {
          await loadScript(CDN.dash);
          engine = window.dashjs.MediaPlayer().create();
          engine.initialize(video, src, true);
          engineLabel = 'dash.js';
        } else { video.src = src; engineLabel = 'native'; }
      }
      await video.play().catch(() => {});
    } catch (e) { fail(e.message || String(e)); }
  }

  const api = {
    cell, video,
    get currentUrl() { return currentUrl; },
    get engineLabel() { return engineLabel; },
    setTitle(t) { cell.querySelector('.pwin-title').textContent = t; },
    focus() { cell.style.zIndex = ++zTop; },
    load,
    close() { api.onDestroy?.(api); api.destroy(); },
    destroy() { teardown(); cell.remove(); },
  };

  /* drag (mouse + touch) */
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

function bar_drag(api, bar, stage) {
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    api.focus();
    const r = api.cell.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = ev => {
      api.cell.style.left = `${Math.max(0, Math.min(ev.clientX - s.left - ox, s.width - 56))}px`;
      api.cell.style.top = `${Math.max(0, Math.min(ev.clientY - s.top - oy, s.height - 44))}px`;
      api.cell.classList.add('free');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}

/* ================= layout + dynamic stage ================= */
function applyLayout(stage, wins, mode, fit) {
  if (mode !== 'free') {
    const [cols, rows] = mode.split('x').map(Number);
    const gap = 0.9;
    const cw = (100 - gap * (cols + 1)) / cols;
    const ch = (100 - gap * (rows + 1)) / rows;
    wins.forEach((w, i) => {
      if (i >= cols * rows) { w.cell.style.opacity = '.25'; return; }
      w.cell.style.opacity = '';
      const col = i % cols, row = Math.floor(i / cols);
      Object.assign(w.cell.style, {
        left: `${gap + col * (cw + gap)}%`,
        top: `${gap + row * (ch + gap)}%`,
        width: `${cw}%`, height: `${ch}%`,
      });
      w.cell.classList.add('snapped');
    });
  }
  fitStage(stage, wins, mode);
}

function fitStage(stage, wins, mode) {
  let h;
  if (mode === 'free') {
    const sTop = stage.getBoundingClientRect().top;
    h = innerHeight * 0.55;
    for (const w of wins) {
      const r = w.cell.getBoundingClientRect();
      h = Math.max(h, r.bottom - sTop + 16);
    }
  } else {
    const [cols, rowsCap] = mode.split('x').map(Number);
    const usedRows = Math.max(1, Math.ceil(wins.length / cols), Math.min(rowsCap, wins.length ? rowsCap : 1));
    const cw = (stage.clientWidth - 12 * (cols + 1)) / cols;
    h = usedRows * (cw * 9 / 16 + 42) + 12 * (usedRows + 1);
  }
  stage.style.height = `${Math.round(Math.max(h, 240))}px`;
}

/* ================= channel tree ================= */
function renderTree(container, opts) {
  const list = query(opts);
  const letters = hierarchy(list);
  container.replaceChildren();

  if (!list.length) {
    container.appendChild(el('div', 'tree-empty',
      opts.workingOnly
        ? 'No verified-working matches. Untick WORKING to see untested channels.'
        : 'Nothing matches.'));
    return;
  }

  for (const [L, brands] of [...letters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let count = 0; for (const bl of brands.values()) count += bl.length;
    const det = el('details', 'tree-letter');
    det.appendChild(el('summary', null,
      `<span class="tree-letter-mark">${esc(L)}</span><span class="count">${count.toLocaleString()}</span>`));
    for (const [bk, chans] of [...brands.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const bd = el('details', 'tree-brand');
      bd.appendChild(el('summary', null,
        `<span class="tree-brand-name">${esc(bk)}</span><span class="count">${chans.length}</span>`));
      for (const ch of chans.slice(0, 80)) {
        const st = getStatus(ch.id);
        const b = el('button', 'tree-channel', `<span class="dot ${st}"></span>${esc(ch.name)}`);
        b.title = ch.name;
        b.addEventListener('click', () => opts.onPlay(ch));
        bd.appendChild(b);
      }
      if (chans.length > 80) bd.appendChild(el('div', 'tree-more', `+${(chans.length - 80).toLocaleString()} more…`));
      det.appendChild(bd);
    }
    container.appendChild(det);
  }
}

/* ================= bootstrap ================= */
export function mountPrism({
  target,
  title = 'prism | α · any stream, any screen',
  defaultSource = DEFAULT_SOURCE,
} = {}) {
  document.title = title;

  /* ---------- stage ---------- */
  const toolbar = el('div', 'stage-toolbar');
  toolbar.innerHTML = `
    <button class="strip-btn primary" id="addWin"><i class="fas fa-plus"></i> PLAYER</button>
    <select class="strip-btn" id="layoutSel">
      <option value="free">FREE PLACE</option>
      <option value="1x1">1×1</option>
      <option value="2x2" selected>2×2</option>
      <option value="3x2">3×2</option><option value="2x3">2×3</option>
      <option value="4x2">4×2</option><option value="2x4">2×4</option>
    </select>
    <button class="strip-btn" id="srcBtn"><i class="fas fa-plug"></i> SOURCES</button>
    <button class="strip-btn danger" id="closeAll">CLOSE ALL</button>
    <span class="win-count" id="winCount">0</span>`;
  const stage = el('div', 'stage-area');
  const emptyState = el('div', 'stage-empty',
    `<button class="stage-add">${chip('big')}<span>+ PLAYER</span></button>`);
  stage.appendChild(emptyState);

  const main = el('div', 'app');
  main.append(toolbar, stage);
  target.appendChild(main);

  /* ---------- windows ---------- */
  const wins = [];
  let layoutMode = 'free';

  function refreshChrome() {
    emptyState.style.display = wins.length ? 'none' : '';
    document.getElementById('winCount').textContent =
      `${wins.length} WINDOW${wins.length === 1 ? '' : 'S'}`;
    document.getElementById('closeAll').style.display = wins.length ? '' : 'none';
    fitStage(stage, wins, layoutMode);
  }

  function addPlayer(url) {
    const w = createWindow({ stage });
    w.onDestroy = api => {
      const i = wins.indexOf(api); if (i >= 0) wins.splice(i, 1);
      applyLayout(stage, wins, layoutMode);
      refreshChrome();
    };
    wins.push(w);
    applyLayout(stage, wins, layoutMode);
    refreshChrome();
    w.focus();
    if (url) w.load(url);
    return w;
  }

  document.getElementById('addWin').addEventListener('click', () => addPlayer());
  emptyState.querySelector('.stage-add').addEventListener('click', () => addPlayer());
  document.getElementById('closeAll').addEventListener('click', () => {
    while (wins.length) wins[0].close();
  });
  document.getElementById('layoutSel').addEventListener('change', e => {
    layoutMode = e.target.value;
    applyLayout(stage, wins, layoutMode);
  });
  addEventListener('resize', () => applyLayout(stage, wins, layoutMode));

  const focused = () => wins.reduce((a, b) =>
    (+a.cell.style.zIndex || 0) >= (+b.cell.style.zIndex || 0) ? a : b, wins[0]);

  /* ---------- bottom dock: CHANNELS ---------- */
  const dock = el('div', 'dock');
  const dockBar = el('button', 'dock-bar',
    `<span class="dock-brand">α<span>prism</span></span>
     <span class="dock-meta" id="dockMeta">${chip('sm')} LOADING CATALOG…</span>
     <i class="fas fa-chevron-up dock-chev"></i>`);
  const sheet = el('div', 'dock-sheet');
  const filters = el('div', 'tree-filters');
  filters.innerHTML = `
    <input id="treeQ" class="url-input tree-q" type="search" placeholder="⌕ search channels…" />
    <select id="treeC" class="strip-btn tree-country"><option value="all">🌍 ALL</option></select>
    <label class="tree-working"><input type="checkbox" id="treeW" checked /> WORKING</label>`;
  const treeBox = el('div', 'tree-box', `<div class="tree-boot">${chip('big')}<div>LOADING CATALOG…</div></div>`);
  sheet.append(filters, treeBox);
  dock.append(dockBar, sheet);
  target.appendChild(dock);

  let dockOpen = false;
  function setDock(open) {
    dockOpen = open;
    dock.classList.toggle('open', open);
    dockBar.querySelector('.dock-chev').className =
      `fas fa-chevron-${open ? 'down' : 'up'} dock-chev`;
    document.body.classList.toggle('dock-open', open);
  }
  dockBar.addEventListener('click', () => setDock(!dockOpen));

  /* tree interactions */
  const treeOpts = { q: '', country: 'all', workingOnly: true };
  function rerenderTree() {
    renderTree(treeBox, {
      ...treeOpts,
      onPlay(ch) {
        const url = pickStream(ch.id);
        if (!url) return;
        const w = wins.length ? focused() : addPlayer();
        w.load(url);
        w.setTitle(ch.name.slice(0, 30));
        if (matchMedia('(max-width:820px)').matches) setDock(false);
      },
    });
  }
  let qT;
  filters.querySelector('#treeQ').addEventListener('input', e => {
    clearTimeout(qT);
    qT = setTimeout(() => { treeOpts.q = e.target.value; rerenderTree(); }, 250);
  });
  filters.querySelector('#treeW').addEventListener('change', e => { treeOpts.workingOnly = e.target.checked; rerenderTree(); });
  filters.querySelector('#treeC').addEventListener('change', e => { treeOpts.country = e.target.value; rerenderTree(); });

  createPresetMenu(focused, document.getElementById('srcBtn'));

  /* ---------- boot ---------- */
  (async () => {
    try {
      const s = await loadCatalog(m => {
        treeBox.innerHTML = `<div class="tree-boot">${chip('big')}<div>${esc(m || 'working…')}</div></div>`;
        document.getElementById('dockMeta').innerHTML = `${chip('sm')} ${esc(m || 'loading…')}`;
      });
      filters.querySelector('#treeC').insertAdjacentHTML('beforeend',
        countries().slice(0, 40)
          .map(([code, n]) => `<option value="${code}">${code.toUpperCase()} (${n.toLocaleString()})</option>`).join(''));
      rerenderTree();
      document.getElementById('dockMeta').innerHTML =
        `<b>${s.totalAll.toLocaleString()}</b> indexed · <span>${s.total.toLocaleString()} ready</span> · <b class="ok">${s.working.toLocaleString()} verified</b>`;
    } catch (e) {
      treeBox.innerHTML = `<div class="tree-boot">⚠ catalog failed: ${esc(e.message)}</div>`;
      document.getElementById('dockMeta').textContent = 'catalog offline — players still work';
    }
    addPlayer(new URLSearchParams(location.search).get('src') || defaultSource);
  })();

  return { app: main, addPlayer, wins, rerenderTree, setDock, get player() { return focused(); } };
}
