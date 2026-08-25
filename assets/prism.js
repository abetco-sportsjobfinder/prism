/* ============================================================
   PRISM — independent, embeddable AV module. Piece 002.
   α branding · spinning-chip loader · floating draggable players
   with snap layouts (1x1, 2x2, 4x2, 2x4, free) · channel hierarchy
   bracket (letter > brand > channels) fed by catalog.js.

   Embed: import { mountPrism } from '/assets/prism.js'
   ============================================================ */

import { loadCatalog, query, hierarchy, countries, stats, getStatus, pickStream, PROXY, db } from './catalog.js';

const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const PRESETS_KEY = 'prism.presets';
const DEFAULT_SOURCE = 'https://propee33f9c2.airspace-cdn.cbsivideo.com/index.m3u8';

/* ---------------- tiny utils ---------------- */
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

/* ---------------- presets ---------------- */
function getPresets() { try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; } }
function savePresets(l) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(l.slice(0, 30))); } catch {} }

/* ---------------- header ---------------- */
export function mountHeader({ target, tickerItems = ['LOADING CATALOG…'], right = [] }) {
  const header = el('header', 'header');
  const left = el('div', 'header-left');
  const burger = el('button', 'hamburger-btn', '<span></span><span></span><span></span>');
  burger.title = 'Toggle channels';
  const logo = el('button', 'logo-btn glitch-text', '<span class="alpha">α</span>prism');
  left.append(burger, logo);

  const center = el('div', 'header-center');
  const dm = el('div', 'dot-matrix-container');
  const dmScroll = el('div', 'dot-matrix-scroll');
  dm.appendChild(dmScroll);
  center.appendChild(dm);

  const rightEl = el('div', 'header-right');
  right.forEach(n => rightEl.appendChild(n));

  header.append(left, center, rightEl);
  target.appendChild(header);

  function setTicker(items) {
    const g = items.map(t => `<span>${esc(t)}</span><span class="separator">•</span>`).join('');
    dmScroll.innerHTML = g + g;
  }
  setTicker(tickerItems);
  return { header, burger, setTicker };
}

/* ---------------- collapsible section shell ---------------- */
export function mountNavSection({ target, label = 'CHANNELS', startCollapsed = false }) {
  const section = el('div', `collapsible-section${startCollapsed ? ' collapsed' : ''}`);
  const toggle = el('button', 'collapse-toggle',
    `${chip()}<span class="collapse-label">${esc(label)}</span>
     <span class="collapse-meta" id="navMeta">${chip('sm')}</span>
     <i class="fas fa-chevron-${startCollapsed ? 'down' : 'up'}"></i>`);
  const body = el('div', 'section-body');
  section.append(toggle, body);
  target.appendChild(section);
  const setExpanded = v => {
    section.classList.toggle('collapsed', !v);
    toggle.querySelector('i').className = `fas fa-chevron-${v ? 'up' : 'down'}`;
  };
  toggle.addEventListener('click', () => setExpanded(section.classList.contains('collapsed')));
  return {
    section, body, setExpanded,
    toggleCollapse: () => setExpanded(section.classList.contains('collapsed')),
    meta(html) { body.ownerDocument.getElementById('navMeta').innerHTML = html; },
  };
}

/* ---------------- popovers ---------------- */
let openPopover = null;
function closeOpenPopover() { if (openPopover) { openPopover.remove(); openPopover = null; } }
document.addEventListener('pointerdown', e => { if (openPopover && !openPopover.contains(e.target)) closeOpenPopover(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpenPopover(); });
function showPopover(anchor, node) {
  closeOpenPopover();
  document.body.appendChild(node);
  const r = anchor.getBoundingClientRect();
  const w = Math.max(340, Math.round(r.width));
  node.style.cssText = `position:fixed;top:${Math.min(r.bottom + 6, innerHeight - 30)}px;left:${Math.max(10, Math.min(r.left, innerWidth - w - 10))}px;width:${w}px`;
  openPopover = node;
  setTimeout(() => node.querySelector('input')?.focus(), 30);
  return node;
}

/* SOURCE menu for one window */
export function createSourceMenu(win, anchorBtn) {
  const menu = el('div', 'popover');
  const renderStatic = () => {
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
      <div class="popover-hint">Or pick from the CHANNELS panel — click any channel to play it here.</div>`;
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
  };
  anchorBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (openPopover === menu) { closeOpenPopover(); return; }
    renderStatic();
    showPopover(anchorBtn, menu);
  });
}

/* SOURCES preset manager */
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
          </div>`).join('') : '<div class="popover-hint">Nothing saved yet.</div>'}
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
      const api = getWin(); const url = api.currentUrl;
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
    render(); showPopover(anchorBtn, menu);
  });
}

/* ---------------- player window (floating, draggable) ---------------- */
let zTop = 500;

export function createWindow({ stage, title = 'PLAYER' }) {
  const cell = el('section', 'pwin');
  cell.innerHTML = `
    <div class="pwin-bar">
      <span class="pwin-drag"><i class="fas fa-grip-lines"></i> <span class="pwin-title">${esc(title)}</span></span>
      <span class="pwin-actions">
        <button class="pwin-src" title="Change source">SOURCE</button>
        <button class="pwin-close" title="Close">✕</button>
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
    errEl.classList.remove('show'); teardown();
    loading.style.display = '';
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
    load,
    focus() { cell.style.zIndex = ++zTop; },
    destroy() { teardown(); cell.remove(); },
  };

  /* drag by bar */
  const bar = cell.querySelector('.pwin-bar');
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    api.focus();
    const r = cell.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = ev => {
      cell.style.left = `${Math.max(0, Math.min(ev.clientX - s.left - ox, s.width - 60))}px`;
      cell.style.top = `${Math.max(0, Math.min(ev.clientY - s.top - oy, s.height - 40))}px`;
      cell.classList.add('free');
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  cell.addEventListener('pointerdown', () => api.focus());

  /* buttons */
  createSourceMenu(api, cell.querySelector('.pwin-src'));
  cell.querySelector('.pwin-close').addEventListener('click', () => api.close?.());

  api.close = () => { api.onDestroy?.(api); api.destroy(); };

  /* default size/cascade position */
  const n = stage.querySelectorAll('.pwin').length;
  const w = Math.min(stage.clientWidth * 0.46, 620);
  Object.assign(cell.style, {
    width: w + 'px',
    height: (w * 9 / 16 + 34) + 'px',
    left: Math.min(24 + (n % 5) * 30, Math.max(0, stage.clientWidth - w - 10)) + 'px',
    top: Math.min(14 + (n % 5) * 26, 200) + 'px',
  });
  return api;
}

/* ---------------- snap layout engine ---------------- */
export function applyLayout(stage, wins, mode) {
  if (mode === 'free' || !wins.length) return;
  const [c, r] = mode.split('x').map(Number);           // "2x2" = cols x rows
  const gapPct = 0.8;
  const cw = (100 - gapPct * (c + 1)) / c;
  const ch = (100 - gapPct * (r + 1)) / r;
  wins.forEach((w, i) => {
    if (i >= c * r) { w.cell.style.opacity = '.25'; return; }   // overflow windows dimmed
    w.cell.style.opacity = '';
    const col = i % c, row = Math.floor(i / c);
    Object.assign(w.cell.style, {
      left: `${gapPct + col * (cw + gapPct)}%`,
      top: `${gapPct + row * (ch + gapPct)}%`,
      width: `${cw}%`, height: `${ch}%`,
    });
    w.cell.classList.add('snapped');
  });
}

/* ---------------- channel hierarchy tree ---------------- */
function renderTree(container, opts) {
  const list = query(opts);
  const letters = hierarchy(list);
  container.replaceChildren();

  if (!list.length) {
    container.appendChild(el('div', 'tree-empty',
      opts.workingOnly ? 'No verified-working matches. Toggle WORKING off to see untested channels.' : 'Nothing matches.'));
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
        const b = el('button', 'tree-channel',
          `<span class="dot ${st}"></span>${esc(ch.name)}${st === 'working' ? '' : ''}`);
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

/* ============================================================
   bootstrap
   ============================================================ */
export function mountPrism({
  target,
  title = 'prism | α · any stream, any screen',
  defaultSource = DEFAULT_SOURCE,
} = {}) {
  document.title = title;
  const app = el('div', 'app crt-effect');
  target.appendChild(app);

  /* ---- header ---- */
  const { burger, setTicker } = mountHeader({
    target: app,
    tickerItems: ['LOADING CATALOG…', 'PRISM'],
    right: [],
  });

  /* ---- nav section = CHANNELS hierarchy ---- */
  const nav = mountNavSection({ target: app, label: 'CHANNELS', startCollapsed: true });
  const filters = el('div', 'tree-filters');
  filters.innerHTML = `
    <input id="treeQ" class="url-input tree-q" type="search" placeholder="⌕ search channels…" />
    <select id="treeC" class="strip-btn tree-country"><option value="all">🌍 ALL</option></select>
    <label class="tree-working"><input type="checkbox" id="treeW" checked /> WORKING</label>`;
  const treeBox = el('div', 'tree-box', `<div class="tree-boot">${chip('big')}<div>LOADING CATALOG…</div></div>`);
  nav.body.append(filters, treeBox);

  /* ---- stage toolbar + area ---- */
  const toolbar = el('div', 'stage-toolbar');
  toolbar.innerHTML = `
    <button class="strip-btn primary" id="addWin"><i class="fas fa-plus"></i> PLAYER</button>
    <select class="strip-btn" id="layoutSel">
      <option value="free">FREE PLACE</option>
      <option value="1x1">1×1</option><option value="2x2" selected>2×2</option>
      <option value="3x2">3×2</option><option value="2x3">2×3</option>
      <option value="4x2">4×2</option><option value="2x4">2×4</option>
    </select>
    <span class="win-count" id="winCount">0 WINDOWS</span>`;
  const stage = el('div', 'stage-area');
  const emptyState = el('div', 'stage-empty',
    `<button class="stage-add">${chip('big')}<span>+ PLAYER</span></button>`);
  stage.appendChild(emptyState);
  app.append(toolbar, stage);

  /* ---- window management ---- */
  const wins = [];
  const q = () => new URLSearchParams(location.search).get('src');

  function refreshEmpty() {
    emptyState.style.display = wins.length ? 'none' : '';
    document.getElementById('winCount').textContent = `${wins.length} WINDOW${wins.length === 1 ? '' : 'S'}`;
  }

  function addPlayer(url) {
    const w = createWindow({ stage, title: 'LIVE' });
    w.onDestroy = api => {
      const i = wins.indexOf(api); if (i >= 0) wins.splice(i, 1);
      applyLayout(stage, wins, document.getElementById('layoutSel').value);
      refreshEmpty();
    };
    wins.push(w);
    applyLayout(stage, wins, document.getElementById('layoutSel').value);
    refreshEmpty();
    w.focus();
    if (url) w.load(url);
    return w;
  }

  document.getElementById('addWin').addEventListener('click', () => addPlayer());
  emptyState.querySelector('.stage-add').addEventListener('click', () => addPlayer());
  document.getElementById('layoutSel').addEventListener('change', e =>
    applyLayout(stage, wins, e.target.value));

  /* focused = top-most window */
  const focused = () => wins.reduce((a, b) =>
    (+a.cell.style.zIndex || 0) >= (+b.cell.style.zIndex || 0) ? a : b, wins[0]);

  /* ---- hamburger toggles channels panel ---- */
  burger.addEventListener('click', () => nav.toggleCollapse());

  /* ---- tree wiring ---- */
  const treeOpts = { q: '', country: 'all', workingOnly: true };
  function rerenderTree() {
    renderTree(treeBox, {
      ...treeOpts,
      onPlay(ch) {
        const url = pickStream(ch.id);
        if (!url) return;
        const w = wins.length ? focused() : addPlayer();
        w.load(url);
        w.setTitle(ch.name.slice(0, 28));
        if (window.innerWidth < 900) nav.setExpanded(false);
      },
    });
  }
  filters.querySelector('#treeQ').addEventListener('input', e => {
    clearTimeout(filters._t);
    filters._t = setTimeout(() => { treeOpts.q = e.target.value; rerenderTree(); }, 250);
  });
  filters.querySelector('#treeW').addEventListener('change', e => {
    treeOpts.workingOnly = e.target.checked; rerenderTree();
  });
  filters.querySelector('#treeC').addEventListener('change', e => {
    treeOpts.country = e.target.value; rerenderTree();
  });

  /* ---- SOURCES preset pill lives in toolbar too (small) ---- */
  const srcBtn = el('button', 'strip-btn', '<i class="fas fa-plug"></i> SOURCES');
  toolbar.insertBefore(srcBtn, document.getElementById('layoutSel'));
  createPresetMenu(focused, srcBtn);

  /* ---- boot sequence ---- */
  (async () => {
    try {
      const s = await loadCatalog(m => {
        treeBox.innerHTML = `<div class="tree-boot">${chip('big')}<div>${esc(m || 'working…')}</div></div>`;
        setTicker([m || 'loading…']);
      });
      const cc = countries().slice(0, 40)
        .map(([code, n]) => `<option value="${code}">${code.toUpperCase()} (${n.toLocaleString()})</option>`).join('');
      filters.querySelector('#treeC').insertAdjacentHTML('beforeend', cc);
      rerenderTree();
      nav.meta(`${s.total.toLocaleString()} CH · <b style="color:#00ff88">${s.working.toLocaleString()} WORKING</b>`);
      setTicker([
        `${s.total.toLocaleString()} CHANNELS`,
        `${s.working.toLocaleString()} VERIFIED WORKING`,
        'CLICK ANY CHANNEL TO PLAY',
        'HLS • DASH • MP4 • FILES',
        'α PRISM',
      ]);
    } catch (e) {
      treeBox.innerHTML = `<div class="tree-boot">⚠ catalog failed: ${esc(e.message)} — retry in a minute</div>`;
      setTicker(['CATALOG OFFLINE', 'PLAYERS STILL WORK — PASTE ANY URL']);
    }
    addPlayer(q() || defaultSource);
  })();

  return {
    app, addPlayer, wins,
    get player() { return focused(); },
    rerenderTree,
  };
}
