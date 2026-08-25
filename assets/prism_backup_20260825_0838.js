/* ============================================================
   PRISM — independent, embeddable AV module. Piece 001.
   ABET design system, no framework, no build step.

   Exposes:
     mountPrism({target, ticker?, defaultSource?, navPills?})
       -> { app, setMode(mode), player(s) }
     mountHeader, mountNavSection, statusPill, createPlayer,
     createSourceMenu, createPresetMenu   (for custom embeddings)

   Engines: .m3u8 -> hls.js(lazy) -> native-HLS ; .mpd -> dash.js(lazy) ;
            anything else -> native <video>. Local files via object URLs.
   ============================================================ */

const CDN = {
  hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  dash: 'https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js',
};

const PRESETS_KEY = 'prism.presets';
const DEFAULT_SOURCE = 'https://propee33f9c2.airspace-cdn.cbsivideo.com/index.m3u8';

const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => bad(new Error('failed to load ' + src));
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- presets (per-device, localStorage) ---------------- */
function getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; }
}
function savePresets(list) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list.slice(0, 30))); } catch {}
}

/* ---------------- header ---------------- */
export function mountHeader({ target, logoHTML = '<span class="alpha">◇</span>prism', ticker = ['LIVE TV', 'ANY FILE • ANY STREAM', 'HLS • DASH • MP4'], right = [] }) {
  const header = el('header', 'header');
  const left = el('div', 'header-left');
  const burger = el('button', 'hamburger-btn', '<span></span><span></span><span></span>');
  burger.title = 'Toggle navigation';
  const logo = el('button', 'logo-btn glitch-text', logoHTML);
  logo.title = 'prism';
  left.append(burger, logo);

  const center = el('div', 'header-center');
  const dm = el('div', 'dot-matrix-container');
  const group = ticker.map(t => `<span>${esc(t)}</span><span class="separator">•</span>`).join('');
  dm.innerHTML = `<div class="dot-matrix-scroll">${group}${group}</div>`;
  center.appendChild(dm);

  const rightEl = el('div', 'header-right');
  right.forEach(n => rightEl.appendChild(n));

  header.append(left, center, rightEl);
  target.appendChild(header);
  return { header, burger };
}

/* ---------------- collapsible nav section ---------------- */
export function mountNavSection({ target, label = 'NAVIGATION', pills = [], startCollapsed = true }) {
  const section = el('div', `collapsible-section${startCollapsed ? ' collapsed' : ''}`);
  const toggle = el('button', 'collapse-toggle',
    `<span class="collapse-label">${esc(label)}</span><i class="fas fa-chevron-${startCollapsed ? 'down' : 'up'}"></i>`);
  const body = el('div', 'section-body');
  const nav = el('nav', 'sport-nav');
  const registry = new Map();

  for (const p of pills) {
    const b = el('button', `sport-btn${p.active ? ' active' : ''}`,
      `${p.icon ? `<i class="fas ${p.icon}"></i>` : ''}<span>${esc(p.label)}</span>`);
    b.disabled = !!p.disabled;
    if (p.title) b.title = p.title;
    nav.appendChild(b);
    registry.set(p.label, b);
    if (!p.disabled && p.onClick) b.addEventListener('click', () => p.onClick(b));
  }
  body.appendChild(nav);
  section.append(toggle, body);
  target.appendChild(section);

  const setExpanded = v => {
    section.classList.toggle('collapsed', !v);
    toggle.querySelector('i').className = `fas fa-chevron-${v ? 'up' : 'down'}`;
  };
  toggle.addEventListener('click', () => setExpanded(section.classList.contains('collapsed')));
  return { section, nav, pills: registry, setExpanded, toggleCollapse: () => setExpanded(section.classList.contains('collapsed')) };
}

/* ---------------- popovers ---------------- */
let openPopover = null;
function closeOpenPopover() {
  if (openPopover) { openPopover.remove(); openPopover = null; }
}
document.addEventListener('pointerdown', e => {
  if (openPopover && !openPopover.contains(e.target)) closeOpenPopover();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpenPopover(); });

function showPopover(anchor, node) {
  closeOpenPopover();
  document.body.appendChild(node);
  const r = anchor.getBoundingClientRect();
  const w = Math.max(340, r.width);
  node.style.position = 'fixed';
  node.style.top = `${Math.min(r.bottom + 6, innerHeight - 20)}px`;
  let left = r.left;
  if (left + w > innerWidth - 10) left = innerWidth - w - 10;
  node.style.left = `${Math.max(10, left)}px`;
  node.style.width = `${w}px`;
  openPopover = node;
  const first = node.querySelector('input');
  if (first) setTimeout(() => first.focus(), 30);
  return node;
}

/* SOURCE menu: url bar + file picker for one player */
export function createSourceMenu(playerApi, anchorBtn) {
  const menu = el('div', 'popover');
  menu.innerHTML = `
    <div class="strip-title"><i class="fas fa-tv" style="color:var(--accent-primary)"></i>
      OPEN A SOURCE <span class="strip-sep">|</span> <span class="engine-badge">—</span></div>
    <input class="url-input" type="text" spellcheck="false" autocomplete="off"
           placeholder="Stream or file URL — .m3u8 / .mpd / .mp4 / webm / mkv…" />
    <div class="popover-actions">
      <button class="strip-btn" data-act="file">FILE…</button>
      <button class="strip-btn primary" data-act="load">PLAY</button>
    </div>
    <input type="file" accept="video/*,audio/*,.mkv,.m3u8" style="display:none" />
    <div class="popover-hint">Tip: press Enter to play. Saved presets live under the SOURCES pill.</div>`;
  const input = menu.querySelector('.url-input');
  const badge = menu.querySelector('.engine-badge');

  const refreshBadge = () => { badge.textContent = playerApi.engineLabel || '—'; };
  refreshBadge();
  menu.addEventListener('pointerdown', () => setTimeout(refreshBadge, 50));

  const act = name => menu.querySelector(`[data-act="${name}"]`);
  act('load').addEventListener('click', () => {
    const v = input.value.trim();
    if (!v) return;
    playerApi.load(v);
    closeOpenPopover();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') act('load').click(); });
  const fi = menu.querySelector('input[type=file]');
  act('file').addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => {
    const f = fi.files?.[0];
    if (f) { playerApi.load(f, { isFile: true }); closeOpenPopover(); }
    fi.value = '';
  });

  anchorBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (openPopover === menu) { closeOpenPopover(); return; }
    showPopover(anchorBtn, menu);
  });
  return { menu };
}

/* SOURCES menu: saved presets manager */
export function createPresetMenu(getTargetApi, anchorBtn) {
  const menu = el('div', 'popover');
  const render = () => {
    const presets = getPresets();
    menu.innerHTML = `
      <div class="strip-title"><i class="fas fa-plug" style="color:var(--accent-primary)"></i>
        SAVED SOURCES</div>
      <div class="preset-list">
        ${presets.length ? presets.map((p, i) => `
          <div class="preset-row" data-i="${i}">
            <button class="preset-name" title="${esc(p.url)}">${esc(p.name)}</button>
            <button class="preset-del" title="Delete">✕</button>
          </div>`).join('')
        : '<div class="popover-hint">Nothing saved yet. Play something, then save it here.</div>'}
      </div>
      <div class="save-row">
        <input class="preset-name-input" type="text" maxlength="40" placeholder="Name for CURRENT stream…" />
        <button class="strip-btn primary" data-act="save">SAVE</button>
      </div>
      <div class="popover-hint">Saving grabs whatever is loaded in the focused player.</div>`;
    menu.querySelectorAll('.preset-name').forEach(b =>
      b.addEventListener('click', () => {
        const p = getPresets()[+b.closest('.preset-row').dataset.i];
        if (p) { getTargetApi().load(p.url); closeOpenPopover(); }
      }));
    menu.querySelectorAll('.preset-del').forEach(b =>
      b.addEventListener('click', () => {
        const i = +b.closest('.preset-row').dataset.i;
        const list = getPresets(); list.splice(i, 1); savePresets(list); render();
      }));
    menu.querySelector('[data-act="save"]').addEventListener('click', () => {
      const nameEl = menu.querySelector('.preset-name-input');
      const api = getTargetApi();
      const url = api.currentUrl;
      if (!url) { nameEl.placeholder = 'Nothing loaded yet…'; return; }
      const list = getPresets();
      list.unshift({ name: nameEl.value.trim() || url.split('/').pop().slice(0, 32), url });
      savePresets(list);
      render();
    });
  };
  render();
  anchorBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (openPopover === menu) { closeOpenPopover(); return; }
    render();
    showPopover(anchorBtn, menu);
  });
  return { menu };
}

/* ---------------- universal player core ---------------- */
export function createPlayer({ container, compact = false }) {
  const shell = el('div', compact ? 'tile' : 'player-shell');
  const video = document.createElement('video');
  video.controls = true; video.playsInline = true; video.preload = 'metadata';
  shell.appendChild(video);

  let errEl = null;
  if (!compact) {
    errEl = el('div', 'player-error');
    container.append(shell, errEl);
  } else {
    const bar = el('div', 'tile-bar',
      `<span class="tile-tag">—</span>
       <span class="tile-actions">
         <button class="tile-src" title="Change source">SOURCE</button>
       </span>`);
    errEl = el('div', 'tile-error');
    shell.append(bar, errEl);
    container.appendChild(shell);
  }

  let engine = null;
  let objectUrl = null;
  let currentUrl = '';
  let engineLabel = '—';
  let sourceBtn = null;

  function fail(msg) {
    errEl.textContent = msg;
    errEl.classList.add(compact ? 'show' : 'show');
    console.error('[prism.player]', msg);
  }
  function teardown() {
    if (engine?.destroy) { try { engine.destroy(); } catch {} }
    if (engine?.reset) { try { engine.reset(); } catch {} }
    engine = null;
    video.removeAttribute('src'); video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function load(src, { isFile = false } = {}) {
    errEl.classList.remove('show');
    teardown();
    try {
      if (isFile) {
        objectUrl = URL.createObjectURL(src);
        video.src = objectUrl;
        currentUrl = `file:${src.name}`;
        engineLabel = 'FILE';
      } else {
        currentUrl = src;
        const kind = /\.mpd($|\?)/i.test(src) ? 'dash'
          : (/\.m3u8($|\?)/i.test(src) ? 'hls' : 'native');
        if (kind === 'hls') {
          if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) {
            video.src = src; engineLabel = 'native-hls';
          } else {
            await loadScript(CDN.hls);
            if (!window.Hls?.isSupported()) { video.src = src; engineLabel = 'native-hls'; }
            else {
              engine = new Hls({ enableWorker: true, maxBufferLength: 30, fragLoadingMaxRetry: 6 });
              engine.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(`stream error (${d.details})`); });
              engine.loadSource(src);
              engine.attachMedia(video);
              engineLabel = 'hls.js';
            }
          }
        } else if (kind === 'dash') {
          await loadScript(CDN.dash);
          engine = window.dashjs.MediaPlayer().create();
          engine.initialize(video, src, true);
          engineLabel = 'dash.js';
        } else {
          video.src = src;
          engineLabel = 'native';
        }
      }
      shell.querySelector('.tile-tag')?.replaceChildren(engineLabel);
      await video.play().catch(() => {});
    } catch (e) {
      fail(e.message || String(e));
    }
  }

  const api = {
    video, shell, load,
    get engineLabel() { return engineLabel; },
    get currentUrl() { return currentUrl; },
    attachSourceButton(btn) {
      sourceBtn = btn;
      createSourceMenu(api, btn);
    },
    destroy() { teardown(); shell.remove(); },
  };

  if (compact) {
    const btn = shell.querySelector('.tile-src');
    createSourceMenu(api, btn);
  }
  return api;
}

/* ---------------- multi-view grid ---------------- */
function createMultiView({ host }) {
  const grid = el('div', 'mv-grid');
  host.appendChild(grid);
  const tiles = []; // {api, cell}

  function addTile(url) {
    if (tiles.length >= 4) return null;
    const cell = el('div', 'tile-cell');
    grid.appendChild(cell);
    const api = createPlayer({ container: cell, compact: true });
    tiles.push({ api, cell });
    if (url) api.load(url);
    return api;
  }

  function removeTile(api) {
    const i = tiles.findIndex(t => t.api === api);
    if (i >= 0) { tiles[i].api.destroy(); tiles.splice(i, 1); }
  }

  function clear() { while (tiles.length) removeTile(tiles[0].api); grid.remove(); }

  return { grid, addTile, removeTile, clear, count: () => tiles.length };
}

/* ---------------- one-call bootstrap ---------------- */
export function mountPrism({
  target,
  title = 'prism | any stream, any screen',
  ticker = ['LIVE TV', 'ANY FILE • ANY STREAM', 'HLS • DASH • MP4'],
  defaultSource = DEFAULT_SOURCE,
} = {}) {
  document.title = title;

  const app = el('div', 'app crt-effect');
  const stage = el('div', 'app-content');
  app.appendChild(stage);
  target.appendChild(app);

  /* single-view player (always alive; shown in WATCH mode) */
  const singleWrap = el('div', null);
  const main = createPlayer({ container: singleWrap });
  stage.appendChild(singleWrap);

  /* multi-view lives lazily in its own wrap */
  let mv = null;
  let mode = 'single';

  function setMode(next) {
    if (next === mode && next !== 'multi') { /* re-click same pill: no-op */ }
    mode = next;
    singleWrap.style.display = mode === 'single' ? '' : 'none';
    if (mode === 'multi') {
      if (!mv) { mv = createMultiView({ host: stage }); mv.addTile(defaultSource); }
      mv.grid.style.display = '';
    } else if (mv) {
      mv.grid.style.display = 'none';
    }
    syncPills();
  }

  /* header (no status pill — errors surface inside the player) */
  const { burger } = mountHeader({ target: app, ticker });

  const focused = () => (mode === 'multi' && mv && mv.count() ? mv.tiles[0].api : main);

  const navSection = mountNavSection({
    target: app,
    startCollapsed: false,
    pills: [
      { label: 'WATCH', icon: 'fa-play', active: true, onClick: () => setMode('single') },
      {
        label: 'MULTI-VIEW', icon: 'fa-table-cells-large',
        onClick: () => setMode('multi'),
      },
      {
        label: 'TV GUIDE', icon: 'fa-list-ul', disabled: true,
        title: 'Piece 003 — needs an EPG data feed before it earns a pill',
      },
      {
        label: 'SOURCES', icon: 'fa-plug',
        onClick: btn => createPresetMenu(focused, btn),
      },
    ],
  });

  burger.addEventListener('click', () => navSection.toggleCollapse());

  function syncPills() {
    for (const [label, btn] of navSection.pills) {
      if (label === 'WATCH') btn.classList.toggle('active', mode === 'single');
      if (label === 'MULTI-VIEW') btn.classList.toggle('active', mode === 'multi');
    }
  }

  /* boot: instant-on default stream unless a deep link overrides */
  const qp = new URLSearchParams(location.search).get('src');
  main.load(qp || defaultSource);

  return {
    app,
    get player() { return focused(); },
    main,
    setMode,
    getMode: () => mode,
    multiView: () => mv,
  };
}
