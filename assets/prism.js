/* ============================================================
   PRISM — independent, embeddable AV module. Piece 007.
   Fixes/changes this piece:
   • Snap-locked windows: 14px drag dead-zone; drop near slot = re-lock
   • Grid select MATERIALIZES empty players up to the slot count
   • Channel tap = replace focused player; ＋ on a row = NEW player
   • All catalog streams proxied through the worker (fixes silent
     http/mixed-content failures like DraftKings Network)
   • SOURCE popover smart-flips / centers — never off-screen
   • Dock bar: no horizontal overflow on phones, persistent caret,
     restyled α mark, dark-legible <select> options
   • Spinning-α loader everywhere; last-stream memory; TV GUIDE
     compact-on-load with MINI/COMPACT/FULL modes (unchanged DNA)
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
/* spinning ALPHA loader (ABET live-odds motif) */
const chip = (size = '') => `<span class="poker-chip ${size}"><i></i></span>`;
const proxied = url => `${PROXY}?u=${encodeURIComponent(url)}`;

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

/* ---------------- popovers (smart placement) ---------------- */
let openPopover = null;
function closeOpenPopover() { if (openPopover) { openPopover.remove(); openPopover = null; } }
document.addEventListener('pointerdown', e => { if (openPopover && !openPopover.contains(e.target)) closeOpenPopover(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpenPopover(); });

function showSmart(anchor, node) {
  closeOpenPopover();
  document.body.appendChild(node);

  const mobile = matchMedia('(max-width:820px)').matches;
  const vw = innerWidth, vh = innerHeight;
  let w = Math.max(320, Math.round(anchor.getBoundingClientRect().width));
  w = Math.min(w, vw - 20);
  node.style.width = `${w}px`;

  /* measure hidden, then place: above → flip below → mobile centered */
  node.style.visibility = 'hidden';
  node.style.display = 'block';
  const nh = node.offsetHeight;
  const r = anchor.getBoundingClientRect();
  node.style.visibility = '';

  let left, top;
  if (mobile) {
    left = (vw - w) / 2;
    top = Math.max(12, (vh - nh) / 2 - 40);
  } else {
    left = Math.max(10, Math.min(r.left, vw - w - 10));
    top = r.top - nh - 10;                       // prefer above (dock is below)
    if (top < 10) top = r.bottom + 10;           // flip below when near top
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
    <div class="popover-hint">Or tap a channel in the docks. Tap name = replace · ＋ = new window.</div>`;
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

export function createPresetMenu(getWin, anchorBtn) {
  const menu = el('div', 'popover');
  const render = () => {
    const presets = getPresets();
    menu.innerHTML = `
      <div class="strip-title"><i class="fas fa-plug" style="color:var(--accent-primary)"></i>SAVED SOURCES</div>
      <div class="preset-list">${presets.length ? presets.map((p, i) => `
        <div class="preset-row" data-i="${i}">
          <button class="preset-name">${esc(p.name)}</button><button class="preset-del">✕</button>
        </div>`).join('') : '<div class="popover-hint">Nothing saved yet.</div>'}</div>
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
      if (!url) { toast('Nothing is playing yet'); return; }
      const list = getPresets();
      list.unshift({ name: menu.querySelector('.preset-name-input').value.trim() || url.split('/').pop().slice(0, 32), url });
      savePresets(list); render();
    });
  };
  anchorBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (openPopover === menu) { closeOpenPopover(); return; }
    render(); showSmart(anchorBtn, menu);
  });
}

/* ================= player window ================= */
let zTop = 500;

/* group channels into Map<group, Map<brand, channel[]>> for any sort mode */
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
    <div class="pwin-idle"><span class="alpha-spin big idle-a">α</span><span>PICK A CHANNEL</span></div>
    <div class="pwin-loading" style="display:none">${chip()}</div>
    <div class="pwin-err"></div>`;
  stage.appendChild(cell);

  const video = cell.querySelector('video');
  const errEl = cell.querySelector('.pwin-err');
  const loading = cell.querySelector('.pwin-loading');
  const idleEl = cell.querySelector('.pwin-idle');

  let engine = null, objectUrl = null, currentUrl = '', engineLabel = '—';
  let isEmpty = !!idle;

  const fail = m => { errEl.textContent = m; errEl.classList.add('show'); toast(m); loading.style.display = 'none'; };

  const isIdle = () => idleEl.style.display !== 'none';
  video.addEventListener('waiting', () => { if (!isIdle()) loading.style.display = ''; });
  video.addEventListener('playing', () => { loading.style.display = 'none'; });
  video.addEventListener('canplay', () => { if (!isIdle()) loading.style.display = 'none'; });

  /* autoplay policy: retry muted, offer one-tap sound */
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

    /* route public streams through our worker: CORS + http-upgrade + referer */
    let kind = opts.kind;
    let target = src;
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
  if (idle) { engineLabel = '—'; }

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

/* drag with intent-dead-zone + snap-back-to-slot */
const DRAG_THRESHOLD = 14;   // px of movement before a drag engages
const SNAP_RETURN = 30;      // px near slot to re-lock

function bar_drag(api, bar, stage) {
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    api.focus();
    const r = api.cell.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    let engaged = false;

    const move = ev => {
      const dx = ev.clientX - (s.left + ox), dy = ev.clientY - (s.top + oy);
      if (!engaged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      engaged = true;
      api.cell.classList.add('dragging');
      api.cell.style.left = `${Math.max(0, Math.min(dx, s.width - 56))}px`;
      api.cell.style.top = `${Math.max(0, Math.min(dy, s.height - 44))}px`;
      api.cell.classList.add('free');
      api.cell.classList.remove('snapped');
    };
    const startX = e.clientX, startY = e.clientY;

    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      api.cell.classList.remove('dragging');
      /* snap-back: released near its grid slot → re-lock */
      if (api.cell.dataset.slotL !== undefined) {
        const cw = stage.clientWidth, chh = stage.clientHeight;
        const curL = parseFloat(api.cell.style.left) || 0;
        const curT = parseFloat(api.cell.style.top) || 0;
        const slotPxL = parseFloat(api.cell.dataset.slotL) / 100 * cw;
        const slotPxT = parseFloat(api.cell.dataset.slotT) / 100 * chh;
        const slotW = parseFloat(api.cell.dataset.slotW) / 100 * cw;
        const slotH = parseFloat(api.cell.dataset.slotH) / 100 * chh;
        if (Math.hypot(curL - slotPxL, curT - slotPxT) < SNAP_RETURN ||
            (curL < slotPxL + slotW && curL + r.width > slotPxL && curT < slotPxT + slotH)) {
          Object.assign(api.cell.style, {
            left: api.cell.dataset.slotL + '%',
            top: api.cell.dataset.slotT + '%',
            width: api.cell.dataset.slotW + '%',
            height: api.cell.dataset.slotH + '%',
          });
          api.cell.classList.add('snapped');
          api.cell.classList.remove('free');
        }
      }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}

/* ================= layout ================= */
function autoGrid(n) {
  if (n <= 1) return [1, 1];
  if (n === 2) return [2, 1];
  if (n <= 4) return [2, 2];
  if (n <= 6) return [3, 2];
  if (n <= 8) return [4, 2];
  return [4, Math.ceil(n / 4)];
}

function applyLayout(stage, wins, mode, fit) {
  const eff = mode === 'auto' ? autoGrid(wins.length).join('x') : mode;
  stage.classList.toggle('solo', eff === '1x1' && wins.length <= 1);

  if (mode !== 'free') {
    const [cols, rows] = eff.split('x').map(Number);
    const gap = mode === 'auto' ? 0.6 : 0.9;
    const cw = (100 - gap * (cols + 1)) / cols;
    const ch = (100 - gap * (rows + 1)) / rows;
    wins.forEach((w, i) => {
      if (i >= cols * rows) { w.cell.style.opacity = '.25'; delete w.cell.dataset.slotL; return; }
      w.cell.style.opacity = '';
      const L = gap + (i % cols) * (cw + gap);
      const T = gap + Math.floor(i / cols) * (ch + gap);
      Object.assign(w.cell.style, {
        left: L + '%', top: T + '%', width: cw + '%', height: ch + '%',
      });
      w.cell.dataset.slotL = L; w.cell.dataset.slotT = T;
      w.cell.dataset.slotW = cw; w.cell.dataset.slotH = ch;
      w.cell.classList.add('snapped');
    });
  }
  fit(stage, wins, mode, eff);
}

/* grouping/tree helpers unchanged in spirit ------------------------- */
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

function channelButton(ch, favs, onToggleFav, onPlay, onPlayNew) {
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
      <button class="row-new" title="Open in NEW player" aria-label="Open in new player">＋</button>
      <button class="fav-star${favs.has(ch.id) ? ' on' : ''}" title="${favs.has(ch.id) ? 'Unfavorite' : 'Favorite'}">★</button>
    </span>`;
  b.title = ch.name + (stream ? '' : ' · no stream');
  b.addEventListener('click', e => {
    if (e.target.closest('.fav-star') || e.target.closest('.row-new')) return;
    if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
    onPlay(ch);
  });
  b.querySelector('.row-new').addEventListener('click', e => {
    e.stopPropagation();
    if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 26)}`); return; }
    onPlayNew(ch);
  });
  b.querySelector('.fav-star').addEventListener('click', e => { e.stopPropagation(); onToggleFav(ch.id); });
  return b;
}

function renderTree(container, opts, favs, onToggleFav, onPlayNew) {
  const openKeys = new Set([...container.querySelectorAll('details[open]')].map(d => d.dataset.k));
  container.replaceChildren();

  if (favs.size) {
    const fc = opts.all.filter(c => favs.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
    const det = el('details', 'tree-letter fav-group');
    det.dataset.k = '★FAV';
    if (openKeys.has('★FAV')) det.open = true;
    det.appendChild(el('summary', null,
      `<span class="tree-letter-mark">★</span><span class="tree-group-name">FAVORITES</span><span class="count">${fc.length}</span>`));
    for (const ch of fc) det.appendChild(channelButton(ch, favs, onToggleFav, opts.onPlay, onPlayNew));
    container.appendChild(det);
  }

  const grouped = groupChannels(opts.list, opts.sort);
  for (const [g, subs] of grouped) {
    let count = 0; for (const l of subs.values()) count += l.length;
    const det = el('details', `tree-letter g-${opts.sort}`);
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
        bd.appendChild(channelButton(ch, favs, onToggleFav, opts.onPlay, onPlayNew));
      if (chans.length > BRAND_CAP)
        bd.appendChild(el('div', 'tree-more', `+${(chans.length - BRAND_CAP).toLocaleString()} more…`));
      det.appendChild(bd);
    }
    container.appendChild(det);
  }
  if (!container.children.length)
    container.appendChild(el('div', 'tree-empty',
      opts.workingOnly ? 'No verified-working matches. Untick WORKING to widen the net.' : 'Nothing matches.'));
}

/* ================= bootstrap ================= */
export function mountPrism({
  target,
  title = 'prism | α · any stream, any screen',
  defaultSource = DEFAULT_SOURCE,
} = {}) {
  document.title = title;

  /* ---------- DOM FIRST (bindings strictly after) ---------- */

  /* stage */
  const stage = el('div', 'stage-area');
  const emptyState = el('div', 'stage-empty',
    `<button class="stage-add"><span class="alpha-spin big">α</span><span>+ PLAYER</span></button>`);
  stage.appendChild(emptyState);

  const main = el('div', 'app');
  main.appendChild(stage);

  /* bottom dock */
  const dock = el('div', 'dock');
  const dockBar = el('div', 'dock-bar');
  dockBar.innerHTML = `
    <span class="dock-brand"><span class="alpha-mark">α</span><span class="wordmark">PRISM</span></span>
    <select class="dock-tool" id="layoutSel" title="Grid snap">
      <option value="auto" selected>AUTO</option>
      <option value="free">FREE</option>
      <option value="2x2">2×2</option>
      <option value="3x2">3×2</option><option value="2x3">2×3</option>
      <option value="4x2">4×2</option><option value="2x4">2×4</option>
      <option value="1x1">1×1</option>
    </select>
    <button class="dock-tab active" data-pane="channels"><i class="fas fa-tv"></i> <span class="lbl">CHANNELS</span></button>
    <button class="dock-tab" data-pane="guide"><i class="fas fa-list-ul"></i> <span class="lbl">GUIDE</span></button>
    <span class="dock-meta" id="dockMeta">${chip('sm')} LOADING…</span>
    <span class="dock-tools">
      <button class="dock-tool primary" id="addWin" title="New player"><i class="fas fa-plus"></i></button>
      <button class="dock-tool" id="srcBtn" title="Saved sources"><i class="fas fa-plug"></i></button>
      <button class="dock-tool danger" id="closeAll" title="Close all players"><i class="fas fa-xmark"></i></button>
    </span>
    <i class="fas fa-chevron-up dock-caret" id="dockCaret"></i>`;
  const sheet = el('div', 'dock-sheet');

  const chanPane = el('div', 'pane pane-channels');
  const cFilters = el('div', 'tree-filters');
  cFilters.innerHTML = `
    <input id="treeQ" class="url-input tree-q" type="search" placeholder="⌕ search channels…" />
    <select id="sortSel" class="strip-btn tree-sort" title="Sort">
      <option value="az" selected>A–Z</option><option value="category">CATEGORY</option><option value="country">COUNTRY</option>
    </select>
    <select id="treeC" class="strip-btn tree-country" title="Country"><option value="all">🌍 ALL</option></select>
    <label class="tree-working"><input type="checkbox" id="treeW" checked /> WORKING</label>`;
  const treeBox = el('div', 'tree-box', `<div class="tree-boot">${chip('big')}<div>LOADING…</div></div>`);
  chanPane.append(cFilters, treeBox);

  const guidePane = el('div', 'pane pane-guide');
  guidePane.innerHTML = `
    <div class="guide-head">
      <span class="guide-title">📺 TV GUIDE</span>
      <span class="guide-sizes">
        <button data-gsize="mini" title="Minimize">▁</button>
        <button data-gsize="compact" class="on" title="Compact">▤</button>
        <button data-gsize="full" title="Full page">⛶</button>
      </span>
    </div>
    <div class="guide-body"><div class="tree-boot">${chip('big')}<div>LOADING…</div></div></div>`;

  sheet.append(chanPane, guidePane);
  dock.append(dockBar, sheet);
  main.append(dock);
  target.appendChild(main);

  /* ---------- refs / state ---------- */
  const $ = id => document.getElementById(id);
  const winCountEl = el('span', 'win-count', '0');
  dockBar.insertBefore(winCountEl, dockBar.querySelector('.dock-tools'));
  const guideBody = guidePane.querySelector('.guide-body');
  const guideHeadBtns = guidePane.querySelectorAll('.guide-sizes button');
  const caret = $('dockCaret');

  const wins = [];
  let layoutMode = 'auto';
  let activePane = null;
  let guideSize = 'compact';
  let guideBuilt = false;

  function fit(stageArg, winsArg, mode, effMode) {
    let h;
    if (mode === 'free') {
      const sTop = stageArg.getBoundingClientRect().top;
      h = innerHeight - sTop - sheetReserve() - 16;
      for (const w of winsArg) {
        const r = w.cell.getBoundingClientRect();
        h = Math.max(h, r.bottom - sTop + 16);
      }
    } else if (effMode === '1x1' && winsArg.length <= 1) {
      h = innerHeight - stageArg.getBoundingClientRect().top - sheetReserve() - 8;
    } else {
      const [cols, rowsCap] = effMode.split('x').map(Number);
      const laidRows = Math.min(Math.max(1, Math.ceil(winsArg.length / cols)), rowsCap) || 1;
      const cw = (stageArg.clientWidth - 12 * (cols + 1)) / cols;
      h = laidRows * (cw * 9 / 16 + 42) + 12 * (laidRows + 1);
    }
    stageArg.style.height = `${Math.round(Math.max(h, 240))}px`;
  }
  function sheetReserve() {
    return (activePane === 'guide' && guideSize === 'compact')
      ? Math.round(innerHeight * 0.30) : 0;
  }

  function apply(mode) { applyLayout(stage, wins, mode, fit); }

  function refreshChrome() {
    emptyState.style.display = wins.length ? 'none' : '';
    winCountEl.textContent = `${wins.length} WIN`;
    apply(layoutMode);
  }

  function addPlayer(url, name) {
    const w = createWindow({ stage });
    const origLoad = w.load.bind(w);
    w.load = (src, opts = {}) => {
      if (!opts.isFile && typeof src === 'string') setLast(src, name || '');
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
    /* materialize container players up to the chosen slot count */
    if (layoutMode !== 'free' && layoutMode !== 'auto') {
      const [c, r] = layoutMode.split('x').map(Number);
      while (wins.length < c * r) addPlayer();
    }
    apply(layoutMode);
  });
  addEventListener('resize', () => apply(layoutMode));

  const focused = () => wins.reduce((a, b) =>
    (+a.cell.style.zIndex || 0) >= (+b.cell.style.zIndex || 0) ? a : b, wins.find(w => !w.isEmpty) || wins[0]);

  /* play helpers: tap = replace focused (or fill an idle one); ＋ = new window */
  function playIntoTarget(ch) {
    const url = pickStream(ch.id);
    if (!url) return;
    let w = focused();
    if (!w) w = addPlayer();
    if (w.isEmpty && w.fill) w.fill(url, ch.name);
    else w.load(url), w.setTitle(ch.name.slice(0, 30));
    setLast(url, ch.name);
    if (matchMedia('(max-width:820px)').matches) setDock(null);
  }
  function playNewWindow(ch) {
    const url = pickStream(ch.id);
    if (!url) return;
    const w = addPlayer();
    w.load(url);
    w.setTitle(ch.name.slice(0, 30));
    setLast(url, ch.name);
  }

  /* ---------- favorites ---------- */
  const favs = getFavs();
  function toggleFav(id) {
    favs.has(id) ? favs.delete(id) : favs.add(id);
    saveFavs(favs);
    rerenderTree();
    updateMeta();
  }

  /* ---------- dock panes ---------- */
  function setDock(name) {
    activePane = name;
    const opening = !!name;
    dock.classList.toggle('open', opening);
    document.body.classList.toggle('guide-reserve',
      name === 'guide' && guideSize === 'compact');
    if (name !== 'guide') dock.classList.remove('guide-mini', 'guide-full');

    chanPane.style.display = name === 'channels' ? '' : 'none';
    guidePane.style.display = name === 'guide' ? '' : 'none';
    dockBar.querySelectorAll('.dock-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.pane === name));
    caret.className = `fas fa-chevron-${opening ? 'down' : 'up'} dock-caret`;

    if (name === 'guide') {
      dock.classList.toggle('guide-full', guideSize === 'full');
      dock.classList.toggle('guide-mini', guideSize === 'mini');
      if (!guideBuilt) buildGuide();
    }
    apply(layoutMode);
  }
  dockBar.querySelectorAll('.dock-tab').forEach(t =>
    t.addEventListener('click', e => {
      e.stopPropagation();
      setDock(activePane === t.dataset.pane ? null : t.dataset.pane);
    }));

  function setGuideSize(s) {
    guideSize = s;
    dock.classList.remove('guide-mini', 'guide-full');
    if (s !== 'compact') dock.classList.add(`guide-${s}`);
    guideHeadBtns.forEach(b => b.classList.toggle('on', b.dataset.gsize === s));
    document.body.classList.toggle('guide-reserve',
      activePane === 'guide' && s === 'compact');
    if (s === 'mini') setDock(null);
    else setDock('guide');
  }
  guideHeadBtns.forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    setGuideSize(b.dataset.gsize);
  }));

  /* ---------- guide cards ---------- */
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
    card.title = ch.name + ' · tap to replace current player';
    card.addEventListener('click', () => {
      if (!stream) { toast(`NO STREAM FOR ${ch.name.toUpperCase().slice(0, 24)}`); return; }
      playIntoTarget(ch);
      if (matchMedia('(max-width:820px)').matches) setGuideSize('mini');
    });
    return card;
  }

  function buildGuide() {
    guideBuilt = true;
    guideBody.replaceChildren();
    const cats = categories().filter(([c]) => !['xxx', 'adult'].includes(c.toLowerCase()));
    const prio = [...cats].sort((a, b) => {
      const ia = GUIDE_ROW_ORDER.indexOf(a[0]), ib = GUIDE_ROW_ORDER.indexOf(b[0]);
      return ((ia >= 0 ? ia : 99) - (ib >= 0 ? ib : 99)) || (b[1] - a[1]);
    }).slice(0, 14);
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
      guideBody.appendChild(row);
    }
    if (!guideBody.children.length)
      guideBody.innerHTML = '<div class="tree-empty">No categorized channels yet.</div>';
  }

  /* ---------- channels tree ---------- */
  const treeOpts = { q: '', country: 'all', workingOnly: true, sort: 'az', all: [], list: [] };
  function rerenderTree() {
    treeOpts.list = query(treeOpts);
    renderTree(treeBox, treeOpts, favs, toggleFav, playNewWindow);
  }
  let qT;
  cFilters.querySelector('#treeQ').addEventListener('input', e => {
    clearTimeout(qT);
    qT = setTimeout(() => { treeOpts.q = e.target.value; rerenderTree(); }, 250);
  });
  cFilters.querySelector('#treeW').addEventListener('change', e => { treeOpts.workingOnly = e.target.checked; rerenderTree(); });
  cFilters.querySelector('#treeC').addEventListener('change', e => { treeOpts.country = e.target.value; rerenderTree(); });
  cFilters.querySelector('#sortSel').addEventListener('change', e => { treeOpts.sort = e.target.value; rerenderTree(); });

  createPresetMenu(focused, $('srcBtn'));

  function updateMeta() {
    const s = stats();
    $('dockMeta').innerHTML =
      `<b>${s.totalAll.toLocaleString()}</b> CH · <b class="ok">${s.working.toLocaleString()} ✓</b>` +
      (favs.size ? ` · <b style="color:var(--accent-secondary)">★${favs.size}</b>` : '');
  }

  /* ---------- boot: last-stream memory ---------- */
  (async () => {
    try {
      const s = await loadCatalog(m => {
        treeBox.innerHTML = `<div class="tree-boot">${chip('big')}<div>${esc(m || 'working…')}</div></div>`;
        guideBody.innerHTML = `<div class="tree-boot">${chip('big')}<div>${esc(m || 'working…')}</div></div>`;
        $('dockMeta').innerHTML = `${chip('sm')} ${esc(m || 'loading…')}`;
      });
      cFilters.querySelector('#treeC').insertAdjacentHTML('beforeend',
        countries().slice(0, 60)
          .map(([code, n]) => `<option value="${code}">${code.toUpperCase()} (${n.toLocaleString()})</option>`).join(''));
      treeOpts.all = query({ q: '', country: 'all', workingOnly: false });
      rerenderTree();
      updateMeta();
      requestLogos(() => { rerenderTree(); if (guideBuilt) buildGuide(); });
    } catch (e) {
      treeBox.innerHTML = `<div class="tree-boot">⚠ catalog failed: ${esc(e.message)}</div>`;
      $('dockMeta').textContent = 'catalog offline — players still work';
    }

    const qp = new URLSearchParams(location.search).get('src');
    const last = getLast();
    const boot = qp || last?.url || defaultSource;
    const w = addPlayer(qp ? qp : proxied(boot));
    if (!qp && last?.name) w.setTitle(last.name.slice(0, 30));

    setDock('guide');   // TV GUIDE loads expanded + compact
  })();

  return { app: main, addPlayer, wins, rerenderTree, setDock, setGuideSize, player() { return focused(); } };
}


/* ---------- poker-chip spinner + mute badge helpers (Piece 007a) ---------- */
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
